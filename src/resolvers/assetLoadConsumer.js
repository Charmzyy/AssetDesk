import { kvs } from '@forge/kvs';
import {
  CONFIG_KEY,
  jobKey,
  clampPageSize,
  resolveUser,
  getWorkspaceId,
  resolveAssetList,
  buildAssetPayload,
} from './shared';

// ─── Async asset-load job consumer ─────────────────────────────────────────────
// This is what used to be the synchronous 'getUserAssets' resolver, moved
// onto Forge's Async Events API (see the `asset-load-job-consumer` module
// in manifest.yml, which reads from the `asset-load-queue` queue). The
// portal-footer view now calls `startAssetLoadJob` (fast — just enqueues
// this) and polls `getAssetLoadJobResult` for the outcome, instead of
// awaiting a single synchronous invoke() call.
//
// Why: an account linked to 2000+ assets could make the old synchronous
// getUserAssets exceed Forge's 25-second limit on invoke()-backed resolver
// calls — a hard platform ceiling for that call path that manifest.yml's
// timeoutSeconds cannot raise. A consumer function bound to a queue can
// run up to 900 seconds (see this function's timeoutSeconds in
// manifest.yml), which is the actual fix; the earlier parallel-pagination
// change to searchAssets (shared.js) helps but doesn't remove the ceiling.
//
// Auth note: queue-triggered invocations have no attached user session, so
// this can only ever call Jira's API asApp() — never asUser(). Previously
// only unlicensed portal customers went through asApp(); licensed agents
// used asUser(). Everyone goes through asApp() now. This is considered
// safe because the AQL ownership filter (matching accountId/displayName/
// email in buildAqlCandidates) is what scopes results to "this user's
// assets" regardless of auth mode — asUser() was never what did that
// scoping — and verifyAssetOwnership (used by updateAssetAttribute)
// already always uses asApp() today regardless of caller license status.
//
// `unlicensed`/`canEdit`-relevant flags can't be recomputed here (no
// trustworthy `context.accountType` in a queue invocation), so
// startAssetLoadJob captures them from its own synchronous context and
// passes them through the queued payload instead.
export const handler = async (event) => {
  const { jobId, accountId, limit: rawLimit, filters, unlicensed } = event.body || {};

  if (!jobId) {
    console.error('[assetLoadConsumer] event missing jobId — cannot report a result anywhere', event);
    return;
  }

  try {
    const config = (await kvs.get(CONFIG_KEY)) || {};
    if (!config.schemaId) {
      await kvs.set(jobKey(jobId), { status: 'done', result: { values: [], needsConfiguration: true } });
      return;
    }

    const useAppAuth = true; // always — see comment above
    const limit = clampPageSize(rawLimit);
    console.log(`[assetLoadConsumer] jobId=${jobId} accountId=${accountId} limit=${limit} hasFilters=${Boolean(filters)}`);

    if (!accountId || accountId === 'unidentified') {
      await kvs.set(jobKey(jobId), {
        status: 'done',
        result: { values: [], error: 'Could not identify the current user. Please log in.' },
      });
      return;
    }

    const user = await resolveUser(accountId, useAppAuth);

    const {
      values: allValues,
      matchedAqls,
      hadAnySuccess,
      lastError,
      workspaceId: resolvedWorkspaceId,
      wasLimited,
      limitApplied,
      preLimitCount,
      filterAql,
    } = await resolveAssetList({
      accountId, config, user, useAppAuth, forceFresh: true,
      filters: filters || null,
    });

    const matchedAql = matchedAqls[0] || null;
    if (lastError && !hadAnySuccess) {
      await kvs.set(jobKey(jobId), { status: 'done', result: { values: [], error: lastError } });
      return;
    }

    const canEdit = unlicensed ? Boolean(config.allowPortalEdit) : true;
    const totalCount = allValues.length;

    if (totalCount === 0) {
      console.log(`[assetLoadConsumer] jobId=${jobId} totalCount=0 hasFilters=${Boolean(filters)}`);
      await kvs.set(jobKey(jobId), {
        status: 'done',
        result: {
          values: [], visibleAttributes: [], schemaId: config.schemaId, schemaName: config.schemaName,
          matchedAql, canEdit, totalCount: 0, hasMore: false, nextOffset: 0,
          countsByType: {}, loadedCountsByType: {}, typeCatalog: [],
          wasLimited: false, limitApplied, preLimitCount: 0,
          appliedFilterAql: filterAql || null,
        },
      });
      return;
    }

    const pageValues = allValues.slice(0, limit);
    const workspaceId = resolvedWorkspaceId || await getWorkspaceId(useAppAuth);
    const allTypeIds = [...new Set(allValues.map((a) => String(a.objectType?.id || '')).filter(Boolean))];

    const { mappedValues, columnsToShow } = await buildAssetPayload({
      values: pageValues, workspaceId, config, useAppAuth, ignoreHidden: false,
      typeIdsForColumns: allTypeIds,
    });

    const countsByType = {};
    const typeNameById = {};
    allValues.forEach((a) => {
      const tid = String(a.objectType?.id || '');
      if (!tid) return;
      countsByType[tid] = (countsByType[tid] || 0) + 1;
      if (!typeNameById[tid]) typeNameById[tid] = a.objectType?.name || '';
    });
    const typeCatalog = Object.keys(countsByType).map((tid) => ({
      objectTypeId: tid,
      objectTypeName: typeNameById[tid] || `Type ${tid}`,
      totalCount: countsByType[tid],
    }));
    const loadedCountsByType = {};
    pageValues.forEach((a) => {
      const tid = String(a.objectType?.id || '');
      if (!tid) return;
      loadedCountsByType[tid] = (loadedCountsByType[tid] || 0) + 1;
    });

    console.log(
      `[assetLoadConsumer] jobId=${jobId} DONE totalCount=${totalCount} pageValues=${pageValues.length} ` +
      `visibleAttributes=${columnsToShow.length} types=${typeCatalog.map((t) => t.objectTypeName).join(',')}`
    );

    await kvs.set(jobKey(jobId), {
      status: 'done',
      result: {
        values: mappedValues,
        visibleAttributes: columnsToShow,
        schemaId: config.schemaId,
        schemaName: config.schemaName,
        matchedAql,
        canEdit,
        totalCount,
        hasMore: limit < totalCount,
        nextOffset: pageValues.length,
        countsByType,
        loadedCountsByType,
        typeCatalog,
        wasLimited,
        limitApplied,
        preLimitCount,
        appliedFilterAql: filterAql || null,
      },
    });
  } catch (error) {
    // An unexpected exception, distinct from the expected/handled outcomes
    // above (those are all `status: 'done'` with an error folded into
    // `result`, matching what getUserAssets always returned) — this is a
    // genuine job failure the frontend should show a generic message for.
    console.error(`[assetLoadConsumer] jobId=${jobId} job failed:`, error);
    try {
      await kvs.set(jobKey(jobId), { status: 'error', error: error?.message || 'Asset load failed' });
    } catch (_) {
      // If even this write fails, the frontend's poll will eventually time
      // out on its own and show a generic "taking longer than expected"
      // message rather than hang forever.
    }
  }
};
