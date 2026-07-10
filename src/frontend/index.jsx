
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import ForgeReconciler, {
  Text,
  Inline,
  Stack,
  Heading,
  Box,
  SectionMessage,
  Button,
  Spinner,
  ModalTransition,
  xcss,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

import {
  PAGE_SIZE,
  getColumnsForType,
  getFilterableColumns,
  isFilterValueEmpty,
  buildFiltersPayload,
  useFilteredAssets,
} from './components/shared';
import EditAssetModal from './components/EditAssetModal';
import AssetDetailModal from './components/AssetDetailModal';
import ExportButtons from './components/ExportButtons';
import FilterBar from './components/FilterBar';
import { AllAssetsTable, AssetTable, LoadMoreRow } from './components/AssetTables';
import DiagnosticsPanel from './components/DiagnosticsPanel';

// ─── Portal footer entry point ────────────────────────────────────────────────
// This file is the manifest's `main` resource (see resources in
// manifest.yml — renaming it means updating the manifest). It holds the App
// component: all cross-component state (assets, pagination, filters, tabs,
// config staleness) plus the async asset-load job orchestration. The
// visual building blocks live under ./components/ — extracted when this
// file passed 2,500 lines; shared constants/helpers they and App both need
// are in ./components/shared.js.

// ─── Styles ───────────────────────────────────────────────────────────────────

const pageStyle = xcss({ padding: 'space.300' });

const infoBarStyle = xcss({
  backgroundColor: 'color.background.input',
  borderRadius: 'border.radius.200',
  padding: 'space.150',
  paddingInline: 'space.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
});

// ─── App ──────────────────────────────────────────────────────────────────────

const App = () => {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState({});
  const [assets, setAssets] = useState([]);
  const [visibleAttributes, setVisibleAttributes] = useState([]);
  const [canEditAssets, setCanEditAssets] = useState(false);
  const [loading, setLoading] = useState(true);
  const [needsConfiguration, setNeedsConfiguration] = useState(false);
  // Truncation transparency: when the admin's configured max-objects limit
  // cuts off a user's merged asset list, the asset-load job returns
  // wasLimited/limitApplied/preLimitCount instead of silently dropping the
  // extras. null until the first successful fetch resolves.
  const [assetLimitInfo, setAssetLimitInfo] = useState(null);
  const [error, setError] = useState(null);
  const [editingAsset, setEditingAsset] = useState(null);
  const [editColumns, setEditColumns] = useState([]);
  // Read-only Details modal — the tables cap how many attribute columns
  // they render (PRIMARY_COLUMN_LIMIT in AssetTables.jsx), so this is
  // where a user sees an asset's FULL attribute set. Same
  // asset+columns-for-its-type pattern as the edit modal above.
  const [viewingAsset, setViewingAsset] = useState(null);
  const [viewColumns, setViewColumns] = useState([]);
  const [diagnosis, setDiagnosis] = useState(null);
  const [isUnlicensed, setIsUnlicensed] = useState(false);

  // ── Filter state ────────────────────────────────────────────────────────
  // nameQuery: free-text against label + objectKey
  // activeFilters: { [attributeId]: filterValue } — one entry per column
  // filter; shape of filterValue depends on attribute type (see
  // isFilterValueEmpty / buildFiltersPayload in components/shared.js).
  // These drive TWO things: (1) an instant client-side narrowing pass via
  // useFilteredAssets for immediate feedback, and (2) a debounced
  // server-side refetch (see the effect below) that re-runs the
  // ownership+filter AQL and replaces `assets`/pagination with the real
  // filtered result set from the server.
  const [nameQuery, setNameQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState({});
  // Which attributes the user has PICKED (via the "+ Filters" popup) to
  // show a control for — Assets-search-style. Held here, not in FilterBar,
  // so the picks survive FilterBar re-mounts (tab switches etc.). An
  // attribute holding an active VALUE is treated as selected regardless
  // (see effectiveSelected in FilterBar).
  const [selectedFilterAttrIds, setSelectedFilterAttrIds] = useState([]);
  // Advanced AQL filter mode: 'basic' shows the search box + attribute
  // picker; 'aql' shows one raw-AQL input instead. Both kinds of filter
  // state stay live regardless of which mode's inputs are visible (they
  // simply AND together server-side), so switching modes never silently
  // drops an active filter — the chips row shows everything either way.
  const [filterMode, setFilterMode] = useState('basic');
  const [aqlQuery, setAqlQuery] = useState('');
  // The filter-only AQL condition the server actually applied to produce
  // the current result set (from buildFilterAql via the asset-load job) —
  // echoed under the filter bar as "Filtered by: …". Null when unfiltered.
  const [appliedFilterAql, setAppliedFilterAql] = useState(null);
  // Which tab is open on a multi-type result: 'all' or an objectTypeId.
  // Native @forge/react Tabs has no onChange/selected prop (see the custom
  // button-row tab bar below), so this is tracked by hand — it's what lets
  // the filter bar scope its attribute inputs to whichever tab is actually
  // showing instead of offering every type's attributes at once.
  const [activeTabId, setActiveTabId] = useState('all');

  // ── Pagination state ────────────────────────────────────────────────────
  // Per-type tabs each track their own { totalCount, nextOffset, hasMore }
  // (see paginationByType below) so a tab's "Load more" only ever loads
  // more of that exact type.
  //
  // The "All" tab is different: it walks the merged list in original AQL
  // order via its own independent offset (allPagination). This means
  // clicking "Load more" on All will eventually surface every type in
  // turn — including ones you haven't opened a tab for yet — rather than
  // jumping around to whichever type has the most left. The two systems
  // are independent: items loaded via All get merged into `assets` and
  // also bump the matching type's paginationByType entry (see below), so
  // switching to a per-type tab after using All never shows stale counts.
  const [paginationByType, setPaginationByType] = useState({});
  const [allPagination, setAllPagination] = useState({ totalCount: 0, nextOffset: 0, hasMore: false });
  const [loadingMoreTypeId, setLoadingMoreTypeId] = useState(null); // null | objectTypeId | 'all'
  // Full set of object types present in the result, known from page 1's
  // typeCatalog regardless of how many of each type have actually been
  // loaded into `assets` yet. This is what tabs render from — NOT
  // groupByType(assets) — so a type whose only loaded asset is still three
  // "Load more" clicks away still gets its tab shown immediately, just
  // with an empty/loading body until its assets arrive.
  // Shape: [{ objectTypeId, objectTypeName, totalCount }]
  const [typeCatalog, setTypeCatalog] = useState([]);
  const accountIdRef = useRef(null);
  const visibleAttributesRef = useRef([]);
  // Guards against out-of-order responses: loadFirstPage fires once on
  // mount (unfiltered) and again from the debounced filter-change effect
  // every time nameQuery/activeFilters settle. Neither call is cancelable,
  // so if an OLDER request (e.g. the initial unfiltered load, or a filter
  // request for a value the user has since changed again) happens to
  // resolve AFTER a newer one, it would overwrite the correct/current
  // state with stale data a moment later — the filter would visibly apply,
  // then a few seconds later appear to "revert" as the slower, stale
  // response lands. Each call captures the post-increment id; a response
  // only gets applied if it's still the latest request in flight.
  const latestLoadRequestIdRef = useRef(0);
  // True while a startAssetLoadJob/getAssetLoadJobResult poll is in
  // flight (see awaitAssetLoadJob below). getUserAssets used to be a
  // single synchronous invoke() — now that the actual search runs as a
  // background queue consumer (to avoid Forge's 25s invoke() ceiling for
  // large accounts), a filter-triggered reload can take a few seconds
  // instead of feeling instant, so this drives a small "Updating…"
  // affordance instead of leaving the UI looking unresponsive.
  const [isAssetJobInFlight, setIsAssetJobInFlight] = useState(false);

  // ── Collapsible footer widget ───────────────────────────────────────────
  // The portal footer is shared real estate — it shouldn't permanently take
  // up vertical space on every JSM portal page. Starts collapsed; expanding
  // is an explicit click, so the customer controls when the table appears.
  const [isExpanded, setIsExpanded] = useState(false);

  // ── Config staleness tracking ───────────────────────────────────────────
  // loadedConfigVersion: the version number that was active when THIS page
  // session fetched its data. It never changes after initial load.
  // latestConfigVersion: refreshed on a timer by polling getConfigVersion.
  // When the two differ, an admin saved new settings after this tab opened —
  // show a banner rather than silently refetching (silent refetch could
  // change what's on screen mid-edit, which is worse than asking the user).
  const [loadedConfigVersion, setLoadedConfigVersion] = useState(null);
  const [latestConfigVersion, setLatestConfigVersion] = useState(null);
  const configIsStale =
    loadedConfigVersion !== null &&
    latestConfigVersion !== null &&
    latestConfigVersion !== loadedConfigVersion;

  // ── awaitAssetLoadJob ────────────────────────────────────────────────────
  // getUserAssets moved off the synchronous invoke() path onto Forge's
  // Async Events API (see startAssetLoadJob/getAssetLoadJobResult in
  // resolvers/index.js and the consumer in resolvers/assetLoadConsumer.js)
  // — a large enough account could make the old single invoke() call
  // exceed Forge's 25-second ceiling for that call path, which isn't
  // raisable via manifest.yml for a direct invoke()-backed resolver. This
  // starts the job (fast — just enqueues) and polls for its result every
  // second. Returns the SAME shape getUserAssets always returned (so
  // everything below in loadFirstPage is unchanged), or null if a newer
  // loadFirstPage call has superseded this one mid-poll (loadFirstPage's
  // own staleness check right after this returns handles that the same
  // way it always has).
  const awaitAssetLoadJob = useCallback(async (accountId, filtersPayload, requestId) => {
    const start = await invoke('startAssetLoadJob', {
      accountId,
      limit: PAGE_SIZE,
      filters: filtersPayload || undefined,
    });
    if (start.error) return { values: [], error: start.error };

    const { jobId } = start;
    const POLL_INTERVAL_MS = 1000;
    const MAX_ATTEMPTS = 60; // ~60s ceiling on the client side

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (latestLoadRequestIdRef.current !== requestId) return null; // superseded
      const job = await invoke('getAssetLoadJobResult', { jobId });
      if (job.status === 'done') return job.result;
      if (job.status === 'error') return { values: [], error: job.error || 'Failed to load assets.' };
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    return { values: [], error: 'Loading your assets is taking longer than expected. Please try again.' };
  }, []);

  // ── loadFirstPage ────────────────────────────────────────────────────────
  // Fetches page 1 of assets and resets all the pagination/type-catalog
  // state from that response. Used both by the initial mount effect
  // (filtersPayload = null) and by the debounced filter-change effect below
  // (filtersPayload = the current filter state) — same shape of response
  // either way, since the backend applies filters to the AQL itself.
  const loadFirstPage = useCallback(async (accountId, unlicensed, filtersPayload) => {
    const requestId = ++latestLoadRequestIdRef.current;
    console.log(`[loadFirstPage] #${requestId} START filtersPayload=`, filtersPayload || null);
    setIsAssetJobInFlight(true);
    try {
      const assetData = await awaitAssetLoadJob(accountId, filtersPayload, requestId);

      // A newer loadFirstPage call has started since this one went out —
      // e.g. the user changed the filter again while this request was
      // still in flight. Applying this response now would overwrite
      // whatever the newer (more current) request already produced, or
      // will produce, with stale data. Discard it entirely. (awaitAssetLoadJob
      // also returns null directly for the same reason if superseded mid-poll.)
      if (assetData === null || latestLoadRequestIdRef.current !== requestId) {
        console.log(`[loadFirstPage] #${requestId} DISCARDED (stale — latest is #${latestLoadRequestIdRef.current})`);
        return;
      }
      console.log(
        `[loadFirstPage] #${requestId} APPLYING totalCount=${assetData.totalCount} ` +
        `values=${(assetData.values || []).length} visibleAttributes=${(assetData.visibleAttributes || []).length} ` +
        `error=${assetData.error || 'none'}`
      );

      if (assetData.error) {
        setError(assetData.error);
        // For unlicensed users on a genuinely-unfiltered zero-result load,
        // also run diagnosis so admin can see what's wrong. Skip while
        // filtered — zero matches for a filter isn't a config problem.
        if (unlicensed && !filtersPayload) {
          invoke('diagnoseCaller', { accountId }).then(setDiagnosis).catch(() => {});
        }
        return;
      }

      setError(null);
      setNeedsConfiguration(Boolean(assetData.needsConfiguration));
      setAssets(assetData.values || []);
      // A filtered fetch that matches zero assets legitimately comes back
      // with no attribute metadata (buildAssetPayload never runs — see the
      // asset-load consumer's totalCount===0 early return). Overwriting
      // visibleAttributes with [] in that case would yank the per-attribute
      // filter inputs (Status dropdown, date pickers, etc.) out from under
      // the user mid-filter — and since buildFiltersPayload looks up each
      // active filter's column by attributeId, the very next keystroke
      // would then fail that lookup and silently drop the filter,
      // collapsing the query down to name-only. Only clear the columns on
      // a genuinely unfiltered zero-result load; otherwise keep whatever
      // we already know so the filter bar stays usable.
      const newVisibleAttributes = assetData.visibleAttributes || [];
      if (newVisibleAttributes.length > 0 || !filtersPayload) {
        console.log(`[loadFirstPage] #${requestId} setVisibleAttributes(${newVisibleAttributes.length} cols)`);
        setVisibleAttributes(newVisibleAttributes);
      } else {
        console.log(`[loadFirstPage] #${requestId} KEEPING previous visibleAttributes (filtered zero-result response had none)`);
      }
      setCanEditAssets(Boolean(assetData.canEdit));
      // The filter-only AQL the server applied for THIS result set (null on
      // unfiltered loads) — drives FilterBar's "Filtered by:" line.
      setAppliedFilterAql(assetData.appliedFilterAql || null);
      setAssetLimitInfo(
        assetData.wasLimited
          ? { limitApplied: assetData.limitApplied, preLimitCount: assetData.preLimitCount }
          : null
      );

      // Build per-objectType pagination state from the counts the backend
      // computed off the full merged list (no extra Jira calls — just a
      // count). Each type independently knows its own total and whether
      // it has more pages, from the very first response. When filtered,
      // these counts already reflect the filtered set.
      const countsByType = assetData.countsByType || {};
      const loadedCountsByType = assetData.loadedCountsByType || {};
      const initialPagination = {};
      Object.keys(countsByType).forEach((typeId) => {
        const loaded = loadedCountsByType[typeId] || 0;
        initialPagination[typeId] = {
          totalCount: countsByType[typeId],
          nextOffset: loaded,
          hasMore: loaded < countsByType[typeId],
        };
      });
      setPaginationByType(initialPagination);

      // Tabs render from this — the FULL set of object types in the
      // result, with names, regardless of how many assets of each have
      // actually loaded yet.
      setTypeCatalog(Array.isArray(assetData.typeCatalog) ? assetData.typeCatalog : []);

      // "All" tab walks the merged list in original AQL order — its
      // offset comes straight from the job result's own totalCount/
      // hasMore/nextOffset (the un-scoped page-1 fetch), independent of
      // the per-type breakdown above.
      const initialTotal = typeof assetData.totalCount === 'number' ? assetData.totalCount : (assetData.values || []).length;
      setAllPagination({
        totalCount: initialTotal,
        nextOffset: assetData.nextOffset ?? (assetData.values || []).length,
        hasMore: Boolean(assetData.hasMore),
      });

      // If unlicensed user got 0 results on an unfiltered load, run
      // diagnosis to help troubleshoot.
      if (unlicensed && !filtersPayload && (assetData.values || []).length === 0 && !assetData.needsConfiguration) {
        invoke('diagnoseCaller', { accountId }).then(setDiagnosis).catch(() => {});
      }
    } catch (err) {
      if (latestLoadRequestIdRef.current !== requestId) return;
      setError(err?.message || 'Unexpected error loading assets.');
    } finally {
      // Only the current latest request clears the in-flight flag — if
      // this one got superseded, a newer request is still polling and
      // will clear it itself when IT finishes.
      if (latestLoadRequestIdRef.current === requestId) {
        setIsAssetJobInFlight(false);
      }
    }
  }, [awaitAssetLoadJob]);

  useEffect(() => {
    const init = async () => {
      try {
        const [ctx, userData, configData] = await Promise.all([
          view.getContext(),
          invoke('getUser'),
          invoke('getConfig'),
        ]);

        setUser(userData);
        setConfig(configData || {});
        setLoadedConfigVersion(Number(configData?.version) || 0);
        setLatestConfigVersion(Number(configData?.version) || 0);

        const accountType = ctx?.accountType;
        const unlicensed =
          accountType === 'customer' ||
          accountType === 'anonymous' ||
          accountType === 'unlicensed';
        setIsUnlicensed(unlicensed);
        accountIdRef.current = ctx?.accountId || null;

        // Page 1 only — fast path. The backend hydrates just PAGE_SIZE
        // assets here regardless of how many the user actually owns, so
        // this resolves quickly even for accounts with hundreds of assets.
        await loadFirstPage(ctx?.accountId, unlicensed, null);
      } catch (err) {
        setError(err?.message || 'Unexpected error loading assets.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [loadFirstPage]);

  // ── Filter-change refetch (server-side) ─────────────────────────────────
  // Debounced so rapid typing doesn't fire an invoke per keystroke. Resets
  // pagination and re-fetches page 1 with the current filter state applied
  // server-side — Load More afterward pages through that SAME filtered
  // result set (see handleLoadMore below), not the unfiltered one.
  // Skipped on the very first render (that's the mount effect's job) and
  // while the initial context/account load hasn't resolved yet.
  const isFirstFilterRunRef = useRef(true);
  useEffect(() => {
    if (isFirstFilterRunRef.current) {
      isFirstFilterRunRef.current = false;
      return;
    }
    if (!accountIdRef.current) return;

    console.log('[filter-effect] nameQuery/activeFilters/aqlQuery changed, arming 400ms debounce', {
      nameQuery, activeFilters, aqlQuery,
    });

    const timeoutId = setTimeout(() => {
      const filtersPayload = buildFiltersPayload(nameQuery, activeFilters, visibleAttributesRef.current, aqlQuery);
      console.log('[filter-effect] debounce fired, calling loadFirstPage with', filtersPayload || null);
      // Note: deliberately NOT resetting paginationByType/allPagination/
      // typeCatalog here. loadFirstPage() replaces all of that state
      // atomically once the fetch resolves — resetting it up front just
      // creates a window (the whole network round trip) where
      // sortedTypeCatalog is empty, which made the FilterBar fall back to
      // showing every attribute from every object type, undeduped, one
      // box per type instead of a single relevant set for the active tab.
      loadFirstPage(accountIdRef.current, isUnlicensed, filtersPayload);
    }, 400);

    return () => {
      console.log('[filter-effect] cleared pending debounce (filters changed again before it fired)');
      clearTimeout(timeoutId);
    };
    // isUnlicensed/loadFirstPage are stable-ish by the time filters can
    // change (auth state doesn't change mid-session); depending only on
    // the actual filter inputs keeps this from re-triggering on unrelated
    // renders (e.g. visibleAttributes updating after every fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameQuery, activeFilters, aqlQuery]);

  useEffect(() => {
    visibleAttributesRef.current = visibleAttributes;
  }, [visibleAttributes]);

  // ── Poll for config changes ─────────────────────────────────────────────
  // Runs every 60s. Only checks the small {version, updatedAt} object, not
  // the full asset list — so this is cheap even on a large site. We pause
  // polling while the browser tab is hidden (document.hidden) to avoid
  // burning Forge invocations on tabs nobody is looking at.
  useEffect(() => {
    if (loadedConfigVersion === null) return; // wait until initial load finishes

    const checkVersion = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const result = await invoke('getConfigVersion');
        if (typeof result?.version === 'number') {
          setLatestConfigVersion(result.version);
        }
      } catch (_) {
        // Silent — a failed version check should never interrupt the user.
      }
    };

    const intervalId = setInterval(checkVersion, 60000); // 60s
    return () => clearInterval(intervalId);
  }, [loadedConfigVersion]);

  const handleRefreshClick = useCallback(() => {
    // Forge-friendly full reload of this resource's iframe.
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  // ── Load more ─────────────────────────────────────────────────────────────
  // objectTypeId === null → "All" tab: pages the merged list in original
  //   AQL order via allPagination's own offset. This can surface assets of
  //   ANY type per click, including ones with no tab opened yet.
  // objectTypeId set → that tab's own scoped offset; only ever loads more
  //   of that exact type.
  //
  // Either way, the backend reuses its short-lived per-user cache
  // (populated by the initial asset-load job) so this normally doesn't
  // re-run AQL — only the new slice gets attribute-hydrated.
  const handleLoadMore = useCallback(async (objectTypeId) => {
    if (loadingMoreTypeId) return; // a fetch is already in flight

    const isAllTab = !objectTypeId;
    if (isAllTab) {
      if (!allPagination.hasMore) return;
    } else {
      const current = paginationByType[objectTypeId];
      if (!current || !current.hasMore) return;
    }

    setLoadingMoreTypeId(isAllTab ? 'all' : objectTypeId);
    try {
      const offset = isAllTab ? allPagination.nextOffset : paginationByType[objectTypeId].nextOffset;
      // Per-type tabs start life with whatever fraction of PAGE_SIZE landed
      // in the initial ALL-types-mixed page 1 fetch (e.g. 6 of 10 slots
      // happened to be Phones) — a flat PAGE_SIZE "Load more" on top of
      // that never lands on a clean multiple of PAGE_SIZE (6, 16, 26…).
      // Top up to the next page boundary on the first click for this type;
      // every click after that is already offset%PAGE_SIZE===0, so it's a
      // full PAGE_SIZE and stays clean (10, 20, 30…). The All tab's own
      // offset is never fractional this way (it's always advanced by
      // exactly what a prior PAGE_SIZE fetch returned), so it always
      // requests a full page.
      const remainder = offset % PAGE_SIZE;
      const limit = isAllTab || remainder === 0 ? PAGE_SIZE : PAGE_SIZE - remainder;
      const filtersPayload = buildFiltersPayload(nameQuery, activeFilters, visibleAttributesRef.current, aqlQuery);
      const pageData = await invoke('getUserAssetsPage', {
        accountId: accountIdRef.current,
        objectTypeId: isAllTab ? undefined : objectTypeId,
        offset,
        limit,
        filters: filtersPayload || undefined,
      });

      if (pageData.error) {
        setError(pageData.error);
        return;
      }

      const newAssets = pageData.values || [];
      setAssets((prev) => [...prev, ...newAssets]);

      if (Array.isArray(pageData.visibleAttributes) && pageData.visibleAttributes.length > 0) {
        setVisibleAttributes((prev) => {
          const seen = new Set(prev.map((c) => `${c.objectTypeId}:${c.attributeId}`));
          const merged = [...prev];
          pageData.visibleAttributes.forEach((col) => {
            const key = `${col.objectTypeId}:${col.attributeId}`;
            if (!seen.has(key)) { seen.add(key); merged.push(col); }
          });
          return merged;
        });
      }

      if (isAllTab) {
        setAllPagination({
          totalCount: typeof pageData.totalCount === 'number' ? pageData.totalCount : allPagination.totalCount,
          nextOffset: pageData.nextOffset ?? offset + newAssets.length,
          hasMore: Boolean(pageData.hasMore),
        });

        // An All-tab fetch can return a mix of types in one page. Bump each
        // affected type's own loaded count so its tab — if opened later —
        // shows correct progress instead of looking like it has fewer
        // loaded items than are actually already in `assets`.
        const loadedDeltaByType = {};
        newAssets.forEach((a) => {
          const tid = String(a.objectTypeId || '');
          if (!tid) return;
          loadedDeltaByType[tid] = (loadedDeltaByType[tid] || 0) + 1;
        });
        setPaginationByType((prev) => {
          const next = { ...prev };
          Object.entries(loadedDeltaByType).forEach(([tid, delta]) => {
            const existing = next[tid] || { totalCount: 0, nextOffset: 0, hasMore: false };
            const updatedOffset = existing.nextOffset + delta;
            next[tid] = {
              ...existing,
              nextOffset: updatedOffset,
              hasMore: updatedOffset < existing.totalCount,
            };
          });
          return next;
        });
      } else {
        const current = paginationByType[objectTypeId];
        setPaginationByType((prev) => ({
          ...prev,
          [objectTypeId]: {
            totalCount: typeof pageData.totalCount === 'number' ? pageData.totalCount : current.totalCount,
            nextOffset: pageData.nextOffset ?? offset + newAssets.length,
            hasMore: Boolean(pageData.hasMore),
          },
        }));
      }
    } catch (err) {
      setError(err?.message || 'Failed to load more assets.');
    } finally {
      setLoadingMoreTypeId(null);
    }
  }, [loadingMoreTypeId, paginationByType, allPagination, nameQuery, activeFilters, aqlQuery]);

  const grandTotalCount = allPagination.totalCount || assets.length;

  // ── Filter callbacks ─────────────────────────────────────────────────────
  const handleNameChange = useCallback((v) => setNameQuery(v), []);
  const handleFilterChange = useCallback((attrId, v) => {
    setActiveFilters((prev) => ({ ...prev, [attrId]: v }));
  }, []);
  // Check/uncheck an attribute in the "+ Filters" picker.
  // `currentlySelected` comes from FilterBar's effectiveSelected (picked ∪
  // has-active-value), not just this list — so unchecking an attribute
  // that's "selected" only by virtue of holding a value both removes any
  // explicit pick AND clears the value, ensuring an unchecked attribute
  // can never keep silently filtering with no visible control.
  const handleToggleFilterAttr = useCallback((attrId, currentlySelected) => {
    if (currentlySelected) {
      setSelectedFilterAttrIds((prev) => prev.filter((id) => id !== attrId));
      setActiveFilters((prev) => {
        if (!(attrId in prev)) return prev;
        const next = { ...prev };
        delete next[attrId];
        return next;
      });
    } else {
      setSelectedFilterAttrIds((prev) => (prev.includes(attrId) ? prev : [...prev, attrId]));
    }
  }, []);
  const handleClearFilters = useCallback(() => {
    setNameQuery('');
    setActiveFilters({});
    setSelectedFilterAttrIds([]); // full clean slate — bar returns to one compact row
    setAqlQuery('');
  }, []);
  const handleAqlChange = useCallback((v) => setAqlQuery(v), []);
  const handleFilterModeChange = useCallback((mode) => setFilterMode(mode), []);

  const isFiltered =
    nameQuery.trim() !== '' ||
    aqlQuery.trim() !== '' ||
    Object.values(activeFilters).some((v) => !isFilterValueEmpty(v));

  // Payload shape the backend's buildFilterAql expects — used for the
  // filtered export call (ExportButtons below). The actual browse/paginate
  // requests build their own copy inline (via visibleAttributesRef) so they
  // aren't coupled to this render's possibly-stale visibleAttributes.
  const filtersPayload = useMemo(
    () => buildFiltersPayload(nameQuery, activeFilters, visibleAttributes, aqlQuery),
    [nameQuery, activeFilters, visibleAttributes, aqlQuery]
  );

  // Filter columns for the "All" tab (multi-type view) — deliberately the
  // UNION of every type's attributes (see getFilterableColumns), not the
  // shared/intersection set the table headers use, so a type-specific
  // filter like Asset Status is still offered even when other types don't
  // have it.
  const filterColsForAllTab = useMemo(
    () => getFilterableColumns(visibleAttributes),
    [visibleAttributes]
  );

  // Filtered asset arrays — one for "All" tab, one per type tab.
  // These are memoized against the raw `assets` source of truth so
  // filter changes don't re-run the expensive per-tab split unnecessarily.
  // This is a light client-side narrowing pass for instant feedback
  // (see useFilteredAssets) — the server-side refetch (loadFirstPage /
  // handleLoadMore) is what actually determines `assets` and pagination.
  const filteredAllAssets = useFilteredAssets(assets, nameQuery, activeFilters, visibleAttributes);

  const filteredAssetsByTypeId = useMemo(() => {
    const map = {};
    filteredAllAssets.forEach((asset) => {
      const tid = String(asset.objectTypeId || '');
      if (!tid) return;
      if (!map[tid]) map[tid] = [];
      map[tid].push(asset);
    });
    return map;
  }, [filteredAllAssets]);

  const handleAssetSaved = useCallback((assetId, updates, rawUpdates) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        return {
          ...a,
          visibleValues: { ...a.visibleValues, ...updates },
          rawValues: { ...(a.rawValues || {}), ...(rawUpdates || {}) },
        };
      })
    );
  }, []);

  const handleEditClick = useCallback(
    (asset) => {
      const typeId = String(asset.objectTypeId || '');
      const cols = getColumnsForType(visibleAttributes, typeId);
      setEditColumns(cols);
      setEditingAsset(asset);
    },
    [visibleAttributes]
  );

  const handleModalClose = useCallback(() => {
    setEditingAsset(null);
    setEditColumns([]);
  }, []);

  const handleViewClick = useCallback(
    (asset) => {
      const typeId = String(asset.objectTypeId || '');
      const cols = getColumnsForType(visibleAttributes, typeId);
      setViewColumns(cols);
      setViewingAsset(asset);
    },
    [visibleAttributes]
  );

  const handleViewClose = useCallback(() => {
    setViewingAsset(null);
    setViewColumns([]);
  }, []);

  // "Edit asset" inside the Details modal — hand the SAME asset+columns
  // over to the edit modal so it feels like switching modes, not
  // re-opening from scratch.
  const handleViewToEdit = useCallback(() => {
    setViewingAsset(null);
    setEditColumns(viewColumns);
    setEditingAsset(viewingAsset);
  }, [viewingAsset, viewColumns]);

  // Group currently-loaded assets by objectTypeId (not name — IDs are the
  // authoritative key typeCatalog uses, and two types could theoretically
  // share a display name).
  const assetsByTypeId = useMemo(() => {
    const map = {};
    assets.forEach((asset) => {
      const tid = String(asset.objectTypeId || '');
      if (!tid) return;
      if (!map[tid]) map[tid] = [];
      map[tid].push(asset);
    });
    return map;
  }, [assets]);

  // The tab list itself comes from typeCatalog — the FULL set of types in
  // the result, known from page 1 — not from whichever types happen to
  // already have a loaded asset. A type with zero loaded assets still gets
  // a tab; that tab's body just shows a prompt to load more instead of
  // rows. Sorted by totalCount descending so the biggest categories (most
  // likely to already be loaded) appear first, matching the "All" tab's
  // walk order reasonably well.
  const sortedTypeCatalog = useMemo(
    () => [...typeCatalog].sort((a, b) => b.totalCount - a.totalCount),
    [typeCatalog]
  );

  // Every type name we've EVER seen this session, by id — survives filtered
  // refetches whose catalogs omit zero-match types. Lets the tab bar keep
  // rendering (and labeling) a tab whose type just filtered down to zero.
  const knownTypeNamesRef = useRef({});
  useEffect(() => {
    typeCatalog.forEach((t) => {
      if (t.objectTypeId) knownTypeNamesRef.current[t.objectTypeId] = t.objectTypeName;
    });
  }, [typeCatalog]);

  // If a RELOAD makes the currently-open tab's type disappear from the
  // catalog entirely, fall back to "All" — but only when UNFILTERED.
  // While filters are active, a missing type just means "zero matches for
  // this filter", and yanking the user to "All" mid-filtering loses the
  // context they were working in (which tab, which objectType scope on the
  // export buttons and the "Filtered by" line). The displayTypeCatalog
  // below keeps their tab rendered with a (0) count instead; clearing or
  // loosening the filter restores it in place.
  useEffect(() => {
    if (activeTabId === 'all') return;
    if (isFiltered) return;
    if (!sortedTypeCatalog.some((t) => t.objectTypeId === activeTabId)) {
      setActiveTabId('all');
    }
  }, [sortedTypeCatalog, activeTabId, isFiltered]);

  // What the tab bar actually renders: the filtered catalog, plus a
  // synthetic zero-count entry for the open tab when its type has no
  // matches in the current filtered result — see the effect above.
  const displayTypeCatalog = useMemo(() => {
    if (
      activeTabId === 'all' ||
      !isFiltered ||
      sortedTypeCatalog.some((t) => t.objectTypeId === activeTabId)
    ) {
      return sortedTypeCatalog;
    }
    return [
      ...sortedTypeCatalog,
      {
        objectTypeId: activeTabId,
        objectTypeName: knownTypeNamesRef.current[activeTabId] || `Type ${activeTabId}`,
        totalCount: 0,
      },
    ];
  }, [sortedTypeCatalog, activeTabId, isFiltered]);

  // What the export buttons should scope a FILTERED export to: the type of
  // whichever single-type view is on screen. With multiple types and the
  // "All" tab open, or with the custom tab bar pointed at a specific type,
  // that's activeTabId; with only ever one type total there's no tab bar at
  // all, but the view is still implicitly that one type. Null means "every
  // type the filter matches" (only possible while genuinely on "All").
  const currentViewObjectTypeId =
    displayTypeCatalog.length > 1
      ? (activeTabId !== 'all' ? activeTabId : null)
      : (displayTypeCatalog.length === 1 ? displayTypeCatalog[0].objectTypeId : null);
  const currentViewObjectTypeName =
    displayTypeCatalog.find((t) => t.objectTypeId === currentViewObjectTypeId)?.objectTypeName || null;

  if (loading) {
    return (
      <Box xcss={pageStyle}>
        <SectionMessage appearance="info">
          <Text>Loading your assets…</Text>
        </SectionMessage>
      </Box>
    );
  }

  if (error) {
    return (
      <Box xcss={pageStyle}>
        <Stack space="space.200">
          <SectionMessage appearance="error">
            <Stack space="space.100">
              <Heading as="h4">Error loading assets</Heading>
              <Text>{error}</Text>
            </Stack>
          </SectionMessage>
          {isUnlicensed && diagnosis && <DiagnosticsPanel diagnosis={diagnosis} />}
        </Stack>
      </Box>
    );
  }

  return (
    <Box xcss={pageStyle}>
      <Stack space="space.300">

        {/* ── Collapsible header / toggle ──────────────────────────────────
            Minimal card: a single ghost-style button on the right does the toggling.
            No heavy background fill, no primary-colored button — this is
            meant to sit quietly in the portal footer until clicked. */}
        <Box xcss={infoBarStyle}>
          <Inline alignBlock="center" spread="space-between">
            <Inline space="space.150" alignBlock="center">
              <Stack space="space.025">
                <Text weight="medium">My assets</Text>
                <Inline space="space.075" alignBlock="center">
                  <Text size="small" color="color.text.subtlest">
                    {(grandTotalCount || assets.length)} item{(grandTotalCount || assets.length) !== 1 ? 's' : ''}{canEditAssets ? ' editable' : ''}
                  </Text>

                  {!canEditAssets && isUnlicensed && assets.length > 0 && (
                    <>
                      <Text size="small" color="color.text.subtlest">·</Text>
                      <Text size="small" color="color.text.subtlest">view only</Text>
                    </>
                  )}

                  {/* Filter-triggered reloads run as a background queue
                      job (see awaitAssetLoadJob) rather than a single
                      instant invoke() call, so this gives visible feedback
                      instead of the table just silently updating a few
                      seconds later. */}
                  {isAssetJobInFlight && (
                    <>
                      <Text size="small" color="color.text.subtlest">·</Text>
                      <Inline space="space.050" alignBlock="center">
                        <Spinner size="small" />
                        <Text size="small" color="color.text.subtlest">Updating…</Text>
                      </Inline>
                    </>
                  )}
                </Inline>
              </Stack>
            </Inline>
            <Button
              appearance="default"
              spacing="compact"
              onClick={() => setIsExpanded((prev) => !prev)}
            >
              {isExpanded ? 'Collapse ▾' : 'Expand ▸'}
            </Button>
          </Inline>
        </Box>

        {/* ── Collapsible body ─────────────────────────────────────────────
            Everything else only renders while expanded. This keeps the
            footer's footprint to a single row in its default state, and
            also means the asset fetch result is never wasted — it was
            already loaded above; we're just choosing not to show it yet. */}
        {isExpanded && (
          <Stack space="space.300">

            {/* Signed-in-as / schema context — moved here from the collapsed
                header to keep that row minimal. Shown once, only while
                expanded, since it's reference info rather than a primary
                action a customer needs to see at a glance every time. */}
            <Inline space="space.100" alignBlock="center">
              <Text size="small" color="color.text.subtlest">
                Signed in as <Text size="small" weight="medium">{user?.displayName || '—'}</Text>
              </Text>
              {config.schemaName && (
                <>
                  <Text size="small" color="color.text.subtlest">·</Text>
                  <Text size="small" color="color.text.subtlest">
                    Schema <Text size="small" weight="medium">{config.schemaName}</Text>
                  </Text>
                </>
              )}
            </Inline>

            {/* Stale config banner — shown when an admin saved new settings
                after this page session was loaded. The user must click
                Refresh explicitly; we never silently swap data under them. */}
            {configIsStale && (
              <SectionMessage appearance="info" title="Settings updated">
                <Inline spread="space-between" alignBlock="center">
                  <Text>
                    An admin updated the AssetDesk configuration. Refresh to see the latest schema, columns, and permissions.
                  </Text>
                  <Button appearance="primary" spacing="compact" onClick={handleRefreshClick}>
                    Refresh now
                  </Button>
                </Inline>
              </SectionMessage>
            )}

            {/* Asset-limit truncation banner — shown when the admin's
                configured max-objects-per-user limit cut off this user's
                list. Deliberately explicit rather than silent: this exists
                specifically because an earlier, unrelated bug silently
                capped results at 100 with no indication to anyone that
                truncation was happening. This banner is the fix for that
                class of problem going forward — any future limit, however
                it's introduced, surfaces itself here instead of just
                quietly hiding assets. */}
            {assetLimitInfo && (
              <SectionMessage appearance="warning" title="Showing a limited number of assets">
                <Text>
                  Your account is linked to {assetLimitInfo.preLimitCount} assets, but this view is
                  currently capped at {assetLimitInfo.limitApplied}. Contact your administrator if you
                  need the full list.
                </Text>
              </SectionMessage>
            )}

            {/* View-only notice for portal customers when editing is disabled */}
            {!canEditAssets && isUnlicensed && assets.length > 0 && (
              <SectionMessage appearance="info">
                <Text>
                  You can view your assets here. To request changes, please contact your administrator or raise a support request.
                </Text>
              </SectionMessage>
            )}

            {needsConfiguration && (
              <SectionMessage appearance="warning">
                <Text>
                  A Jira admin needs to configure an Assets schema before your assets appear here.
                </Text>
              </SectionMessage>
            )}

            {/* Zero results while filtered is NOT the same problem as zero
                results unfiltered — the former just means the current
                filter combination is too narrow, and the fix is to adjust
                or clear filters (still visible below), not "go configure
                assets". Conflating the two behind one generic message is
                what made a too-narrow filter look like a config problem. */}
            {!needsConfiguration && assets.length === 0 && isFiltered && (
              <SectionMessage appearance="info">
                <Text>No assets match your current filters. Adjust or clear them below.</Text>
              </SectionMessage>
            )}

            {!needsConfiguration && assets.length === 0 && !isFiltered && !diagnosis && (
              <SectionMessage appearance="info">
                <Text>No assets found for your account in the configured schema.</Text>
              </SectionMessage>
            )}

            {!needsConfiguration && assets.length === 0 && !isFiltered && isUnlicensed && diagnosis && (
              <DiagnosticsPanel diagnosis={diagnosis} />
            )}

            {/* ── Export controls ──────────────────────────────────────────
                Above the tabs/table. Generation always runs server-side via
                startExportJob, which re-runs the ownership(+filter) AQL
                itself and exports the full matching set (up to
                maxUserAssetLimit) — the already-loaded `assets` here are
                only used to decide whether to show the buttons and to
                render the "will export N assets" hint. */}
            {!needsConfiguration && assets.length > 0 && (
              <ExportButtons
                assets={assets}
                filters={filtersPayload}
                isFiltered={isFiltered}
                schemaName={config.schemaName}
                totalCount={grandTotalCount}
                accountId={accountIdRef.current}
                scopeObjectTypeId={currentViewObjectTypeId}
                scopeObjectTypeName={currentViewObjectTypeName}
              />
            )}

            {/* ── Filter bar ───────────────────────────────────────────────
                Sits between export controls and the tabs/table. Typing here
                narrows the table instantly via a client-side pass over
                already-loaded assets AND (debounced) triggers a server-side
                refetch that re-runs the ownership+filter AQL, replacing
                `assets`/pagination with the true filtered result set.
                Columns shown depend on which tab is actually open
                (activeTabId, driven by the custom tab bar below since
                native Tabs can't report its selection): the "All" tab gets
                the union of every type's attributes (see
                getFilterableColumns), a specific type's tab gets only that
                type's own attributes — so e.g. a Phone's IMEI/Phone number
                filters don't show up while viewing the Red Hat Linux tab.
                Stays visible whenever a filter is active even if it
                currently matches zero assets — otherwise clearing/adjusting
                a too-narrow filter becomes impossible since the controls to
                do so would have disappeared along with the empty result. */}
            {!needsConfiguration && (assets.length > 0 || isFiltered) && (
              <FilterBar
                columns={
                  displayTypeCatalog.length === 1
                    ? getFilterableColumns(getColumnsForType(visibleAttributes, displayTypeCatalog[0].objectTypeId))
                    : (activeTabId === 'all'
                        ? filterColsForAllTab
                        : getFilterableColumns(getColumnsForType(visibleAttributes, activeTabId)))
                }
                nameQuery={nameQuery}
                activeFilters={activeFilters}
                selectedAttrIds={selectedFilterAttrIds}
                onToggleAttr={handleToggleFilterAttr}
                onNameChange={handleNameChange}
                onFilterChange={handleFilterChange}
                onClear={handleClearFilters}
                appliedFilterAql={appliedFilterAql}
                scopeObjectTypeName={currentViewObjectTypeName}
                filterMode={filterMode}
                onModeChange={handleFilterModeChange}
                aqlQuery={aqlQuery}
                onAqlChange={handleAqlChange}
              />
            )}

            {!needsConfiguration && (assets.length > 0 || displayTypeCatalog.length > 0) && (
              displayTypeCatalog.length > 1 ? (
                <Stack space="space.150">
                  {/* Custom controlled tab bar, NOT the native <Tabs> —
                      @forge/react's Tabs has no onChange/selected prop, so
                      there'd be no way to know which tab is open from
                      outside it. The filter bar (above) needs exactly
                      that, to scope its attribute inputs to whichever tab
                      is actually showing. Only the active tab's content is
                      rendered below, same one-panel-visible-at-a-time
                      behavior as Tabs, but with the selection tracked in
                      activeTabId instead of hidden inside the component. */}
                  <Inline space="space.100" shouldWrap>
                    <Button
                      appearance={activeTabId === 'all' ? 'primary' : 'subtle'}
                      spacing="compact"
                      onClick={() => setActiveTabId('all')}
                    >
                      All ({grandTotalCount || assets.length})
                    </Button>
                    {displayTypeCatalog.map((t) => (
                      <Button
                        key={t.objectTypeId}
                        appearance={activeTabId === t.objectTypeId ? 'primary' : 'subtle'}
                        spacing="compact"
                        onClick={() => setActiveTabId(t.objectTypeId)}
                      >
                        {t.objectTypeName} ({paginationByType[t.objectTypeId]?.totalCount ?? t.totalCount})
                      </Button>
                    ))}
                  </Inline>

                  {activeTabId === 'all' ? (
                    <AllAssetsTable
                      assets={assets}
                      filteredAssets={isFiltered ? filteredAllAssets : undefined}
                      visibleAttributes={visibleAttributes}
                      canEdit={canEditAssets}
                      onEditClick={handleEditClick}
                      onViewClick={handleViewClick}
                      hasMore={allPagination.hasMore}
                      isLoadingMore={loadingMoreTypeId === 'all'}
                      onLoadMore={() => handleLoadMore(null)}
                      totalCount={grandTotalCount || assets.length}
                      isFiltered={isFiltered}
                    />
                  ) : (() => {
                    const t = displayTypeCatalog.find((x) => x.objectTypeId === activeTabId);
                    // Type vanished from the catalog on an UNFILTERED load —
                    // the reset effect above will flip activeTabId back to
                    // 'all' on the next render. (While filtered, the
                    // synthetic zero-count entry in displayTypeCatalog
                    // keeps `t` defined — see the zero-match branch below.)
                    if (!t) return null;
                    const typeId = t.objectTypeId;
                    const groupAssets = assetsByTypeId[typeId] || [];
                    const filteredGroupAssets = filteredAssetsByTypeId[typeId] || [];
                    const typeCols = getColumnsForType(visibleAttributes, typeId);
                    const typePagination = paginationByType[typeId];
                    const nothingLoadedYet = groupAssets.length === 0;
                    // Filtered down to zero matches for THIS type — say so
                    // plainly. Without this branch the generic
                    // nothing-loaded state below would claim "0 assets
                    // found, not loaded yet" with a useless Load more
                    // button.
                    if (isFiltered && (typePagination?.totalCount ?? t.totalCount) === 0) {
                      return (
                        <SectionMessage appearance="info">
                          <Text>No {t.objectTypeName} assets match your current filters.</Text>
                        </SectionMessage>
                      );
                    }
                    return nothingLoadedYet ? (
                      <Stack space="space.150">
                        <SectionMessage appearance="info">
                          <Text>
                            {t.totalCount} {t.objectTypeName.toLowerCase()} asset{t.totalCount !== 1 ? 's' : ''} found, not loaded yet.
                          </Text>
                        </SectionMessage>
                        <LoadMoreRow
                          hasMore
                          isLoading={loadingMoreTypeId === typeId}
                          onClick={() => handleLoadMore(typeId)}
                          remainingLabel=""
                        />
                      </Stack>
                    ) : (
                      <AssetTable
                        assets={groupAssets}
                        filteredAssets={isFiltered ? filteredGroupAssets : undefined}
                        columns={typeCols}
                        canEdit={canEditAssets}
                        onEditClick={handleEditClick}
                        onViewClick={handleViewClick}
                        hasMore={Boolean(typePagination?.hasMore)}
                        isLoadingMore={loadingMoreTypeId === typeId}
                        onLoadMore={() => handleLoadMore(typeId)}
                        totalCount={typePagination?.totalCount ?? t.totalCount}
                        isFiltered={isFiltered}
                      />
                    );
                  })()}
                </Stack>
              ) : (
                (() => {
                  // Zero or one object type here — "the type" and "All"
                  // are the same set of assets, so pagination must come
                  // from that ONE source of truth (per-type state when a
                  // type exists, global allPagination only as a fallback
                  // for the edge case of zero assets/types).
                  const onlyTypeId = sortedTypeCatalog.length === 1 ? sortedTypeCatalog[0].objectTypeId : null;
                  const pagination = onlyTypeId ? paginationByType[onlyTypeId] : allPagination;
                  return (
                    <AssetTable
                      assets={assets}
                      filteredAssets={isFiltered ? filteredAllAssets : undefined}
                      columns={
                        onlyTypeId
                          ? getColumnsForType(visibleAttributes, onlyTypeId)
                          : visibleAttributes
                      }
                      canEdit={canEditAssets}
                      onEditClick={handleEditClick}
                      onViewClick={handleViewClick}
                      hasMore={Boolean(pagination?.hasMore)}
                      isLoadingMore={Boolean(loadingMoreTypeId)}
                      onLoadMore={() => handleLoadMore(onlyTypeId)}
                      totalCount={pagination?.totalCount ?? assets.length}
                      isFiltered={isFiltered}
                    />
                  );
                })()
              )
            )}

          </Stack>
        )}

      </Stack>

      <ModalTransition>
        {editingAsset && (
          <EditAssetModal
            asset={editingAsset}
            columns={editColumns}
            onClose={handleModalClose}
            onSaved={handleAssetSaved}
          />
        )}
      </ModalTransition>

      <ModalTransition>
        {viewingAsset && (
          <AssetDetailModal
            asset={viewingAsset}
            columns={viewColumns}
            canEdit={canEditAssets}
            onEdit={handleViewToEdit}
            onClose={handleViewClose}
          />
        )}
      </ModalTransition>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

export default App;
