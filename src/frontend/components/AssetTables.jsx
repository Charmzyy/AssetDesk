import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Text,
  Inline,
  Stack,
  Box,
  Button,
  Spinner,
  SectionMessage,
  Lozenge,
  DynamicTable,
  xcss,
} from '@forge/react';
import { PAGE_SIZE, assetKeyStyle } from './shared';

// ─── Table components ─────────────────────────────────────────────────────────
// AllAssetsTable (the "All" tab — mixed types, shared columns only) and
// AssetTable (one per type tab — that type's columns, capped at
// PRIMARY_COLUMN_LIMIT; the full set is in each row's Details modal), plus
// the shared LoadMoreRow control and the useJumpToLoadedPage pagination
// hook.

// overflowX:auto here is defense-in-depth, not the primary mechanism —
// forcing the table wider than its container (via an explicit pixel
// minWidth) to make this scrollbar the one that engages was tried and
// reverted: this module renders `native` (no iframe — see manifest.yml),
// mounted straight inside Jira's own page, and Jira's page layout wraps it
// in a CSS Grid item that will NOT shrink below its content's max-content
// width regardless of any width/overflow we set on our own elements —
// that's a property of Jira's grid item itself, which we don't control or
// have a selector to target. Forcing extra width just blew out the real
// host page's layout instead of scrolling internally. So instead: never
// ask for more width than the container has — this property just catches
// the rare case where something is still a few pixels over.
const tableWrapStyle = xcss({ paddingTop: 'space.200', overflowX: 'auto', width: '100%' });

// ─── PRIMARY_COLUMN_LIMIT ─────────────────────────────────────────────────────
// Max ATTRIBUTE columns rendered in the grid (Name/Key/Type/actions are on
// top of this). The footer's width is fixed by Jira's page layout (see the
// tableWrapStyle comment above — we can't widen or horizontally scroll),
// so every column added past this point just shaves readable width off all
// the others; at ~13 columns cells were down to slivers with overlapping
// headers. Columns past the cap aren't lost: every row's Details modal
// (AssetDetailModal) shows the FULL attribute set stacked vertically, which
// scales to any schema size. Order matters — the first N visible
// attributes win a grid column, so the admin's attribute ordering in the
// Configure page doubles as the "most important first" ranking.
const PRIMARY_COLUMN_LIMIT = 5;

const columnsNoteStyle = xcss({ paddingTop: 'space.100' });

// Small subtle line above a table whose column set got capped — tells the
// user the remaining fields didn't vanish, they're behind Details.
const OverflowColumnsNote = ({ shown, total }) => {
  if (total <= shown) return null;
  return (
    <Box xcss={columnsNoteStyle}>
      <Text size="small" color="color.text.subtlest">
        Showing {shown} of {total} fields as columns — open Details on a row to see all fields.
      </Text>
    </Box>
  );
};

const loadMoreRowStyle = xcss({
  paddingTop: 'space.150',
  display: 'flex',
  justifyContent: 'center',
});

// ─── getSharedColumns ─────────────────────────────────────────────────────────
// Columns common to EVERY loaded type — drives the "All" tab's table
// headers, where a merged table sprouting sparse per-type columns would be
// worse than showing fewer. (The filter bar deliberately uses the opposite,
// union-based rule — see getFilterableColumns in shared.js.)

const getSharedColumns = (assets, visibleAttributes) => {
  if (assets.length === 0) return [];
  const typeIds = [
    ...new Set(assets.map((a) => String(a.objectTypeId || '')).filter(Boolean)),
  ];
  if (typeIds.length === 0) return visibleAttributes;
  if (typeIds.length === 1) {
    return visibleAttributes.filter(
      (col) => !col.objectTypeId || String(col.objectTypeId) === typeIds[0]
    );
  }
  const typeAttrSets = {};
  typeIds.forEach((tid) => {
    typeAttrSets[tid] = new Set(
      visibleAttributes
        .filter((col) => !col.objectTypeId || String(col.objectTypeId) === tid)
        .map((col) => col.attributeId)
    );
  });
  const firstSet = typeAttrSets[typeIds[0]];
  const sharedIds = [...firstSet].filter((id) =>
    typeIds.every((tid) => typeAttrSets[tid].has(id))
  );
  const seen = new Set();
  return visibleAttributes.filter((col) => {
    if (!sharedIds.includes(col.attributeId)) return false;
    if (seen.has(col.attributeId)) return false;
    seen.add(col.attributeId);
    return true;
  });
};

// ─── LoadMoreRow ──────────────────────────────────────────────────────────────
// Shared "Load more" control. Only rendered when there's actually another
// page to fetch. Disabled + spinner while a fetch is in flight so rapid
// double-clicks can't fire overlapping invocations for the same user.

