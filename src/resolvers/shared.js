import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import * as XLSX from 'xlsx';

// ─── Shared config/constants ──────────────────────────────────────────────────
// Used by index.js (portal-footer resolvers), adminResolvers.js (config-page
// resolvers), and exportAssets.js alike — the single source of truth for the
// KVS config key, page-size caps, and asset-limit clamping so all three agree.

export const CONFIG_KEY = 'assets-schema-config';

// KVS key for an async asset-load job's status/result — written by
// startAssetLoadJob (pending) and assetLoadConsumer.js (done/error), read
// by getAssetLoadJobResult while the frontend polls. See
// src/resolvers/assetLoadConsumer.js for why getUserAssets moved off the
// synchronous invoke() path entirely.
export const jobKey = (jobId) => `asset-load-job:${jobId}`;

// Same pattern, separate namespace, for the CSV ticket-attachment import
// job — see src/resolvers/csvImport.js / csvImportConsumer.js.
export const csvImportJobKey = (jobId) => `csv-import-job:${jobId}`;

// Same pattern again, for XLSX/PDF export — see
// src/resolvers/exportAssets.js / exportJobConsumer.js. Building a large
// PDF (per-cell height measurement in pdfkit) or re-running the
// ownership+filter AQL for a big filtered set can alone exceed the 25s
// invoke() ceiling, same as the asset-load case above.
export const exportJobKey = (jobId) => `export-job:${jobId}`;

// The generated file itself (base64) is what actually gets polled for, and
// it routinely exceeds KVS's 128 KB per-value cap — a 500-row PDF alone
// can run into hundreds of KB. So the consumer splits the base64 string
// across N of these chunk keys instead of putting it in exportJobKey's own
// value; getExportJobResult reassembles them into one string before
// returning (the invoke() response channel back to the frontend has no
// such cap — this chunking is purely to satisfy KVS's per-key limit while
// the job is in flight).
export const exportJobChunkKey = (jobId, index) => `export-job:${jobId}:chunk:${index}`;

const ASSET_LIST_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 10;

const DEFAULT_USER_ASSET_LIMIT = 500;
const MAX_USER_ASSET_LIMIT_CEILING = 5000; // sanity bound on the admin's own setting

export const clampUserAssetLimit = (limit) => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_USER_ASSET_LIMIT;
  return Math.min(Math.floor(n), MAX_USER_ASSET_LIMIT_CEILING);
};

export const clampPageSize = (limit) => {
  const n = Number(limit) || DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(n, 1), MAX_PAGE_SIZE);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const normaliseAssets = (data) =>
  data.values || data.objectEntries || data.results?.objectEntries || [];

export const escapeAqlValue = (v = '') =>
  String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const getAttributeId = (attribute) =>
  String(
    attribute.objectTypeAttributeId ||
    attribute.objectTypeAttribute?.id ||
    attribute.id ||
    ''
  );

export const getAttrValue = (attribute, raw = false) =>
  attribute.objectAttributeValues
    ?.map((v) =>
      raw
        ? v.status?.id || v.referencedObject?.id || v.value || ''
        : v.displayValue || v.value || v.referencedObject?.label || v.user?.displayName || ''
    )
    .filter(Boolean)
    .join(', ') || '';

export const deriveAttributeType = (def) => {
  if (def.type === 1) return 'object';
  if (def.type === 7) return 'status';
  if (def.defaultType?.id === 4)  return 'date';
  if (def.defaultType?.id === 10) return 'select';
  return 'text';
};

export const parseOptions = (s) =>
  typeof s === 'string' ? s.split(',').map((o) => o.trim()).filter(Boolean) : [];

export const isUnlicensedCaller = (context) => {
  const t = context?.accountType;
  return t === 'customer' || t === 'anonymous' || t === 'unlicensed';
};

// Shared user-profile resolver — used by getUserAssets, getUserAssetsPage,
// updateAssetAttribute, and diagnoseCaller.
export const resolveUser = async (accountId, useAppAuth) => {
  try {
    const res = await (useAppAuth ? api.asApp() : api.asUser())
      .requestJira(route`/rest/api/3/user?accountId=${accountId}`);
    if (res.ok) return await res.json();
  } catch (_) {}
  return { accountId, displayName: '', emailAddress: '' };
};

