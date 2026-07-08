import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs'
import { Queue } from '@forge/events';
import { randomUUID } from 'crypto';
import { registerExportAssets } from './exportAssets';
import { registerAdminResolvers } from './adminResolvers';
import { registerCsvImportResolvers } from './csvImport';
import {
  CONFIG_KEY,
  jobKey,
  clampPageSize,
  isUnlicensedCaller,
  resolveUser,
  getWorkspaceId,
  searchAssetsSinglePage,
  verifyAssetOwnership,
  assetListCacheKey,
  resolveAssetList,
  buildAssetPayload,
} from './shared';

const resolver = new Resolver();

// ─── Resolvers ────────────────────────────────────────────────────────────────
// Everything below is called from the portal-footer module (src/frontend/
// index.jsx) — the customer/agent-facing "My assets" view — plus getConfig,
// which both that view and the admin config page read. Admin-only resolvers
// (schema/object-type discovery, saveConfig, AQL validation/preview,
// reconciliation) live in adminResolvers.js and register via
// registerAdminResolvers below; shared AQL/workspace/asset-payload helpers
// live in shared.js. One Resolver instance, one `resolver.getDefinitions()`
// export point here — the split is purely about file organization.

resolver.define('getUser', async ({ context }) => {
  try {
    const unlicensed = isUnlicensedCaller(context);
    if (unlicensed) {
      const accountId = context?.accountId;
      if (!accountId || accountId === 'unidentified') return { displayName: 'Guest' };
      const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
      if (res.ok) return await res.json();
      return { displayName: 'Customer', accountId };
    }
    const response = await api.asUser().requestJira(route`/rest/api/3/myself`);
    if (!response.ok) return { displayName: 'Unknown User' };
    return await response.json();
  } catch {
    return { displayName: 'Unknown User' };
  }
});

resolver.define('getConfig', async () => (await kvs.get(CONFIG_KEY)) || {});

resolver.define('getConfigVersion', async () => {
  try {
    const config = (await kvs.get(CONFIG_KEY)) || {};
    return { version: Number(config.version) || 0, updatedAt: config.updatedAt || null };
  } catch (err) {
    console.error('getConfigVersion error:', err);
    return { version: 0, updatedAt: null };
  }
});

// ─── Async asset-load job (getUserAssets moved off the synchronous path) ──────
// startAssetLoadJob is deliberately tiny and fast — just enqueue and
// return a jobId — so it can never hit the 25s invoke() ceiling itself.
// The actual AQL search + hydration work (what getUserAssets used to do
// inline) now lives in assetLoadConsumer.js, running as a queue consumer
// with a much longer execution budget (see manifest.yml). The frontend
// starts this job then polls getAssetLoadJobResult until it's done — see
// awaitAssetLoadJob in src/frontend/index.jsx.
//
// unlicensed/accountId are captured HERE, inside the synchronous request
// where `context` is trustworthy, and passed through the queued payload —
// a queue-triggered consumer invocation has no attached user session, so
// isUnlicensedCaller(context) wouldn't mean anything reliable there.
resolver.define('startAssetLoadJob', async ({ payload, context }) => {
  const activeAccountId = payload?.accountId || context?.accountId;
  if (!activeAccountId || activeAccountId === 'unidentified') {
    return { error: 'Could not identify the current user. Please log in.' };
  }

  const unlicensed = isUnlicensedCaller(context);
  const jobId = randomUUID();

  console.log(
    `[startAssetLoadJob] jobId=${jobId} accountId=${activeAccountId} unlicensed=${unlicensed} ` +
    `rawFilters=${JSON.stringify(payload?.filters || null)}`
  );

  // Written BEFORE the push (not after) so there's no window where the
  // consumer could finish and write 'done' before this 'pending' marker
  // exists — that ordering would let this overwrite a real result with a
  // stale 'pending' status.
  await kvs.set(jobKey(jobId), { status: 'pending', createdAt: Date.now() });

  const queue = new Queue({ key: 'asset-load-queue' });
  await queue.push({
    body: {
      jobId,
      accountId: activeAccountId,
      limit: payload?.limit,
      filters: payload?.filters || null,
      unlicensed,
    },
  });

  return { jobId };
});

resolver.define('getAssetLoadJobResult', async ({ payload }) => {
  const jobId = payload?.jobId;
  if (!jobId) return { status: 'error', error: 'jobId is required' };
  const job = await kvs.get(jobKey(jobId));
  if (!job) return { status: 'error', error: 'Job not found or expired' };
  return job;
});

