import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import {
  CONFIG_KEY,
  clampUserAssetLimit,
  escapeAqlValue,
  deriveAttributeType,
  parseOptions,
  buildAqlFromRow,
  buildAqlCandidates,
  getWorkspaceId,
  searchAssets,
  searchAssetsSinglePage,
  searchAllCandidates,
  buildAssetPayload,
} from './shared';

// ─── Admin resolvers ───────────────────────────────────────────────────────────
// Everything here is only ever called from ConfigurePage.jsx (the
// jira:adminPage module) — schema/object-type discovery, saving the AQL
// ownership config, AQL rule validation/preview, and config reconciliation.
// Registered from index.js via registerAdminResolvers(resolver), the same
// pattern exportAssets.js uses for registerExportAssets(resolver) — one
// Resolver instance, one `resolver.getDefinitions()` export point in
// index.js, definitions just split across files for readability.

export const registerAdminResolvers = (resolver) => {
  resolver.define('getSchemas', async () => {
    try {
      const workspaceId = await getWorkspaceId(false);
      const response = await api.asUser().requestJira(
        route`/jsm/assets/workspace/${workspaceId}/v1/objectschema/list?startAt=0&maxResults=100&includeCounts=true`
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Could not get schemas: ${response.status} ${errorText}`);
      }
      const data = await response.json();
      const schemas = data.values || data.objectSchemas || data.schemas || [];
      return Array.isArray(schemas) ? schemas : [];
    } catch (err) {
      console.error('getSchemas error:', err);
      throw new Error(err?.message || 'getSchemas failed');
    }
  });

  resolver.define('getObjectTypes', async ({ payload }) => {
    if (!payload?.schemaId) return { objectTypes: [], error: 'schemaId is required' };
    try {
      const workspaceId = await getWorkspaceId(false);
      const response = await api.asUser().requestJira(
        route`/jsm/assets/workspace/${workspaceId}/v1/objectschema/${payload.schemaId}/objecttypes?excludeAbstract=false`
      );
      if (!response.ok) {
        const text = await response.text();
        return { objectTypes: [], error: `Could not get object types: ${response.status} ${text}` };
      }
      const data = await response.json();
      const rawList = Array.isArray(data) ? data : data.entries || data.values || data.objectTypes || [];
      const objectTypes = rawList
        .map((t) => ({ id: String(t.id || t.objectTypeId || ''), name: t.name || t.objectTypeName || '' }))
        .filter((t) => t.id);
      return { objectTypes };
    } catch (err) {
      console.error('getObjectTypes error:', err);
      return { objectTypes: [], error: err?.message || 'getObjectTypes failed' };
    }
  });

  resolver.define('getObjectTypeAttributes', async ({ payload }) => {
    const objectTypes = Array.isArray(payload?.objectTypes) ? payload.objectTypes : [];
    if (objectTypes.length === 0) return { groups: [] };
    try {
      const workspaceId = await getWorkspaceId(false);
      const BUILT_IN = new Set(['Name', 'Key', 'Created', 'Updated']);
      const groups = await Promise.all(
        objectTypes.map(async (objectType) => {
          try {
            const response = await api.asUser().requestJira(
              route`/jsm/assets/workspace/${workspaceId}/v1/objecttype/${objectType.id}/attributes?orderByName=false`
            );
            if (!response.ok) {
              return { objectTypeId: String(objectType.id), objectTypeName: objectType.name, attributes: [] };
            }
            const attrDefs = await response.json();
            return {
              objectTypeId: String(objectType.id),
              objectTypeName: objectType.name,
              attributes: (Array.isArray(attrDefs) ? attrDefs : [])
                .filter((attr) => !BUILT_IN.has(attr.name))
                .map((attr) => ({
                  attributeId:   String(attr.id),
                  attributeName: attr.name,
                  attributeType: deriveAttributeType(attr),
                  isEditable:    attr.editable !== false,
                  options:       parseOptions(attr.options),
                })),
            };
          } catch (err) {
            console.error(`Error fetching attrs for objectType ${objectType.id}:`, err);
            return { objectTypeId: String(objectType.id), objectTypeName: objectType.name, attributes: [] };
          }
        })
      );
      return { groups };
    } catch (err) {
      console.error('getObjectTypeAttributes error:', err);
      return { groups: [], error: err?.message || 'getObjectTypeAttributes failed' };
    }
  });

  resolver.define('saveConfig', async ({ payload }) => {
    if (!payload?.schemaId) throw new Error('schemaId is required');

    const rawHidden = payload.hiddenByObjectType;
    const hiddenByObjectType =
      rawHidden && typeof rawHidden === 'object' && !Array.isArray(rawHidden)
        ? Object.fromEntries(
            Object.entries(rawHidden).map(([typeId, ids]) => [
              String(typeId),
              (Array.isArray(ids) ? ids : []).map(String),
            ])
          )
        : {};

    const aqlRows = (Array.isArray(payload.aqlRows) ? payload.aqlRows : [])
      .filter((r) => r && r.attribute && r.operator && r.userField)
      .map((r) => ({
        attribute: String(r.attribute).trim(),
        operator:  String(r.operator).trim(),
        userField: String(r.userField).trim(),
        // Reference-traversal ownership (see buildAqlFromRow). Both optional
        // and default to off/outbound — existing saved rows without these
        // keys behave exactly as before.
        viaReference: Boolean(r.viaReference),
        referenceDirection: r.referenceDirection === 'inbound' ? 'inbound' : 'outbound',
      }));

    const previous = (await kvs.get(CONFIG_KEY)) || {};
    const nextVersion = (Number(previous.version) || 0) + 1;

    const config = {
      schemaId:        String(payload.schemaId),
      schemaName:      payload.schemaName || '',
      hiddenByObjectType,
      aqlRows,
      allowPortalEdit: Boolean(payload.allowPortalEdit),
      editMode:        payload.editMode === 'userAccount' ? 'userAccount' : 'serviceAccount',
      maxUserAssetLimit: clampUserAssetLimit(payload.maxUserAssetLimit),
      version:         nextVersion,
      updatedAt:       new Date().toISOString(),
    };

    await kvs.set(CONFIG_KEY, config);
    return config;
  });

  resolver.define('validateAql', async ({ payload }) => {
    const { row, schemaId } = payload || {};
    if (!row || !schemaId) return { error: 'row and schemaId are required' };
    try {
      const workspaceId = await getWorkspaceId(false);
      const meRes = await api.asUser().requestJira(route`/rest/api/3/myself`);
      if (!meRes.ok) return { error: 'Could not resolve your user profile for validation.' };
      const me = await meRes.json();
      const aql = buildAqlFromRow(row, schemaId, {
        accountId:    me.accountId    || '',
        displayName:  me.displayName  || '',
        emailAddress: me.emailAddress || '',
      });
      if (!aql) {
        return { error: 'Could not build AQL — make sure attribute, operator, and user field are all filled in.' };
      }
      console.log('[validateAql] running:', aql);
      const result = await searchAssets(workspaceId, aql, false);
      if (result.error) return { error: result.error, aql };
      return {
        aql,
        count: result.values?.length ?? 0,
        warning: result.values?.length === 0
          ? 'Query ran successfully but returned 0 results. This may be correct if no assets are assigned to you.'
          : null,
      };
    } catch (err) {
      console.error('[validateAql] error:', err);
      return { error: err?.message || 'Validation failed' };
    }
  });

  resolver.define('searchAssetUsers', async ({ payload }) => {
    const { schemaId, query } = payload;
    try {
      const workspaceId = await getWorkspaceId(false);
      const aql = `objectSchemaId = ${schemaId} AND objectType = "User" AND Name like "${escapeAqlValue(query)}"`;
      console.log('[searchAssetUsers] AQL:', aql);

      const result = await searchAssetsSinglePage(workspaceId, aql, false);
      console.log('[searchAssetUsers] found:', result.values?.length, 'of', result.total ?? '?');
      return { values: result.values || [], total: result.total };
    } catch (err) {
      console.error('[searchAssetUsers] error:', err);
      return { values: [], error: err?.message };
    }
  });

  resolver.define('getAssetsForUser', async ({ payload }) => {
    const { schemaId, displayName, accountId } = payload;
    try {
      const workspaceId = await getWorkspaceId(false);
      const config = (await kvs.get(CONFIG_KEY)) || {};
      const user = { accountId: accountId || '', displayName: displayName || '', emailAddress: '' };
      const candidates = buildAqlCandidates(config.aqlRows, schemaId, user, false);

      console.log(`[getAssetsForUser] ${candidates.length} candidate(s) for "${displayName}" (accountId=${accountId})`);

      const { values, matchedAqls } = await searchAllCandidates(candidates, workspaceId, false);
      if (values.length === 0) return { values: [], visibleAttributes: [], matchedAql: null };

      const { mappedValues, columnsToShow } = await buildAssetPayload({
        values,
        workspaceId,
        config: { ...config, schemaId },
        useAppAuth: false,
        ignoreHidden: true,
      });

      return { values: mappedValues, visibleAttributes: columnsToShow, matchedAql: matchedAqls[0] || null, canEdit: true };
    } catch (err) {
      console.error('[getAssetsForUser] error:', err);
      return { values: [], visibleAttributes: [], error: err?.message };
    }
  });

  resolver.define('reconcileConfig', async () => {
    try {
      const config = (await kvs.get(CONFIG_KEY)) || {};
      if (!config.schemaId) return { schemaReachable: false, notConfigured: true };

      const workspaceId = await getWorkspaceId(false);
      const BUILT_IN = new Set(['Name', 'Key', 'Created', 'Updated']);

      const schemaRes = await api.asUser().requestJira(
        route`/jsm/assets/workspace/${workspaceId}/v1/objectschema/${config.schemaId}`
      );
      if (!schemaRes.ok) {
        return {
          schemaReachable: false,
          schemaId: config.schemaId,
          schemaName: config.schemaName,
          ghostObjectTypeIds: [],
          ghostAttributeIds: {},
          staleFlagCount: 1,
          liveObjectTypes: [],
          liveAttributesByType: {},
        };
      }

      const typesRes  = await api.asUser().requestJira(
        route`/jsm/assets/workspace/${workspaceId}/v1/objectschema/${config.schemaId}/objecttypes?excludeAbstract=false`
      );
      const typesData = typesRes.ok ? await typesRes.json() : [];
      const rawTypes  = Array.isArray(typesData) ? typesData : typesData.entries || typesData.values || typesData.objectTypes || [];
      const liveObjectTypes = rawTypes
        .map((t) => ({ id: String(t.id || ''), name: t.name || '' }))
        .filter((t) => t.id);
      const liveTypeIdSet = new Set(liveObjectTypes.map((t) => t.id));

      // Bounded concurrency, not one giant Promise.all over every object
      // type at once — a schema with many types (this app has seen
      // reports of a dozen-plus) firing that many parallel attribute
      // fetches risks tripping Jira's own rate limiting. A rate-limited
      // (or otherwise failed) fetch used to silently become an EMPTY
      // attribute list for that type, which made every one of its
      // already-hidden attributes look "deleted" — a false-positive drift
      // report that got worse the more object types a schema had, and
      // that "Clean up stale config" would then happily strip from the
      // saved config even though the attributes were never actually
      // removed from the live schema.
      const RECONCILE_CHUNK_SIZE = 5;
      const liveAttributesByType = {};
      const fetchFailedTypeIds = new Set();

      for (let i = 0; i < liveObjectTypes.length; i += RECONCILE_CHUNK_SIZE) {
        const chunk = liveObjectTypes.slice(i, i + RECONCILE_CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (objType) => {
            try {
              const attrRes = await api.asUser().requestJira(
                route`/jsm/assets/workspace/${workspaceId}/v1/objecttype/${objType.id}/attributes?orderByName=false`
              );
              if (!attrRes.ok) {
                fetchFailedTypeIds.add(objType.id);
                return;
              }
              const attrDefs = await attrRes.json();
              liveAttributesByType[objType.id] = (Array.isArray(attrDefs) ? attrDefs : [])
                .filter((a) => !BUILT_IN.has(a.name))
                .map((a) => ({ id: String(a.id || ''), name: a.name || '' }));
            } catch {
              fetchFailedTypeIds.add(objType.id);
            }
          })
        );
      }

      const storedHidden      = config.hiddenByObjectType || {};
      const ghostObjectTypeIds = Object.keys(storedHidden).filter((id) => !liveTypeIdSet.has(id));
      const ghostAttributeIds  = {};
      let staleFlagCount       = ghostObjectTypeIds.length;

      for (const typeId of Object.keys(storedHidden)) {
        if (!liveTypeIdSet.has(typeId)) continue;
        // Couldn't verify this type's live attributes this time (fetch
        // failed) — treat it as unknown, not as "everything's deleted."
        // Re-check will retry; this typeId's stored hidden attrs are left
        // alone rather than being false-flagged as ghosts.
        if (fetchFailedTypeIds.has(typeId)) continue;
        const liveAttrIds = new Set((liveAttributesByType[typeId] || []).map((a) => a.id));
        const ghosts = (storedHidden[typeId] || [])
          .filter((id) => !liveAttrIds.has(id))
          .map((id) => ({ id, name: `Unknown attribute (ID: ${id})` }));
        if (ghosts.length > 0) { ghostAttributeIds[typeId] = ghosts; staleFlagCount += ghosts.length; }
      }

      const unverifiedObjectTypeIds = [...fetchFailedTypeIds];

      return { schemaReachable: true, schemaId: config.schemaId, schemaName: config.schemaName,
        ghostObjectTypeIds, ghostAttributeIds, staleFlagCount, liveObjectTypes, liveAttributesByType,
        unverifiedObjectTypeIds };
    } catch (err) {
      console.error('[reconcileConfig] error:', err);
      return { error: err?.message || 'Reconciliation failed', schemaReachable: false };
    }
  });

  resolver.define('applyReconciliation', async ({ payload }) => {
    const { ghostObjectTypeIds = [], ghostAttributeIds = {} } = payload || {};
    try {
      const config  = (await kvs.get(CONFIG_KEY)) || {};
      const stored  = config.hiddenByObjectType || {};
      const cleaned = Object.fromEntries(
        Object.entries(stored).filter(([typeId]) => !ghostObjectTypeIds.includes(typeId))
      );
      for (const [typeId, ghosts] of Object.entries(ghostAttributeIds)) {
        if (!cleaned[typeId]) continue;
        const ghostIds = new Set(ghosts.map((g) => g.id));
        cleaned[typeId] = cleaned[typeId].filter((id) => !ghostIds.has(id));
      }
      const updatedConfig = { ...config, hiddenByObjectType: cleaned };
      await kvs.set(CONFIG_KEY, updatedConfig);
      console.log('[applyReconciliation] cleaned config saved. Removed types:', ghostObjectTypeIds, 'attrs:', ghostAttributeIds);
      return { success: true, config: updatedConfig };
    } catch (err) {
      console.error('[applyReconciliation] error:', err);
      return { success: false, error: err?.message || 'Failed to apply reconciliation' };
    }
  });
};