export const buildAqlFromRow = (row, schemaId, user) => {
  const { attribute, operator, userField, viaReference, referenceDirection } = row || {};
  if (!attribute || !operator || !userField) return null;

  const base = `objectSchemaId = ${schemaId}`;

  // Build just the inner "<attribute> <operator> <value>" condition first —
  // identical logic to before. Whether this gets used as-is or nested
  // inside a reference function is decided afterward.
  let innerCondition;
  if (userField === 'currentUser') {
    innerCondition = `${attribute} ${operator} currentUser()`;
  } else {
    const getters = {
      accountId:   (u) => escapeAqlValue(u.accountId    || ''),
      displayName: (u) => escapeAqlValue(u.displayName  || ''),
      email:       (u) => escapeAqlValue(u.emailAddress || ''),
    };
    const value = getters[userField]?.(user) ?? '';
    if (!value) return null;
    innerCondition = `${attribute} ${operator} "${value}"`;
  }

  if (!viaReference) {
    return `${base} AND ${innerCondition}`;
  }

  const refFn = referenceDirection === 'inbound' ? 'inboundReferences' : 'outboundReferences';
  return `${base} AND object HAVING ${refFn}(${innerCondition})`;
};

export const buildAqlCandidates = (aqlRows, schemaId, user, includeCurrentUser = false, filterAql = null) => {
  if (Array.isArray(aqlRows) && aqlRows.length > 0) {
    const built = aqlRows.map((row) => buildAqlFromRow(row, schemaId, user)).filter(Boolean);
    if (built.length > 0) {
      console.log(`[buildAqlCandidates] using ${built.length} custom AQL rule(s)`);
      // Each ownership candidate is already a fully-ANDed condition
      // (`objectSchemaId = X AND ...`), so tacking `AND <filterAql>` on
      // the end keeps it inside the same top-level AND chain — no extra
      // parens needed since there's no OR at this level.
      return filterAql ? built.map((aql) => `${aql} AND ${filterAql}`) : built;
    }
    console.warn('[buildAqlCandidates] custom rows present but none resolved — user fields may be empty');
    return [`objectSchemaId = ${schemaId} AND Name = "__no_match__"`];
  }

  console.log('[buildAqlCandidates] no custom rows configured — nothing to search');
  return [];
};

// ─── Filter AQL ───────────────────────────────────────────────────────────────
// Converts the frontend's filter state into a single AQL condition string
// that gets ANDed onto every ownership candidate. Returns null when there's
// nothing to filter on.
//
// Expected shape of `filters`:
//   {
//     nameQuery: string,
//     attributes: [{ attributeId, attributeName, attributeType, value }]
//   }
// `value` shape depends on attributeType, mirroring the frontend's
// activeFilters — { from, to } for date, comma-separated string for
// select/status, plain string otherwise. AQL attribute references use the
// attribute NAME (not ID), matching how config.aqlRows already reference
// attributes (see buildAqlFromRow).
// Safety gate for user-typed raw AQL (the Advanced AQL filter mode).
// The raw condition gets embedded as `... AND (<raw>)` on every ownership
// candidate — the wrapping parens are what keep it inside the AND, so a
// user can OR conditions together WITHOUT widening their results past
// their own assets. That guarantee only holds if the input can't close
// the wrapper: `x = 1) OR (y = 2` is balanced by count but its first `)`
// closes OUR paren, turning the query into `owner AND (x = 1) OR (y = 2)`
// — which, with AND binding tighter than OR, escapes the ownership scope
// entirely. So: walk the string tracking paren depth (ignoring parens
// inside double-quoted values, which are legitimate — Name = "TV (old)");
// reject if depth ever goes negative or doesn't end back at zero, or if a
// quote is left open.
export const isParenSafeAql = (raw) => {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuote) {
      if (ch === '\\') i++; // skip escaped char inside the quoted value
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !inQuote;
};