resolver.define('getUserAssetsPage', async ({ payload, context }) => {
  try {
    const config = (await kvs.get(CONFIG_KEY)) || {};
    if (!config.schemaId) return { values: [], hasMore: false };

    const unlicensed = isUnlicensedCaller(context);
    const useAppAuth = unlicensed;
    const offset = Math.max(Number(payload?.offset) || 0, 0);
    const limit  = clampPageSize(payload?.limit);
    // Optional: when set, paginate only within this object type's assets.
    const objectTypeIdFilter = payload?.objectTypeId ? String(payload.objectTypeId) : null;

    const activeAccountId = payload?.accountId || context?.accountId;
    if (!activeAccountId || activeAccountId === 'unidentified') {
      return { values: [], error: 'Could not identify the current user. Please log in.' };
    }

    let user = await resolveUser(activeAccountId, useAppAuth);
    if (!useAppAuth && !user.displayName) {
      const myselfRes = await api.asUser().requestJira(route`/rest/api/3/myself`);
      if (myselfRes.ok) user = await myselfRes.json();
    }

    const filters = payload?.filters || null;

    const { values: allStubs, hadAnySuccess, lastError, workspaceId: cachedOrFreshWorkspaceId } =
      await resolveAssetList({
        accountId: activeAccountId, config, user, useAppAuth,
        forceFresh: Boolean(filters), filters,
      });

    if (lastError && !hadAnySuccess) return { values: [], error: lastError };

    const scopedStubs = objectTypeIdFilter
      ? allStubs.filter((a) => String(a.objectType?.id || '') === objectTypeIdFilter)
      : allStubs;

    const totalCount = scopedStubs.length;
    const pageStubs  = scopedStubs.slice(offset, offset + limit);

    if (pageStubs.length === 0) {
      return { values: [], visibleAttributes: [], hasMore: false, nextOffset: offset, totalCount };
    }

    const workspaceId = cachedOrFreshWorkspaceId || await getWorkspaceId(useAppAuth);
    const caller = useAppAuth ? api.asApp() : api.asUser();

    // Filtered (forceFresh) results come back from searchAssets with
    // includeAttributes=true already — a stub carrying `.attributes` is
    // already a full asset, so skip the extra per-object round trip and
    // only hydrate the ones that are genuinely just { id, objectType }
    // cache stubs.
    const fullPageValues = (
      await Promise.all(
        pageStubs.map(async (stub) => {
          if (Array.isArray(stub.attributes)) return stub;
          try {
            const res = await caller.requestJira(
              route`/jsm/assets/workspace/${workspaceId}/v1/object/${stub.id}?includeAttributes=true`
            );
            if (!res.ok) {
              console.warn(`[getUserAssetsPage] fetch failed for objectId=${stub.id}: ${res.status}`);
              return null;
            }
            return await res.json();
          } catch (e) {
            console.warn(`[getUserAssetsPage] fetch error for objectId=${stub.id}:`, e?.message);
            return null;
          }
        })
      )
    ).filter(Boolean); // drop any that 404'd / errored

    if (fullPageValues.length === 0) {
      return { values: [], visibleAttributes: [], hasMore: false, nextOffset: offset, totalCount };
    }

    const allTypeIdsForPage = [...new Set(scopedStubs.map((a) => String(a.objectType?.id || '')).filter(Boolean))];

    const { mappedValues, columnsToShow } = await buildAssetPayload({
      values: fullPageValues, workspaceId, config, useAppAuth, ignoreHidden: false,
      typeIdsForColumns: allTypeIdsForPage,
    });

    return {
      values: mappedValues,
      visibleAttributes: columnsToShow,
      totalCount,
      hasMore: offset + pageStubs.length < totalCount,
      nextOffset: offset + pageStubs.length,
    };
  } catch (error) {
    console.error('getUserAssetsPage error:', error);
    return { values: [], error: error?.message || 'getUserAssetsPage failed' };
  }
});