export const LoadMoreRow = ({ hasMore, isLoading, onClick, remainingLabel }) => {
  if (!hasMore) return null;
  return (
    <Box xcss={loadMoreRowStyle}>
      <Button appearance="subtle" onClick={onClick} isDisabled={isLoading}>
        {isLoading ? (
          <Inline space="space.100" alignBlock="center">
            <Spinner size="small" />
            <Text size="small">Loading…</Text>
          </Inline>
        ) : (
          `Load more${remainingLabel ? ` (${remainingLabel})` : ''}`
        )}
      </Button>
    </Box>
  );
};

// ─── useJumpToLoadedPage ───────────────────────────────────────────────────
// DynamicTable's own page-number buttons only page through rows already
// sitting in the browser's memory — clicking "Load more" fetches a new
// PAGE_SIZE-sized chunk from the server (see App's handleLoadMore) but
// otherwise leaves the user on whatever page they were viewing, so the
// newly loaded rows are invisible until they manually click through to the
// last page. This drives DynamicTable as a CONTROLLED table (`page` +
// `onSetPage` instead of `defaultPage`) so it can jump to the freshly
// loaded page as soon as a "Load more" fetch finishes.
//
// Keyed off isLoadingMore's true→false transition rather than loadedCount
// alone, since a filter change also changes loadedCount (via a different
// loading flag, isAssetJobInFlight) and shouldn't be treated as "just
// loaded a new page" — filters replace the whole result set from scratch.
// On any other loadedCount change (filter/tab switch reusing this same
// component with a different asset list), the page is clamped back into
// range rather than jumped, so it never gets stranded past the last page.
const useJumpToLoadedPage = (isLoadingMore, loadedCount, rowsPerPage) => {
  const [page, setPage] = useState(1);
  const wasLoadingRef = useRef(false);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(loadedCount / rowsPerPage));
    if (wasLoadingRef.current && !isLoadingMore) {
      setPage(maxPage);
    } else {
      setPage((prev) => Math.min(prev, maxPage));
    }
    wasLoadingRef.current = isLoadingMore;
  }, [isLoadingMore, loadedCount, rowsPerPage]);

  return [page, setPage];
};

// ─── AllAssetsTable ───────────────────────────────────────────────────────────

export const AllAssetsTable = ({ assets, filteredAssets, visibleAttributes, canEdit, onEditClick, onViewClick, hasMore, isLoadingMore, onLoadMore, totalCount, isFiltered }) => {
  const displayAssets = filteredAssets ?? assets;
  const [page, setPage] = useJumpToLoadedPage(isLoadingMore, displayAssets.length, PAGE_SIZE);
  const sharedCols = useMemo(
    () => getSharedColumns(assets, visibleAttributes),
    [assets, visibleAttributes]
  );
  // Only the first N shared columns get grid space — the rest live in the
  // per-row Details modal (see PRIMARY_COLUMN_LIMIT above).
  const primaryCols = sharedCols.slice(0, PRIMARY_COLUMN_LIMIT);

  if (displayAssets.length === 0) {
    return (
      <SectionMessage appearance="info">
        <Text>{isFiltered ? 'No assets match your current filters.' : 'No assets found for your account.'}</Text>
      </SectionMessage>
    );
  }

  const head = {
    cells: [
      { key: 'label', content: 'Name', isSortable: true, width: 22 },
      { key: 'objectKey', content: 'Key', isSortable: true, width: 8 },
      { key: 'type', content: 'Type', isSortable: true, width: 10 },
      ...primaryCols.map((col) => ({
        key: `col-${col.attributeId}`,
        content: col.attributeName,
        isSortable: true,
      })),
      // Actions column is unconditional now — Details is available to every
      // caller (read-only), Edit joins it when the caller may edit.
      { key: 'actions', content: '', width: canEdit ? 12 : 8 },
    ],
  };

  const rows = displayAssets.map((asset, i) => ({
    key: `row-${asset.id || i}`,
    cells: [
      { key: `label-${i}`, content: <Text weight="medium">{asset.label || '—'}</Text> },
      {
        key: `okey-${i}`,
        content: (
          <Box xcss={assetKeyStyle}>
            <Text size="small" color="color.text.brand">{asset.objectKey || '—'}</Text>
          </Box>
        ),
      },
      {
        key: `type-${i}`,
        content: <Lozenge appearance="inprogress">{asset.objectTypeName || '—'}</Lozenge>,
      },
      ...primaryCols.map((col) => ({
        key: `col-${col.attributeId}-${i}`,
        content: <Text>{asset.visibleValues?.[col.attributeId] || '—'}</Text>,
      })),
      {
        key: `actions-${i}`,
        content: (
          <Inline space="space.050" alignBlock="center">
            <Button appearance="subtle" spacing="compact" onClick={() => onViewClick(asset)}>
              Details
            </Button>
            {canEdit && (
              <Button appearance="subtle" spacing="compact" onClick={() => onEditClick(asset)}>
                Edit
              </Button>
            )}
          </Inline>
        ),
      },
    ],
  }));

  const remaining = typeof totalCount === 'number' ? Math.max(totalCount - assets.length, 0) : null;

  return (
    <Box xcss={tableWrapStyle}>
      <OverflowColumnsNote shown={primaryCols.length} total={sharedCols.length} />
      <DynamicTable
        head={head}
        rows={rows}
        rowsPerPage={PAGE_SIZE}
        page={page}
        onSetPage={setPage}
        isFixedSize
        caption={
          typeof totalCount === 'number' && totalCount !== assets.length
            ? `Showing ${assets.length} of ${totalCount} asset${totalCount !== 1 ? 's' : ''}${isFiltered ? ' matching filters' : ''}`
            : `${assets.length} asset${assets.length !== 1 ? 's' : ''}${isFiltered ? ' matching filters' : ''}`
        }
      />
      {/* Filtering is server-side (see buildFilterAql in resolvers/shared.js),
          so pagination stays correct even while filtered — Load More fetches
          the next page of the same filtered result set instead of
          unfiltered data. Jumping to the newly loaded page on completion is
          handled by useJumpToLoadedPage above. */}
      <LoadMoreRow
        hasMore={hasMore}
        isLoading={isLoadingMore}
        onClick={onLoadMore}
        remainingLabel={remaining ? `${remaining} more` : ''}
      />
    </Box>
  );
};