export const buildFilterAql = (filters, schemaId) => {
  if (!filters) return null;
  const conditions = [];

  const nameQuery = String(filters.nameQuery || '').trim();
  if (nameQuery) {
    const v = escapeAqlValue(nameQuery);
    // Assets AQL's `like` is a CONTAINS match — it does not use SQL-style
    // `%` wildcards, so the previous `like "%v%"` searched for the literal
    // percent-wrapped text. And `Key` is a core identifier field, not a
    // text attribute — `like` against it 400'd the ENTIRE query (every
    // ownership candidate), which surfaced as "error right after the
    // filtered refetch lands". Exact `=` on Key is the supported form,
    // and it fits how keys are actually searched: whole key, not a
    // fragment. Name keeps substring semantics via a bare `like`.
    conditions.push(`(Name like "${v}" OR Key = "${v}")`);
  }

  const attrFilters = Array.isArray(filters.attributes) ? filters.attributes : [];
  attrFilters.forEach(({ attributeName, attributeType, value }) => {
    const name = String(attributeName || '').trim();
    if (!name) return;
    // Defense in depth: a bare numeric string here means the frontend's
    // column lookup missed and fell back to the raw attributeId (invalid
    // AQL attribute reference — quoting it doesn't make "1147" a real
    // field name). Sending that through corrupts the ENTIRE query (every
    // ownership candidate 400s, not just this one filter), so skip it
    // instead and log for diagnosis rather than fail the whole request.
    if (/^\d+$/.test(name)) {
      console.warn(`[buildFilterAql] skipping filter with numeric-only attributeName "${name}" (likely an unresolved attributeId)`);
      return;
    }
    const escapedName = escapeAqlValue(name);

    if (attributeType === 'date') {
      const { from, to } = value || {};
      // Date handling note: values are ISO 'YYYY-MM-DD' strings from the
      // frontend DatePicker, compared lexicographically — same ordering as
      // chronological for that format. No timezone conversion is applied;
      // if attributes store full datetimes this comparison is date-only.
      if (from) conditions.push(`"${escapedName}" >= "${escapeAqlValue(from)}"`);
      if (to) conditions.push(`"${escapedName}" <= "${escapeAqlValue(to)}"`);
    } else if (attributeType === 'select' || attributeType === 'status') {
      // select: plain text option — LIKE/substring is safe and matches the
      // client-side narrowing pass (useFilteredAssets) for partially-typed
      // freeform fallback input.
      //
      // status: NOT plain text under the hood — Jira Assets status
      // attributes (type 7) are reference/lookup fields, and AQL's LIKE
      // wildcard matching does not reliably match against that kind of
      // field even though the rendered display value looks like ordinary
      // text (e.g. "In Stock"). Using LIKE here silently returned zero
      // results — the debounced server refetch would then wipe out the
      // correct client-narrowed view a moment after it briefly showed the
      // right rows, which read as "the filter applies then clears itself".
      // status values always come from a closed dropdown (see FilterBar's
      // statusOptions Select) rather than free typing, so there's no
      // partial-match use case to preserve — exact match is both correct
      // and safe here.
      const tokens = String(value || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tokens.length > 0) {
        const orParts = tokens.map((t) =>
          attributeType === 'status'
            ? `"${escapedName}" = "${escapeAqlValue(t)}"`
            : `"${escapedName}" like "${escapeAqlValue(t)}"`
        );
        conditions.push(tokens.length > 1 ? `(${orParts.join(' OR ')})` : orParts[0]);
      }
    } else {
      // Bare `like` — contains semantics in Assets AQL; no `%` wildcards
      // (see the nameQuery comment above).
      const v = String(value || '').trim();
      if (v) conditions.push(`"${escapedName}" like "${escapeAqlValue(v)}"`);
    }
  });

  // Advanced AQL mode: a raw user-typed condition, ANDed in alongside any
  // basic filters. The frontend validates with the same isParenSafeAql
  // rule before sending (that's the friendly-error path) — this check is
  // the actual security boundary for the paren-escape injection described
  // on isParenSafeAql above. escapeAqlValue can't apply here (the input IS
  // AQL); the wrapping parens + AND are what confine it to the caller's
  // own ownership scope, and a syntactically invalid condition just 400s
  // the query, which surfaces as a normal filter error.
  const rawAql = String(filters.rawAql || '').trim();
  if (rawAql) {
    if (isParenSafeAql(rawAql)) {
      conditions.push(`(${rawAql})`);
    } else {
      console.warn('[buildFilterAql] rejected rawAql with escaping/unbalanced parentheses or unclosed quote');
    }
  }

  if (conditions.length === 0) return null;
  const result = conditions.join(' AND ');
  console.log(`[buildFilterAql] nameQuery="${nameQuery}" attrFilters=${attrFilters.length} rawAql=${rawAql ? 'yes' : 'no'} => "${result}"`);
  return result;
};

// ─── Workspace & search ───────────────────────────────────────────────────────

export const getWorkspaceId = async (useAppAuth = false) => {
  const caller = useAppAuth ? api.asApp() : api.asUser();
  try {
    const r1 = await caller.requestJira(route`/rest/servicedeskapi/assets/workspace`);
    if (r1.ok) {
      const d = await r1.json();
      const id = d.workspaceId || d.values?.[0]?.workspaceId;
      if (id) return id;
    }
  } catch (_) {}
  try {
    const r2 = await caller.requestJira(route`/jsm/assets/workspace`);
    if (r2.ok) {
      const d = await r2.json();
      const id = d.workspaceId || d.values?.[0]?.workspaceId;
      if (id) return id;
    }
  } catch (_) {}
  throw new Error('Could not get Assets workspace.');
};