resolver.define('updateAssetAttribute', async ({ payload, context }) => {
  const { objectId, objectTypeAttributeId, objectTypeId, value, attributeType } = payload || {};
  if (!objectId || !objectTypeAttributeId || !objectTypeId) {
    throw new Error('objectId, objectTypeAttributeId, and objectTypeId are required');
  }

  const config     = (await kvs.get(CONFIG_KEY)) || {};
  const unlicensed = isUnlicensedCaller(context);

  if (unlicensed && !config.allowPortalEdit) {
    throw new Error('Asset editing is not enabled for portal customers. Contact your administrator.');
  }

  const activeAccountId = context?.accountId;
  if (!activeAccountId || activeAccountId === 'unidentified') {
    throw new Error('Could not identify the requesting user.');
  }

  const requestingUser = await resolveUser(activeAccountId, unlicensed);

  // Ownership check — always asApp() so unlicensed users can be verified too
  const workspaceId = await getWorkspaceId(true);
  const owns = await verifyAssetOwnership(objectId, requestingUser, config, workspaceId);
  if (!owns) {
    console.warn(`[updateAssetAttribute] OWNERSHIP DENIED — accountId=${activeAccountId} tried to edit objectId=${objectId}`);
    throw new Error('You do not have permission to edit this asset. It does not appear to be assigned to your account.');
  }

  // serviceAccount (default) → asApp(); userAccount (legacy) → asUser()
  const useAppForWrite = config.editMode !== 'userAccount';
  if (!useAppForWrite && unlicensed) {
    throw new Error('User account edit mode is not available for portal customers.');
  }

  const writeCaller      = useAppForWrite ? api.asApp() : api.asUser();
  const writeWorkspaceId = useAppForWrite ? workspaceId : await getWorkspaceId(false);

  const rawValues = Array.isArray(value) ? value : [value];
  const objectAttributeValues = rawValues
    .filter((v) => v !== '' && v != null)
    .map((v) => ({ value: String(v) }));

  const body = {
    objectTypeId: Number(objectTypeId),
    attributes: [{
      objectTypeAttributeId: Number(objectTypeAttributeId),
      objectAttributeValues: objectAttributeValues.length > 0 ? objectAttributeValues : [],
    }],
    avatarUUID: '',
    hasAvatar: false,
  };

  console.log(
    `[updateAssetAttribute] mode=${useAppForWrite ? 'serviceAccount/asApp' : 'userAccount/asUser'} ` +
    `objectId=${objectId} attr=${objectTypeAttributeId} requestedBy=${activeAccountId}`
  );

  const response = await writeCaller.requestJira(
    route`/jsm/assets/workspace/${writeWorkspaceId}/v1/object/${objectId}`,
    {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update asset: ${response.status} — ${text}`);
  }

  const result = await response.json();

  try {
    await kvs.delete(assetListCacheKey(activeAccountId));
  } catch (_) {}

  return result;
});

resolver.define('diagnoseCaller', async ({ payload, context }) => {
  const errors = [];
  const accountId = payload?.accountId || context?.accountId || null;
  const accountType = context?.accountType || null;
  const unlicensed = isUnlicensedCaller(context);
  const useAppAuth = unlicensed;

  let displayName = '';
  let workspaceReachable = false;
  let workspaceId = null;
  let schemaReachable = false;
  let schemaObjectCount = 0;

  try {
    if (accountId && accountId !== 'unidentified') {
      const profile = await resolveUser(accountId, useAppAuth);
      displayName = profile?.displayName || '';
    }
  } catch (err) {
    errors.push(`Could not resolve user profile: ${err?.message || err}`);
  }

  try {
    workspaceId = await getWorkspaceId(useAppAuth);
    workspaceReachable = Boolean(workspaceId);
  } catch (err) {
    errors.push(`Workspace not reachable: ${err?.message || err}`);
  }

  let config = {};
  try {
    config = (await kvs.get(CONFIG_KEY)) || {};
  } catch (err) {
    errors.push(`Could not read configuration: ${err?.message || err}`);
  }

  if (workspaceReachable && config.schemaId) {
    try {
      const probe = await searchAssetsSinglePage(
        workspaceId,
        `objectSchemaId = ${config.schemaId}`,
        useAppAuth
      );
      if (probe.error) {
        errors.push(`Schema query failed: ${probe.error}`);
      } else {
        schemaReachable = true;
        schemaObjectCount = probe.total ?? probe.values?.length ?? 0;
      }
    } catch (err) {
      errors.push(`Schema probe failed: ${err?.message || err}`);
    }
  }

  return {
    accountId,
    accountType,
    displayName,
    workspaceReachable,
    schemaReachable,
    schemaObjectCount,
    errors,
  };
});

registerAdminResolvers(resolver);
registerExportAssets(resolver);
registerCsvImportResolvers(resolver);
export const handler = resolver.getDefinitions();