// ─── AssetTable ───────────────────────────────────────────────────────────────

export const AssetTable = ({ assets, filteredAssets, columns, canEdit, onEditClick, onViewClick, hasMore, isLoadingMore, onLoadMore, totalCount, isFiltered }) => {
  const displayAssets = filteredAssets ?? assets;
  // Called unconditionally, ahead of the early return below — hooks can't
  // follow a conditional return.
  const [page, setPage] = useJumpToLoadedPage(isLoadingMore, displayAssets.length, PAGE_SIZE);
  // Only the first N columns get grid space — the rest live in the per-row
  // Details modal (see PRIMARY_COLUMN_LIMIT above).
  const primaryCols = columns.slice(0, PRIMARY_COLUMN_LIMIT);

  if (displayAssets.length === 0) {
    return (
      <SectionMessage appearance="info">
        <Text>{isFiltered ? 'No assets match your current filters.' : 'No assets of this type found for your account.'}</Text>
      </SectionMessage>
    );
  }

  const head = {
    cells: [
      { key: 'label', content: 'Name', isSortable: true, width: 20 },
      { key: 'objectKey', content: 'Key', isSortable: true, width: 10 },
      ...primaryCols.map((col) => ({
        key: `col-${col.attributeId}`,
        content: col.attributeName,
        isSortable: true,
      })),
      // Actions column is unconditional now — Details is available to every
      // caller (read-only), Edit joins it when the caller may edit.
      { key: 'actions', content: '', width: canEdit ? 14 : 8 },
    ],
  };

  const rows = displayAssets.map((asset, i) => ({
    key: `row-${asset.id || i}`,
    cells: [
      { key: `label-${i}`, content: <Text weight="medium">{asset.label || '—'}</Text> },
      {
        key: `okey-${i}`,
        content: (
          <Box xcss={assetKeyStyle}>
            <Text size="small" color="color.text.brand">{asset.objectKey || '—'}</Text>
          </Box>
        ),
      },
      ...primaryCols.map((col) => ({
        key: `col-${col.attributeId}-${i}`,
        content: <Text>{asset.visibleValues?.[col.attributeId] || '—'}</Text>,
      })),
      {
        key: `actions-${i}`,
        content: (
          <Inline space="space.050" alignBlock="center">
            <Button appearance="subtle" spacing="compact" onClick={() => onViewClick(asset)}>
              Details
            </Button>
            {canEdit && (
              <Button appearance="subtle" spacing="compact" onClick={() => onEditClick(asset)}>
                Edit
              </Button>
            )}
          </Inline>
        ),
      },
    ],
  }));

  const remaining = typeof totalCount === 'number' ? Math.max(totalCount - assets.length, 0) : null;

  return (
    <Box xcss={tableWrapStyle}>
      <OverflowColumnsNote shown={primaryCols.length} total={columns.length} />
      <DynamicTable
        head={head}
        rows={rows}
        // Must match PAGE_SIZE (the "Load more" batch size, see App's
        // handleLoadMore per-type top-up logic) — otherwise this
        // client-side page size and the server-side load increment drift
        // out of sync, e.g. rowsPerPage=20 against 10-row load batches
        // produced a 20/20/10 split instead of clean 10s.
        rowsPerPage={PAGE_SIZE}
        page={page}
        onSetPage={setPage}
        isFixedSize
        caption={
          typeof totalCount === 'number' && totalCount !== assets.length
            ? `Showing ${assets.length} of ${totalCount} asset${totalCount !== 1 ? 's' : ''}${isFiltered ? ' matching filters' : ''}`
            : `${assets.length} asset${assets.length !== 1 ? 's' : ''}${isFiltered ? ' matching filters' : ''}`
        }
      />
      <LoadMoreRow
        hasMore={hasMore}
        isLoading={isLoadingMore}
        onClick={onLoadMore}
        remainingLabel={remaining ? `${remaining} more` : ''}
      />
    </Box>
  );
};