const ASSETS_API_PAGE_SIZE = 100;       // per-request page size
const ASSETS_API_TOTAL_CAP = 1000;      // platform ceiling per AQL query

const fetchAssetPage = async (caller, workspaceId, aql, startAt) => {
  const response = await caller.requestJira(
    route`/jsm/assets/workspace/${workspaceId}/v1/object/aql?startAt=${startAt}&maxResults=${ASSETS_API_PAGE_SIZE}&includeAttributes=true`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ qlQuery: aql }),
    }
  );
  if (!response.ok) {
    return { error: `Assets API error: ${response.status}`, status: response.status };
  }
  const data = await response.json();
  return { values: normaliseAssets(data), total: data.total };
};

// Fetches every page of one AQL query up to ASSETS_API_TOTAL_CAP.
//
// Page 1 is fetched alone because it's the only way to learn the reported
// `total` — everything after that is fired IN PARALLEL rather than one
// page at a time. This used to be a strictly sequential while-loop: with
// maxUserAssetLimit set anywhere near the 1000-object cap, that meant up
// to 10 successive round trips for JUST this one candidate, and
// searchAllCandidates runs several of these per request. Chained
// sequentially, that routinely blew past the 25-second ceiling Forge
// enforces on synchronous invoke()-backed resolver calls — not something
// manifest.yml's timeoutSeconds can raise for this call path (that only
// applies to async/queue consumer functions) — and a killed-mid-flight
// function is what surfaces in `forge tunnel` as
// ERR_IPC_CHANNEL_CLOSED. Firing all remaining pages at once turns "N
// sequential round trips" into "about 2 round trips' worth of latency,
// however large N is."
export const searchAssets = async (workspaceId, aql, useAppAuth = false) => {
  const caller = useAppAuth ? api.asApp() : api.asUser();

  const first = await fetchAssetPage(caller, workspaceId, aql, 0);
  if (first.error) {
    return { error: first.error, status: first.status };
  }

  const allValues = [...first.values];
  const total = typeof first.total === 'number' ? first.total : null;
  // Bounded by both the platform cap and whatever Jira reported as the
  // real total — no point requesting pages past either. If `total` is
  // missing from the response (rare), fall back to assuming up to the
  // cap; any pages beyond the real data just come back empty, which is
  // wasted request volume but NOT wasted latency since they're parallel.
  const targetCount = total !== null ? Math.min(total, ASSETS_API_TOTAL_CAP) : ASSETS_API_TOTAL_CAP;

  if (first.values.length === 0 || allValues.length >= targetCount) {
    return { values: allValues, total };
  }

  const offsets = [];
  for (let s = ASSETS_API_PAGE_SIZE; s < targetCount; s += ASSETS_API_PAGE_SIZE) {
    offsets.push(s);
  }

  const restResults = await Promise.all(
    offsets.map((startAt) => fetchAssetPage(caller, workspaceId, aql, startAt))
  );

  restResults.forEach((result, i) => {
    if (result.error) {
      // Matches the old sequential behavior's tolerance: a failed page
      // doesn't fail the whole query, it's just missing from the merge.
      console.warn(`[searchAssets] page fetch failed at startAt=${offsets[i]}: ${result.error} — continuing with what we have`);
      return;
    }
    allValues.push(...result.values);
  });

  if (allValues.length > ASSETS_API_TOTAL_CAP) {
    console.warn(
      `[searchAssets] hit the Assets platform's 1000-object total cap for one AQL query — ` +
      `there may be more matching objects than this single rule can report. ` +
      `Consider splitting into multiple narrower AQL rules. aql="${aql}"`
    );
  }

  return { values: allValues.slice(0, ASSETS_API_TOTAL_CAP), total };
};

export const searchAssetsSinglePage = async (workspaceId, aql, useAppAuth = false) => {
  const caller = useAppAuth ? api.asApp() : api.asUser();
  const response = await caller.requestJira(
    route`/jsm/assets/workspace/${workspaceId}/v1/object/aql?startAt=0&maxResults=${ASSETS_API_PAGE_SIZE}&includeAttributes=true`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ qlQuery: aql }),
    }
  );
  if (!response.ok) {
    return { error: `Assets API error: ${response.status}`, status: response.status };
  }
  const data = await response.json();
  return { values: normaliseAssets(data), total: data.total };
};

