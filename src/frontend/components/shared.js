import { useMemo } from 'react';
import { xcss } from '@forge/react';

// ─── Shared constants / helpers for the portal-footer frontend ────────────────
// Extracted from index.jsx when it was split into components/ — everything
// here is used by App (index.jsx) AND at least one extracted component, so
// it can't live in either without creating a circular import.

export const PAGE_SIZE = 10;

// The pill style around an asset's object key — shared by both tables and
// the edit modal's header.
export const assetKeyStyle = xcss({
  backgroundColor: 'color.background.brand.subtlest',
  borderRadius: 'border.radius.100',
  padding: 'space.050',
  paddingInline: 'space.100',
});

export const getColumnsForType = (visibleAttributes, objectTypeId) =>
  visibleAttributes.filter(
    (col) => !col.objectTypeId || String(col.objectTypeId) === String(objectTypeId)
  );

// ─── getFilterableColumns ─────────────────────────────────────────────────────
// getSharedColumns (AssetTables.jsx) intentionally shows only attributes
// common to every loaded type, because it drives the "All" tab's TABLE
// headers — a merged table sprouting sparse per-type columns would be worse
// than showing fewer. The filter bar has the opposite requirement: hiding a
// type's only Asset Status (or Purchase Date, etc.) filter just because
// some other type lacks that attribute would make it impossible to filter
// for it from the "All" tab. So this offers every attribute known on ANY
// visible type — deduped by NAME, not attributeId. Two different object
// types commonly each have their OWN "Asset Tag"/"Purchase Date"/etc.
// attribute — same name, different objectTypeAttributeId — and deduping by
// id let both through as separate boxes with an identical label. That's not
// just visual clutter: buildFilterAql (resolvers/shared.js) matches by the
// attribute's NAME, not its id, so both boxes would build the exact same
// AQL condition anyway — showing two meant picking a value in one while its
// "duplicate" sat there looking unset, which read as "my filter got applied
// twice" / values not sticking.
export const getFilterableColumns = (visibleAttributes) => {
  const seen = new Set();
  return (visibleAttributes || []).filter((col) => {
    const key = String(col.attributeName || col.attributeId || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ─── Filter value helpers ───────────────────────────────────────────────────
// activeFilters values are shaped differently per attribute type so the
// FilterBar can offer type-appropriate controls instead of one generic text
// box for everything:
//   - date attributes   → { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
//   - select/status      → comma-separated string of option values (OR match)
//   - everything else    → plain string (case-insensitive substring match)
// isFilterValueEmpty centralizes "is this filter set?" so callers don't
// need to know the per-type shape.

export const isFilterValueEmpty = (value) => {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'object') return !value.from && !value.to;
  return false;
};

// Client-side copy of the backend's isParenSafeAql (resolvers/shared.js —
// frontend bundles can't import from resolver code). Used both to gate
// what gets SENT (buildFiltersPayload drops unsafe raw AQL, matching the
// server's own rejection) and to show the inline "unbalanced parentheses"
// error in the AQL filter mode. The server-side check remains the actual
// security boundary; this one is UX.
export const isParenSafeAql = (raw) => {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuote) {
      if (ch === '\\') i++;
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

// ─── buildFiltersPayload ────────────────────────────────────────────────────
// Shapes nameQuery + activeFilters (+ the Advanced-AQL input) into the
// payload the backend's buildFilterAql expects: { nameQuery, attributes:
// [{ attributeId, attributeName, attributeType, value }], rawAql }.
// Returns null when nothing is active, so callers can pass
// `filters: buildFiltersPayload(...) || undefined` straight into invoke()
// and the backend treats "no filters" as unfiltered.
export const buildFiltersPayload = (nameQuery, activeFilters, columns, aqlQuery = '') => {
  const q = nameQuery.trim();
  const attributes = Object.entries(activeFilters)
    .filter(([, v]) => !isFilterValueEmpty(v))
    .map(([attributeId, value]) => {
      const col = (columns || []).find((c) => c.attributeId === attributeId);
      if (!col) {
        // Column metadata wasn't found for this attributeId — this can
        // happen if `columns` is a stale/incomplete snapshot (e.g. an
        // attribute only present on assets loaded via "Load more", which
        // never expands the page-1-derived visibleAttributes list). Rather
        // than fabricate an AQL attribute reference out of the bare ID
        // (which is invalid AQL syntax and previously 400'd the ENTIRE
        // query — silently dropping every filter, not just this one), skip
        // this one filter and keep going with whatever else is valid.
        console.warn(
          `[buildFiltersPayload] no column found for attributeId="${attributeId}" — dropping this filter. ` +
          `Known attributeIds: ${(columns || []).map((c) => c.attributeId).join(', ')}`
        );
        return null;
      }
      return {
        attributeId,
        attributeName: col.attributeName,
        attributeType: col.attributeType || 'text',
        value,
      };
    })
    .filter(Boolean);

  // Advanced AQL mode input — only forwarded when it passes the same
  // paren-safety rule the server enforces; an unsafe/incomplete condition
  // is treated as "not there yet" (the FilterBar shows the inline error).
  const rawAql = String(aqlQuery || '').trim();
  const safeRawAql = rawAql && isParenSafeAql(rawAql) ? rawAql : '';

  if (!q && attributes.length === 0 && !safeRawAql) return null;
  return { nameQuery: q, attributes, rawAql: safeRawAql };
};

// ─── useFilteredAssets ────────────────────────────────────────────────────────
// A light client-side narrowing pass over whatever is currently in `assets`.
// The server does the real filtering (see buildFiltersPayload / the
// `filters` param passed to the asset-load job & getUserAssetsPage) — this
// hook just re-applies the same predicate locally so the UI updates
// instantly on every keystroke instead of waiting for the debounced server
// round trip. Once the server response lands, `assets` is already the
// filtered set, so this becomes a no-op pass-through (matches everything
// already in it). The Advanced-AQL condition can't be evaluated locally, so
// it's ignored here — those results arrive only via the server pass.
export const useFilteredAssets = (assets, nameQuery, activeFilters, columns) =>
  useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    const filterEntries = Object.entries(activeFilters).filter(
      ([, v]) => !isFilterValueEmpty(v)
    );

    if (!q && filterEntries.length === 0) return assets;

    const typeByAttrId = new Map((columns || []).map((c) => [c.attributeId, c.attributeType]));

    return assets.filter((asset) => {
      // Name / key text search — case-insensitive substring match
      if (q) {
        const nameMatch =
          (asset.label || '').toLowerCase().includes(q) ||
          (asset.objectKey || '').toLowerCase().includes(q);
        if (!nameMatch) return false;
      }

      // Attribute filters — each active filter must be satisfied (AND logic
      // across attributes; within a select/status filter, OR across the
      // comma-separated options).
      for (const [attributeId, filterValue] of filterEntries) {
        const attrType = typeByAttrId.get(attributeId);

        if (attrType === 'date') {
          // visibleValues holds the human-formatted display string (e.g.
          // "Feb 16, 2025" — see the screenshot that caught this), which
          // does NOT compare correctly against the DatePicker's ISO
          // 'YYYY-MM-DD' bounds. rawValues carries the underlying value
          // (see getAttrValue(attr, true) in resolvers/shared.js), which
          // for date attributes is ISO-ish — truncate to the first 10
          // chars in case it's a full datetime rather than a bare date, so
          // the compare is apples-to-apples either way.
          const rawCell = asset.rawValues?.[attributeId] || '';
          const cellValue = rawCell.slice(0, 10);
          const { from, to } = filterValue || {};
          if (!cellValue) return false;
          if (from && cellValue < from) return false;
          if (to && cellValue > to) return false;
          continue;
        }

        const cellValue = asset.visibleValues?.[attributeId] || '';
        if (attrType === 'select' || attrType === 'status') {
          const tokens = String(filterValue || '')
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean);
          const cv = cellValue.toLowerCase();
          // status must match exactly here to stay consistent with the
          // server (see buildFilterAql in resolvers/shared.js — status
          // attributes are reference/lookup fields there, not plain text,
          // so the server uses `=` not `like`). Values always come from a
          // closed dropdown for status, so exact match loses nothing.
          // select stays substring for the freeform fallback input.
          const matches = attrType === 'status'
            ? tokens.some((t) => cv === t)
            : tokens.some((t) => cv.includes(t));
          if (tokens.length > 0 && !matches) return false;
        } else {
          const fv = String(filterValue || '').trim().toLowerCase();
          if (!cellValue.toLowerCase().includes(fv)) return false;
        }
      }

      return true;
    });
  }, [assets, nameQuery, activeFilters, columns]);