// Runs every ownership candidate AQL in parallel and merges results
// de-duplicated by asset ID. Replaces the old "first-rule-wins" approach
// that silently dropped assets matched by rules 2+.
export const searchAllCandidates = async (candidates, workspaceId, useAppAuth) => {
  const seenIds = new Set();
  const merged = [];
  const matchedAqls = [];
  let hadAnySuccess = false;
  let lastError = null;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { values: [], matchedAqls: [], hadAnySuccess: false, lastError: null };
  }

  const results = await Promise.all(
    candidates.map((aql) => searchAssets(workspaceId, aql, useAppAuth))
  );

  results.forEach((result, i) => {
    if (result.error) {
      console.warn(`[searchAllCandidates] AQL error skipping: ${candidates[i]} => ${result.error}`);
      lastError = result.error;
      return;
    }
    hadAnySuccess = true;
    const newValues = (result.values || []).filter((a) => {
      if (seenIds.has(String(a.id))) return false;
      seenIds.add(String(a.id));
      return true;
    });
    if (newValues.length > 0) {
      console.log(`[searchAllCandidates] "${candidates[i]}" => ${newValues.length} result(s)`);
      matchedAqls.push(candidates[i]);
      merged.push(...newValues);
    }
  });

  return { values: merged, matchedAqls, hadAnySuccess, lastError };
};

export const verifyAssetOwnership = async (objectId, user, config, workspaceId) => {
  const candidates = buildAqlCandidates(config.aqlRows, config.schemaId, user, false);
  const { values } = await searchAllCandidates(candidates, workspaceId, true);
  return values.some((a) => String(a.id) === String(objectId));
};

const CACHE_MAX_ASSETS = 1000; // above this, skip caching (KV 128KB safety)

export const assetListCacheKey = (accountId) => `asset-list-cache:${accountId}`;

const compressRawAsset = (asset) => ({
  id: asset.id,
  objectType: {
    id:   asset.objectType?.id   || '',
    name: asset.objectType?.name || '',
  },
});

const getCachedAssetList = async (accountId) => {
  try {
    const cached = await kvs.get(assetListCacheKey(accountId));
    if (!cached) return null;
    if (Date.now() - cached.fetchedAt > ASSET_LIST_CACHE_TTL_MS) return null;
    return cached;
  } catch (_) {
    return null;
  }
};

const setCachedAssetList = async (accountId, values, matchedAqls, workspaceId, extra = {}) => {

  if (values.length > CACHE_MAX_ASSETS) {
    console.log(
      `[setCachedAssetList] skipping cache write for ${accountId}: ` +
      `${values.length} assets exceeds CACHE_MAX_ASSETS (${CACHE_MAX_ASSETS}) ` +
      `— KV 128KB limit protection`
    );
    return;
  }
  try {
    await kvs.set(assetListCacheKey(accountId), {
      values: values.map(compressRawAsset), // slim stubs only — see comment above
      matchedAqls,
      workspaceId,
      fetchedAt: Date.now(),
      ...extra,
    });
  } catch (err) {
    // Cache write failures are non-fatal — next "load more" re-queries.
    // Log so admins can diagnose if it's a consistent KV size issue.
    console.warn(`[setCachedAssetList] write failed for ${accountId}:`, err?.message || err);
  }
};

export const resolveAssetList = async ({ accountId, config, user, useAppAuth, forceFresh = false, filters = null }) => {
  // Filtered requests always bypass the cache — the cache key is keyed
  // only on accountId, so a cached unfiltered (or differently-filtered)
  // result would silently leak through as "filtered" results otherwise.
  // Filtered lists also aren't written back to the cache, so an unfiltered
  // request right after a filtered one still gets the real unfiltered set.
  const hasFilters = Boolean(filters);

  if (!forceFresh && !hasFilters) {
    const cached = await getCachedAssetList(accountId);
    if (cached) {
      console.log(`[resolveAssetList] cache hit for ${accountId}: ${cached.values?.length} stubs`);
      return { ...cached, fromCache: true };
    }
  }

  const workspaceId = await getWorkspaceId(useAppAuth);
  const filterAql = hasFilters ? buildFilterAql(filters, config.schemaId) : null;
  const candidates = buildAqlCandidates(config.aqlRows, config.schemaId, user, !useAppAuth, filterAql);
  console.log(
    `[resolveAssetList] accountId=${accountId} hasFilters=${hasFilters} ` +
    `filterAql=${filterAql ? `"${filterAql}"` : 'null'} candidates=${candidates.length}`
  );
  const { values: mergedValues, matchedAqls, hadAnySuccess, lastError } =
    await searchAllCandidates(candidates, workspaceId, useAppAuth);
  console.log(
    `[resolveAssetList] accountId=${accountId} hasFilters=${hasFilters} ` +
    `=> merged=${mergedValues.length} hadAnySuccess=${hadAnySuccess} lastError=${lastError || 'none'}`
  );

  // Apply admin-configured user asset cap
  const limit = clampUserAssetLimit(config.maxUserAssetLimit);
  const wasLimited = mergedValues.length > limit;
  const values = wasLimited ? mergedValues.slice(0, limit) : mergedValues;

  if (wasLimited) {
    console.log(
      `[resolveAssetList] truncated ${mergedValues.length} → ${limit} ` +
      `(maxUserAssetLimit=${limit} for ${accountId})`
    );
  }

  if (hadAnySuccess && !hasFilters) {
    await setCachedAssetList(accountId, values, matchedAqls, workspaceId, {
      wasLimited,
      limitApplied: limit,
      preLimitCount: mergedValues.length,
    });
  }

  return {
    values, matchedAqls, hadAnySuccess, lastError, workspaceId, fromCache: false,
    wasLimited, limitApplied: limit, preLimitCount: mergedValues.length,
    // The filter-only AQL condition (null when unfiltered) — surfaced to the
    // frontend as "how these results were narrowed". Deliberately NOT the
    // full ownership AQL: that contains the admin's rule structure and the
    // user's own identity values, which is noise (and mildly leaky) to show
    // a portal customer. The filter part is exactly what they typed.
    filterAql,
  };
};

// Fetches attribute definitions for a SINGLE object type — the same REST
// call buildAssetPayload's Stage 1 makes per-type, factored out for
// callers that only ever need one type at a time (csvImport.js /
// csvImportConsumer.js matching CSV headers against attribute names).
//
// Excludes Key/Created/Updated but deliberately KEEPS Name — unlike
// buildAssetPayload's own BUILT_IN filter (which excludes Name too,
// because the main asset table renders it as a fixed column rather than a
// generic attribute), CSV import needs Name to remain matchable: it's a
// real, independently-settable Default/Text attribute on every object
// type (visible in the schema's attribute list with its own id), and it's
// very often the natural unique-key column for a CSV — Key, by contrast,
// is platform-generated on creation and can never be supplied for lookup.
//
// referenceObjectTypeId is included (unlike an earlier version of this
// helper) so csvImportConsumer.js can resolve "object"-type attributes
// (e.g. Model Name → Hardware Models) — Assets rejects a plain display
// name for those ("Samsung is not valid Object id or key"); the CSV's
// text has to be looked up in the REFERENCED object type first to find
// the actual object id to send. See csvImportConsumer.js's
// buildAttributesPayload.
export const fetchObjectTypeAttributeDefs = async (caller, workspaceId, objectTypeId) => {
  const BUILT_IN = new Set(['Key', 'Created', 'Updated']);
  try {
    const res = await caller.requestJira(
      route`/jsm/assets/workspace/${workspaceId}/v1/objecttype/${objectTypeId}/attributes?orderByName=false`
    );
    if (!res.ok) return [];
    const attrDefs = await res.json();
    return (Array.isArray(attrDefs) ? attrDefs : [])
      .filter((def) => !BUILT_IN.has(def.name))
      .map((def) => {
        const attributeType = deriveAttributeType(def);
        return {
          attributeId: String(def.id || ''),
          attributeName: def.name || '',
          attributeType,
          isEditable: def.editable !== false,
          referenceObjectTypeId: attributeType === 'object' ? String(def.referenceObjectTypeId || '') : '',
        };
      })
      .filter((d) => d.attributeId && d.attributeName);
  } catch (e) {
    console.error(`[fetchObjectTypeAttributeDefs] failed for objectType ${objectTypeId}:`, e);
    return [];
  }
};

// Parses CSV text into { headers, rows } — headers read explicitly via
// XLSX's raw header-row mode (so a header-only or empty CSV still reports
// its columns correctly, rather than relying on Object.keys(rows[0])
// which breaks with zero data rows), rows via the normal keyed
// sheet_to_json so each row is already a plain {header: value} object.
// Shared between csvImport.js (previewCsvImport) and csvImportConsumer.js
// so preview and the actual import see identical data.
export const parseCsvRows = (csvText) => {
  const workbook = XLSX.read(csvText, { type: 'string' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const headerRow = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
  const headers = headerRow.map((h) => String(h || '').trim()).filter(Boolean);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return { headers, rows };
};

// Cross-references CSV column headers against an object type's attribute
// definitions (case-insensitive exact name match — no fuzzy matching, so a
// mismatched header is surfaced in `unmatched` rather than guessed at).
// Shared between previewCsvImport (report-only) and csvImportConsumer.js
// (which needs the same mapping to actually build each row's attribute
// values), so what the agent previews is exactly what gets imported.
//
// There is no fixed "unique key" column name — "Serial Number" in the
// original use case was just an example of the CONCEPT, not a required
// literal column. Different object types use different attributes as
// their natural unique key (Asset Tag, Invoice Number, Serial Number,
// whatever that type actually has). By convention the FIRST CSV column is
// always used as the lookup key (see previewCsvImport/csvImportConsumer.js)
// — this function only reports what matched, not which one is "the" key.
export const matchCsvHeadersToAttributes = (headers, attributeDefs) => {
  const byNameLower = new Map(attributeDefs.map((a) => [a.attributeName.toLowerCase(), a]));
  const matched = [];
  const unmatched = [];
  headers.forEach((header) => {
    const attribute = byNameLower.get(header.toLowerCase());
    if (attribute) matched.push({ header, attribute });
    else unmatched.push(header);
  });
  return { matched, unmatched };
};

// Normalizes a CSV cell's raw text into the ISO 'YYYY-MM-DD' format Jira
// Assets' Date attributes require — handles three shapes seen in
// practice:
//   1. Already ISO ('2025-10-21...') — take the date portion as-is.
//   2. 'DD/MM/YYYY' (or single-digit day/month) — the common spreadsheet
//      display format, which Assets rejects outright ("21/10/2025 is not
//      valid (Date)").
//   3. A bare Excel date-serial number as text (e.g. '45417.000185…') —
//      happens when the source spreadsheet stored the cell as a raw
//      serial rather than formatted text; XLSX.SSF.parse_date_code
//      decodes it the same way Excel/SheetJS itself would, sidestepping
//      the 1900 leap-year quirk rather than hand-rolling epoch math.
// Anything else is passed through unchanged and left for the Assets API
// to reject with its own (at least accurate) error message.
export const normalizeDateValue = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return '';

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, d, m, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (parsed && parsed.y) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
    }
  }

  return text;
};

// ─── Asset payload builder ────────────────────────────────────────────────────

export const buildAssetPayload = async ({ values, workspaceId, config, useAppAuth, ignoreHidden = false, typeIdsForColumns = null }) => {
  const hiddenByObjectType = ignoreHidden ? {} : (config.hiddenByObjectType || {});
  const isHidden = (objectTypeId, attributeId) =>
    (hiddenByObjectType[objectTypeId] || []).map(String).includes(String(attributeId));

  const BUILT_IN = new Set(['Name', 'Key', 'Created', 'Updated']);
  const caller = useAppAuth ? api.asApp() : api.asUser();
  // objectTypeIdSet drives which object types we fetch attribute
  // definitions for (Stage 1) — and therefore which columns/options end up
  // in columnsToShow, since the fallback merge at the end of Stage 3 adds
  // every attrDefMap entry regardless of whether `values` (the page being
  // hydrated) actually contains an asset of that type yet.
  // typeIdsForColumns lets a caller pass a BROADER set (e.g. every type in
  // the full filtered/matched result, not just page 1) so columns for a
  // type-specific tab are known — with real names and select/status
  // option lists — even before any asset of that type has been paginated
  // into view. Without this, filtering/exporting on a type only reachable
  // via "Load more" would only ever see its raw attributeId, never a
  // resolved name.
  const objectTypeIdSet = new Set([
    ...values.map((a) => String(a.objectType?.id || '')).filter(Boolean),
    ...(Array.isArray(typeIdsForColumns) ? typeIdsForColumns.filter(Boolean) : []),
  ]);

  // Stage 1: fetch attribute definitions per object type
  const attrDefMap = new Map();
  await Promise.all(
    [...objectTypeIdSet].map(async (objectTypeId) => {
      try {
        const res = await caller.requestJira(
          route`/jsm/assets/workspace/${workspaceId}/v1/objecttype/${objectTypeId}/attributes?orderByName=false`
        );
        if (!res.ok) return;
        const attrDefs = await res.json();
        (Array.isArray(attrDefs) ? attrDefs : []).forEach((def) => {
          const defId = String(def.id || '');
          if (!defId || BUILT_IN.has(def.name) || isHidden(objectTypeId, defId)) return;
          const attrType = deriveAttributeType(def);
          attrDefMap.set(`${objectTypeId}:${defId}`, {
            attributeId: defId,
            attributeName: def.name || `Attribute ${defId}`,
            objectTypeId,
            objectTypeName: def.objectType?.name || '',
            attributeType: attrType,
            options: parseOptions(def.options),
            statusTypeIds: attrType === 'status'
              ? (Array.isArray(def.typeValueMulti) ? def.typeValueMulti.map(String) : [])
              : [],
            statusOptions: [],
            referenceObjectTypeId: attrType === 'object' ? String(def.referenceObjectTypeId || '') : '',
            isEditable: def.editable !== false,
          });
        });
      } catch (e) {
        console.error(`Failed to fetch attribute defs for objectType ${objectTypeId}:`, e);
      }
    })
  );

  // Stage 2: resolve status labels
  const statusLabelMap = new Map();
  values.forEach((asset) => {
    const objectTypeId = String(asset.objectType?.id || '');
    (asset.attributes || []).forEach((attr) => {
      const attrDef = attrDefMap.get(`${objectTypeId}:${getAttributeId(attr)}`);
      if (!attrDef || attrDef.attributeType !== 'status') return;
      (attr.objectAttributeValues || []).forEach((v) => {
        const sid = String(v.status?.id || '');
        const label = v.status?.name || v.displayValue || '';
        if (sid && label && !statusLabelMap.has(sid)) statusLabelMap.set(sid, label);
      });
    });
  });

  await Promise.all(
    [...attrDefMap.values()].filter((d) => d.attributeType === 'status').map(async (attrDef) => {
      const { attributeId, objectTypeId, statusTypeIds } = attrDef;
      const missingIds = statusTypeIds.filter((sid) => sid && !statusLabelMap.has(sid));
      if (missingIds.length > 0) {
        try {
          const probeRes = await caller.requestJira(
            route`/jsm/assets/workspace/${workspaceId}/v1/object/aql?startAt=0&maxResults=500&includeAttributes=true`,
            {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ qlQuery: `objectTypeId = ${objectTypeId} AND objectSchemaId = ${config.schemaId}` }),
            }
          );
          if (probeRes.ok) {
            normaliseAssets(await probeRes.json()).forEach((obj) => {
              (obj.attributes || []).forEach((attr) => {
                if (String(getAttributeId(attr)) !== String(attributeId)) return;
                (attr.objectAttributeValues || []).forEach((v) => {
                  const sid = String(v.status?.id || '');
                  const label = v.status?.name || v.displayValue || '';
                  if (sid && label && !statusLabelMap.has(sid)) statusLabelMap.set(sid, label);
                });
              });
            });
          }
        } catch (e) {
          console.warn(`AQL probe for status attr ${attributeId} failed:`, e);
        }
      }
      const idsToUse = statusTypeIds.length > 0 ? statusTypeIds : [...statusLabelMap.keys()];
      attrDef.statusOptions = idsToUse
        .filter((sid) => sid)
        .map((sid) => ({ value: sid, label: statusLabelMap.get(sid) || `Status ${sid}` }));
    })
  );

  // Stage 3: build column list
  const attributeMap = new Map();
  values.forEach((asset) => {
    const objectTypeId = String(asset.objectType?.id || '');
    (asset.attributes || []).forEach((attr) => {
      const id = getAttributeId(attr);
      const key = `${objectTypeId}:${id}`;
      if (!id || attributeMap.has(key)) return;
      const fromDef = attrDefMap.get(key);
      if (fromDef) attributeMap.set(key, fromDef);
    });
  });
  attrDefMap.forEach((def, key) => { if (!attributeMap.has(key)) attributeMap.set(key, def); });
  const columnsToShow = [...attributeMap.values()];

  // Stage 4: map raw assets to structured objects
  const mappedValues = values.map((asset) => {
    const objectTypeId = String(asset.objectType?.id || '');
    const attrById = {};
    const attrRawById = {};
    (asset.attributes || []).forEach((attr) => {
      const id = getAttributeId(attr);
      if (id) {
        attrById[id]    = getAttrValue(attr);
        attrRawById[id] = getAttrValue(attr, true);
      }
    });
    const typeCols = columnsToShow.filter((col) => col.objectTypeId === objectTypeId);
    return {
      id: asset.id,
      label: asset.label,
      objectKey: asset.objectKey,
      objectTypeId,
      objectTypeName: asset.objectType?.name || '',
      visibleValues: Object.fromEntries(typeCols.map((col) => [col.attributeId, attrById[col.attributeId]    || ''])),
      rawValues:     Object.fromEntries(typeCols.map((col) => [col.attributeId, attrRawById[col.attributeId] || ''])),
    };
  });

  return { mappedValues, columnsToShow };
};
