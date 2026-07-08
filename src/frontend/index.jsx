
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import ForgeReconciler, {
  Text,
  Inline,
  DynamicTable,
  Stack,
  Heading,
  Box,
  SectionMessage,
  Button,
  Badge,
  Lozenge,
  Textfield,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
  ModalTransition,
  Label,
  Select,
  DatePicker,
  Spinner,
  Popup,
  Checkbox,
  xcss,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

// ─── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

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
// ask for more width than the container has (see DynamicTable's own
// column-shrinking in AllAssetsTable/AssetTable) — this property just
// catches the rare case where something is still a few pixels over.
const tableWrapStyle = xcss({ paddingTop: 'space.200', overflowX: 'auto', width: '100%' });

const loadMoreRowStyle = xcss({
  paddingTop: 'space.150',
  display: 'flex',
  justifyContent: 'center',
});

const fieldRowStyle = xcss({
  paddingBottom: 'space.200',
  borderBottomWidth: 'border.width',
  borderBottomStyle: 'solid',
  borderBottomColor: 'color.border',
});

const readonlyFieldStyle = xcss({
  backgroundColor: 'color.background.neutral',
  borderRadius: 'border.radius.100',
  padding: 'space.150',
});

const assetKeyStyle = xcss({
  backgroundColor: 'color.background.brand.subtlest',
  borderRadius: 'border.radius.100',
  padding: 'space.050',
  paddingInline: 'space.100',
});

const modalLabelStyle = xcss({
  color: 'color.text.subtlest',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
});

const errorInlineStyle = xcss({
  backgroundColor: 'color.background.danger',
  borderRadius: 'border.radius.100',
  padding: 'space.100',
  paddingInline: 'space.150',
});

const diagBoxStyle = xcss({
  backgroundColor: 'color.background.warning',
  borderRadius: 'border.radius.100',
  padding: 'space.150',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border.warning',
});

// Export controls row — right-aligned, sits above the tabs/table inside the
// expanded body. Subtle/compact buttons to match the restrained visual
// weight of the rest of the widget (no primary-colored buttons outside the
// actual "Refresh now" call-to-action in the staleness banner).
const exportButtonsStyle = xcss({
  display: 'flex',
  justifyContent: 'flex-end',
  paddingBottom: 'space.150',
});

// FilterBar — sits between the export controls and the tabs/table.
const filterBarStyle = xcss({
  backgroundColor: 'color.background.input',
  borderRadius: 'border.radius.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  padding: 'space.200',
  paddingInline: 'space.250',
});

const filterChipStyle = xcss({
  backgroundColor: 'color.background.brand.subtlest',
  borderRadius: 'border.radius.100',
  padding: 'space.050',
  paddingInline: 'space.100',
  display: 'flex',
  alignItems: 'center',
});

// The "+ Filters" attribute-picker Popup panel (see FilterBar). Capped
// height with its own scroll so a type with dozens of attributes stays a
// tidy overlay instead of a floor-to-ceiling list.
const filterPickerPanelStyle = xcss({
  padding: 'space.150',
  minWidth: '240px',
  maxHeight: '320px',
  overflowY: 'auto',
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getColumnsForType = (visibleAttributes, objectTypeId) =>
  visibleAttributes.filter(
    (col) => !col.objectTypeId || String(col.objectTypeId) === String(objectTypeId)
  );

// ─── AttributeField ───────────────────────────────────────────────────────────

const AttributeField = ({ col, value, onChange, isDisabled }) => {
  if (col.attributeType === 'status') {
    const statusOpts = col.statusOptions || [];
    if (statusOpts.length > 0) {
      const allOptions = [{ label: '— None —', value: '' }, ...statusOpts];
      const selected =
        allOptions.find((o) => o.value === value) ||
        { label: value || '— None —', value: value || '' };
      return (
        <Select
          inputId={`field-${col.attributeId}`}
          options={allOptions}
          value={selected}
          onChange={(opt) => onChange(opt?.value ?? '')}
          isDisabled={isDisabled}
          placeholder="Select a status…"
        />
      );
    }
    return (
      <Box xcss={readonlyFieldStyle}>
        <Inline space="space.100" alignBlock="center">
          <Text color="color.text.subtlest">{value || '—'}</Text>
          <Lozenge appearance="default">Status ref</Lozenge>
        </Inline>
      </Box>
    );
  }

  if (col.attributeType === 'object') {
    return (
      <Box xcss={readonlyFieldStyle}>
        <Text color="color.text.subtlest">{value || '—'}</Text>
      </Box>
    );
  }

  if (col.attributeType === 'select' && col.options?.length > 0) {
    const options = col.options.map((o) => ({ label: o, value: o }));
    const allOptions = [{ label: '— None —', value: '' }, ...options];
    const selected =
      allOptions.find((o) => o.value === value) || { label: '— None —', value: '' };
    return (
      <Select
        inputId={`field-${col.attributeId}`}
        options={allOptions}
        value={selected}
        onChange={(opt) => onChange(opt?.value ?? '')}
        isDisabled={isDisabled}
        placeholder="Select an option…"
      />
    );
  }

  if (col.attributeType === 'date') {
    return (
      <DatePicker
        id={`field-${col.attributeId}`}
        value={value || ''}
        onChange={(date) => onChange(date || '')}
        isDisabled={isDisabled}
        placeholder="YYYY-MM-DD"
      />
    );
  }

  return (
    <Textfield
      id={`field-${col.attributeId}`}
      name={col.attributeId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      isDisabled={isDisabled}
    />
  );
};

// ─── EditAssetModal ───────────────────────────────────────────────────────────

const EditAssetModal = ({ asset, columns, onClose, onSaved }) => {
  const [formValues, setFormValues] = useState(() => {
    const init = {};
    columns.forEach((col) => {
      if (col.attributeType === 'date' || col.attributeType === 'status') {
        init[col.attributeId] = asset.rawValues?.[col.attributeId] ?? '';
      } else {
        init[col.attributeId] = asset.visibleValues?.[col.attributeId] ?? '';
      }
    });
    return init;
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedFields, setSavedFields] = useState(new Set());

  const editableColumns = useMemo(
    () =>
      columns.filter((col) => {
        if (col.isEditable === false) return false;
        if (col.attributeType === 'object') return false;
        if (col.attributeType === 'status') return (col.statusOptions?.length ?? 0) > 0;
        return true;
      }),
    [columns]
  );

  const dirtyFields = useMemo(() => {
    const dirty = new Set();
    columns.forEach((col) => {
      if (col.attributeType === 'object') return;
      const useRaw = col.attributeType === 'date' || col.attributeType === 'status';
      const original = useRaw
        ? (asset.rawValues?.[col.attributeId] ?? '')
        : (asset.visibleValues?.[col.attributeId] ?? '');
      if (formValues[col.attributeId] !== original) dirty.add(col.attributeId);
    });
    return dirty;
  }, [formValues, columns, asset]);

  const handleFieldChange = useCallback((attributeId, newValue) => {
    setFormValues((prev) => ({ ...prev, [attributeId]: newValue }));
    setSaveError(null);
  }, []);

  const handleSaveAll = async () => {
    const changedEditableColumns = editableColumns.filter((col) =>
      dirtyFields.has(col.attributeId)
    );
    if (changedEditableColumns.length === 0) { onClose(); return; }

    setSaving(true);
    setSaveError(null);

    try {
      const updates = {};
      const rawUpdates = {};
      for (const col of changedEditableColumns) {
        await invoke('updateAssetAttribute', {
          objectId: asset.id,
          objectTypeId: asset.objectTypeId,
          objectTypeAttributeId: col.attributeId,
          attributeType: col.attributeType,
          value: formValues[col.attributeId],
        });
        const rawId = formValues[col.attributeId];
        if (col.attributeType === 'status') {
          const matched = (col.statusOptions || []).find((o) => o.value === rawId);
          updates[col.attributeId] = matched ? matched.label : rawId;
        } else {
          updates[col.attributeId] = rawId;
        }
        rawUpdates[col.attributeId] = rawId;
        setSavedFields((prev) => new Set([...prev, col.attributeId]));
      }
      onSaved(asset.id, updates, rawUpdates);
      onClose();
    } catch (err) {
      setSaveError(err?.message || 'One or more fields failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const dirtyEditableCount = editableColumns.filter((c) =>
    dirtyFields.has(c.attributeId)
  ).length;

  return (
    <Modal onClose={onClose} width="fullscreen">
      <ModalHeader>
        <ModalTitle>Edit Asset</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.300">
          <Box xcss={readonlyFieldStyle}>
            <Inline spread="space-between" alignBlock="center">
              <Stack space="space.025">
                <Box xcss={modalLabelStyle}>
                  <Text size="small">Asset Name</Text>
                </Box>
                <Text weight="medium">{asset.label || '—'}</Text>
              </Stack>
              <Inline space="space.100" alignBlock="center">
                <Box xcss={assetKeyStyle}>
                  <Text size="small" color="color.text.brand">{asset.objectKey || '—'}</Text>
                </Box>
                <Lozenge appearance="inprogress">{asset.objectTypeName || 'Asset'}</Lozenge>
              </Inline>
            </Inline>
          </Box>

          {columns.length === 0 && (
            <SectionMessage appearance="info">
              <Text>No configurable fields for this asset type.</Text>
            </SectionMessage>
          )}

          {columns.map((col) => {
            const isEditable =
              col.isEditable !== false &&
              (() => {
                if (col.attributeType === 'object') return false;
                if (col.attributeType === 'status') return (col.statusOptions?.length ?? 0) > 0;
                return true;
              })();
            const isSaved = savedFields.has(col.attributeId);
            const isDirty = dirtyFields.has(col.attributeId);
            return (
              <Box key={col.attributeId} xcss={fieldRowStyle}>
                <Stack space="space.100">
                  <Inline spread="space-between" alignBlock="center">
                    <Label labelFor={`field-${col.attributeId}`}>
                      {col.attributeName}
                    </Label>
                    <Inline space="space.075" alignBlock="center">
                      {col.attributeType === 'object' && (
                        <Lozenge appearance="default">Object ref</Lozenge>
                      )}
                      {col.attributeType === 'status' && !(col.statusOptions?.length > 0) && (
                        <Lozenge appearance="default">Status ref</Lozenge>
                      )}
                      {!isEditable &&
                        col.attributeType !== 'object' &&
                        col.attributeType !== 'status' && (
                          <Lozenge appearance="default">Read only</Lozenge>
                        )}
                      {isEditable && isDirty && !isSaved && (
                        <Lozenge appearance="moved">Edited</Lozenge>
                      )}
                      {isSaved && <Lozenge appearance="success">Saved</Lozenge>}
                    </Inline>
                  </Inline>
                  <AttributeField
                    col={col}
                    value={formValues[col.attributeId]}
                    onChange={(newValue) => handleFieldChange(col.attributeId, newValue)}
                    isDisabled={saving || !isEditable}
                  />
                </Stack>
              </Box>
            );
          })}

          {saveError && (
            <Box xcss={errorInlineStyle}>
              <Text color="color.text.danger" size="small">✕ {saveError}</Text>
            </Box>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Inline space="space.150" alignBlock="center">
          {dirtyEditableCount > 0 && (
            <Text size="small" color="color.text.subtlest">
              {dirtyEditableCount} field{dirtyEditableCount !== 1 ? 's' : ''} changed
            </Text>
          )}
          <Button appearance="subtle" onClick={onClose} isDisabled={saving}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            onClick={handleSaveAll}
            isDisabled={saving || dirtyEditableCount === 0}
            isLoading={saving}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </Inline>
      </ModalFooter>
    </Modal>
  );
};

// ─── getSharedColumns ─────────────────────────────────────────────────────────

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

// ─── getFilterableColumns ─────────────────────────────────────────────────────
// getSharedColumns intentionally shows only attributes common to every
// loaded type, because it drives the "All" tab's TABLE headers — a merged
// table sprouting sparse per-type columns would be worse than showing
// fewer. The filter bar has the opposite requirement: hiding a type's only
// Asset Status (or Purchase Date, etc.) filter just because some other
// type lacks that attribute would make it impossible to filter for it from
// the "All" tab. So this offers every attribute known on ANY visible type —
// deduped by NAME, not attributeId. Two different object types commonly
// each have their OWN "Asset Tag"/"Purchase Date"/etc. attribute — same
// name, different objectTypeAttributeId — and deduping by id let both
// through as separate boxes with an identical label. That's not just
// visual clutter: buildFilterAql (resolvers/index.js) matches by the
// attribute's NAME, not its id, so both boxes would build the exact same
// AQL condition anyway — showing two meant picking a value in one while
// its "duplicate" sat there looking unset, which read as "my filter got
// applied twice" / values not sticking.
const getFilterableColumns = (visibleAttributes) => {
  const seen = new Set();
  return (visibleAttributes || []).filter((col) => {
    const key = String(col.attributeName || col.attributeId || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ─── LoadMoreRow ──────────────────────────────────────────────────────────────
// Shared "Load more" control. Only rendered when there's actually another
// page to fetch. Disabled + spinner while a fetch is in flight so rapid
// double-clicks can't fire overlapping invocations for the same user.

const LoadMoreRow = ({ hasMore, isLoading, onClick, remainingLabel }) => {
  if (!hasMore) return null;
  return (
    <Box xcss={loadMoreRowStyle}>
      <Button appearance="subtle" onClick={onClick} isDisabled={isLoading} iconBefore={isLoading ? undefined : undefined}>
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
// PAGE_SIZE-sized chunk from the server (see handleLoadMore) but otherwise
// leaves the user on whatever page they were viewing, so the newly loaded
// rows are invisible until they manually click through to the last page.
// This drives DynamicTable as a CONTROLLED table (`page` + `onSetPage`
// instead of `defaultPage`) so it can jump to the freshly loaded page as
// soon as a "Load more" fetch finishes.
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

// ─── ExportButtons ────────────────────────────────────────────────────────────
// Generation always happens server-side via an async job (startExportJob /
// getExportJobResult, backed by exportJobConsumer.js on the export-queue),
// the same Async Events pattern used for the main asset-load job — see the
// big comment above registerExportAssets in resolvers/exportAssets.js for
// why. The consumer re-runs the ownership(+filter) AQL itself and re-fetches
// everything up to maxUserAssetLimit, so there's no client-side "load the
// remaining pages first" phase anymore: the `assets` already in memory are
// only used here to decide whether to show the button at all and to render
// the "will export N assets" hint, never actually shipped to the server.
//
// Building a large PDF (per-cell height measurement in pdfkit) or a large
// XLSX, or re-running the AQL for a big filtered set, could alone exceed
// Forge's 25s invoke() ceiling — that's what forced this off the old
// single-invoke() `exportAssets`/`exportAssetsWithFilters` resolvers.
//
// scopeObjectTypeId/scopeObjectTypeName: when the user is viewing a specific
// type's tab (not "All"), the filtered export is narrowed to that type too —
// otherwise "export what I'm filtering on" while on the Laptops tab would
// silently also pull in every other type the filter happens to match, which
// isn't what "export what I'm looking at" means to the person clicking the
// button. Only applies when filters are active — an unfiltered export
// always exports every type regardless of which tab is open (matches the
// pre-existing behavior).
const EXPORT_POLL_INTERVAL_MS = 1500;
const EXPORT_POLL_MAX_ATTEMPTS = 400; // ~600s ceiling, matching the export consumer's timeoutSeconds

const triggerBase64Download = (base64, filename, mimeType) => {
  const link = document.createElement('a');
  link.href = `data:${mimeType};base64,${base64}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const ExportButtons = ({ assets, filters, isFiltered, schemaName, totalCount, accountId, scopeObjectTypeId, scopeObjectTypeName }) => {
  // exportProgress: null when idle, object when running: { phase: 'generating' }
  const [exportProgress, setExportProgress] = useState(null);
  const [exportError, setExportError] = useState(null);

  const isExporting = exportProgress !== null;

  const handleExport = async (format) => {
    if (isExporting) return;
    setExportError(null);
    setExportProgress({ phase: 'generating' });

    try {
      const start = await invoke('startExportJob', {
        format,
        schemaName,
        accountId,
        filters: isFiltered ? filters : undefined,
        objectTypeId: isFiltered ? (scopeObjectTypeId || undefined) : undefined,
      });

      if (start?.error) {
        setExportError(start.error);
        return;
      }

      const { jobId } = start;
      let outcome = null;

      for (let attempt = 0; attempt < EXPORT_POLL_MAX_ATTEMPTS; attempt++) {
        const job = await invoke('getExportJobResult', { jobId });
        if (job.status === 'done') { outcome = job.result; break; }
        if (job.status === 'error') { outcome = { error: job.error || 'Export failed.' }; break; }
        await new Promise((resolve) => setTimeout(resolve, EXPORT_POLL_INTERVAL_MS));
      }

      if (!outcome) {
        setExportError('Generating your file is taking longer than expected. Please try again.');
        return;
      }
      if (outcome.error) {
        setExportError(outcome.error);
        return;
      }

      triggerBase64Download(outcome.base64, outcome.filename, outcome.mimeType);
    } catch (err) {
      setExportError(err?.message || 'Export generation failed.');
    } finally {
      setExportProgress(null);
    }
  };

  if (assets.length === 0) return null;

  const exportTotal = typeof totalCount === 'number' ? totalCount : assets.length;
  const isPartial = exportTotal > assets.length;

  return (
    <Stack space="space.075">
      <Box xcss={exportButtonsStyle}>
        <Inline space="space.150" alignBlock="center">

          {/* Error state */}
          {exportError && (
            <Text size="small" color="color.text.danger">{exportError}</Text>
          )}

          {/* Progress indicator */}
          {exportProgress && (
            <Inline space="space.100" alignBlock="center">
              <Spinner size="small" />
              <Text size="small" color="color.text.subtlest">Generating file…</Text>
            </Inline>
          )}

          {/* Filtered-export hint when idle — names the type when the
              export is scoped to a specific tab, so it's clear this
              matches what's currently on screen rather than every type
              the filter happens to match. */}
          {!exportProgress && !exportError && isFiltered && (
            <Text size="small" color="color.text.subtlest">
              {scopeObjectTypeId
                ? `Will export ${scopeObjectTypeName || 'this type'} assets matching your current filters`
                : 'Will export all assets matching your current filters'}
            </Text>
          )}

          {/* Partial-load hint when idle (unfiltered case) */}
          {!exportProgress && !exportError && !isFiltered && isPartial && (
            <Text size="small" color="color.text.subtlest">
              Will export all {exportTotal} assets
            </Text>
          )}

          <Button
            appearance="subtle"
            spacing="compact"
            isDisabled={isExporting}
            onClick={() => handleExport('xlsx')}
          >
            Export Excel
          </Button>
          <Button
            appearance="subtle"
            spacing="compact"
            isDisabled={isExporting}
            onClick={() => handleExport('pdf')}
          >
            Export PDF
          </Button>
        </Inline>
      </Box>
    </Stack>
  );
};

// ─── AllAssetsTable ───────────────────────────────────────────────────────────

// ─── Filter value helpers ───────────────────────────────────────────────────
// activeFilters values are shaped differently per attribute type so the
// FilterBar can offer type-appropriate controls instead of one generic text
// box for everything:
//   - date attributes   → { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
//   - select/status      → comma-separated string of option values (OR match)
//   - everything else    → plain string (case-insensitive substring match)
// isFilterValueEmpty/isFilterValueActive centralize "is this filter set?"
// so callers don't need to know the per-type shape.

const isFilterValueEmpty = (value) => {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'object') return !value.from && !value.to;
  return false;
};

// ─── buildFiltersPayload ────────────────────────────────────────────────────
// Shapes nameQuery + activeFilters into the payload the backend's
// buildFilterAql expects: { nameQuery, attributes: [{ attributeId,
// attributeName, attributeType, value }] }. Returns null when nothing is
// active, so callers can pass `filters: buildFiltersPayload(...) || undefined`
// straight into invoke() and the backend treats "no filters" as unfiltered.

// Client-side copy of the backend's isParenSafeAql (resolvers/shared.js —
// frontend bundles can't import from resolver code). Used both to gate
// what gets SENT (buildFiltersPayload drops unsafe raw AQL, matching the
// server's own rejection) and to show the inline "unbalanced parentheses"
// error in the AQL filter mode. The server-side check remains the actual
// security boundary; this one is UX.
const isParenSafeAql = (raw) => {
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

const buildFiltersPayload = (nameQuery, activeFilters, columns, aqlQuery = '') => {
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
// The server now does the real filtering (see buildFiltersPayload / the
// `filters` param passed to getUserAssets & getUserAssetsPage) — this hook
// just re-applies the same predicate locally so the UI updates instantly on
// every keystroke instead of waiting for the debounced server round trip.
// Once the server response lands, `assets` is already the filtered set, so
// this becomes a no-op pass-through (matches everything already in it).

const useFilteredAssets = (assets, nameQuery, activeFilters, columns) =>
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
          // (see getAttrValue(attr, true) in resolvers.js), which for date
          // attributes is ISO-ish — truncate to the first 10 chars in case
          // it's a full datetime rather than a bare date, so the compare
          // is apples-to-apples either way.
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
          // server (see buildFilterAql in resolvers/index.js — status
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

// ─── FilterBar ────────────────────────────────────────────────────────────────
// Renders above the tabs/table, modeled on Jira Assets' own object-search
// panel (search box + a checkbox picker of attributes):
//   - A name/key text search box (always)
//   - A "+ Filters" button opening a Popup with a searchable Checkbox list
//     of the current view's filterable attributes. Only CHECKED attributes
//     render an input control — previously every column rendered one up
//     front, which made the bar tall on attribute-rich schemas and pushed
//     the table further down with every extra column. The Popup overlays
//     instead of reflowing, so picking attributes never moves the table.
//   - Active filter chips (each individually removable) + count badge +
//     "Clear all"
//   - A "Filtered by:" line echoing the exact AQL condition the server
//     applied (appliedFilterAql, from buildFilterAql via the asset-load
//     job) — "how did we reach these items". Deliberately only the FILTER
//     part of the query; the ownership half is implied ("these are my
//     assets") and contains admin rule structure + the user's own identity
//     values, which isn't useful to echo back.
//
// Value/name state lives in App (controlled via onNameChange /
// onFilterChange / onClear); which attributes are picked also lives in App
// (selectedAttrIds / onToggleAttr) so the choice survives this component
// remounting. Only ephemeral UI state (popup open, picker search text) is
// local. An attribute with an ACTIVE value always counts as selected even
// if it was never explicitly checked (e.g. state restored) — otherwise its
// value would keep applying with no visible control to clear it.

// Renders a chip label for one active filter's value, regardless of shape
// (plain string vs. { from, to } date range).
const formatFilterChipValue = (value) => {
  if (typeof value === 'object' && value) {
    const { from, to } = value;
    if (from && to) return `${from} → ${to}`;
    if (from) return `From ${from}`;
    if (to) return `Until ${to}`;
    return '';
  }
  return String(value || '').trim();
};

const FilterBar = ({
  columns,
  nameQuery,
  activeFilters,
  selectedAttrIds,
  onToggleAttr,
  onNameChange,
  onFilterChange,
  onClear,
  appliedFilterAql,
  scopeObjectTypeName,
  filterMode,
  onModeChange,
  aqlQuery,
  onAqlChange,
}) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [attrSearch, setAttrSearch] = useState('');

  const trimmedAql = (aqlQuery || '').trim();
  const aqlIsUnsafe = Boolean(trimmedAql) && !isParenSafeAql(trimmedAql);

  const activeCount =
    (nameQuery.trim() ? 1 : 0) +
    (trimmedAql ? 1 : 0) +
    Object.values(activeFilters).filter((v) => !isFilterValueEmpty(v)).length;

  const hasFilters = activeCount > 0;

  // Checked attributes ∪ attributes with a live value — see the component
  // comment for why an active value always implies "selected".
  const effectiveSelected = useMemo(() => {
    const set = new Set(selectedAttrIds);
    Object.entries(activeFilters).forEach(([id, v]) => {
      if (!isFilterValueEmpty(v)) set.add(id);
    });
    return set;
  }, [selectedAttrIds, activeFilters]);

  const selectedColumns = columns.filter((c) => effectiveSelected.has(c.attributeId));

  const pickerSearch = attrSearch.trim().toLowerCase();
  const pickerColumns = pickerSearch
    ? columns.filter((c) => (c.attributeName || '').toLowerCase().includes(pickerSearch))
    : columns;

  return (
    <Box xcss={filterBarStyle}>
      <Stack space="space.150">
        {/* Row 1 — mode toggle, then either the Basic inputs (search box +
            attribute picker) or the raw-AQL input, plus count + clear. The
            Popup overlays so opening it never pushes the table down.
            Switching modes hides the other mode's INPUTS but never clears
            its state — everything active still shows in the chips row and
            still applies (the two modes AND together server-side). */}
        <Inline space="space.150" alignBlock="center" shouldWrap>
          <Inline space="space.050" alignBlock="center">
            <Button
              appearance={filterMode === 'aql' ? 'subtle' : 'primary'}
              spacing="compact"
              onClick={() => onModeChange('basic')}
            >
              Basic
            </Button>
            <Button
              appearance={filterMode === 'aql' ? 'primary' : 'subtle'}
              spacing="compact"
              onClick={() => onModeChange('aql')}
            >
              AQL
            </Button>
          </Inline>

          {filterMode === 'aql' ? (
            <Box xcss={xcss({ minWidth: '260px', flexGrow: '1' })}>
              <Textfield
                id="filter-raw-aql"
                placeholder={`e.g. "Operational Status" = "Active" AND "Model Name" like "%Dell%"`}
                value={aqlQuery}
                onChange={(e) => onAqlChange(e.target.value)}
              />
            </Box>
          ) : (
            <Box xcss={xcss({ minWidth: '200px', flexGrow: '1' })}>
              <Textfield
                id="filter-name"
                placeholder="Search by name or key…"
                value={nameQuery}
                onChange={(e) => onNameChange(e.target.value)}
              />
            </Box>
          )}

          {filterMode !== 'aql' && <Popup
            isOpen={isPickerOpen}
            onClose={() => setIsPickerOpen(false)}
            placement="bottom-start"
            content={() => (
              <Box xcss={filterPickerPanelStyle}>
                <Stack space="space.100">
                  <Textfield
                    id="filter-attr-search"
                    placeholder="Search attributes…"
                    value={attrSearch}
                    onChange={(e) => setAttrSearch(e.target.value)}
                  />
                  {pickerColumns.map((col) => (
                    <Checkbox
                      key={col.attributeId}
                      label={col.attributeName}
                      isChecked={effectiveSelected.has(col.attributeId)}
                      onChange={() => onToggleAttr(col.attributeId, effectiveSelected.has(col.attributeId))}
                    />
                  ))}
                  {pickerColumns.length === 0 && (
                    <Text size="small" color="color.text.subtlest">
                      No attributes match "{attrSearch.trim()}"
                    </Text>
                  )}
                </Stack>
              </Box>
            )}
            trigger={() => (
              <Button
                appearance={selectedColumns.length > 0 ? 'primary' : 'default'}
                onClick={() => setIsPickerOpen((open) => !open)}
              >
                + Filters{selectedColumns.length > 0 ? ` (${selectedColumns.length})` : ''}
              </Button>
            )}
          />}

          {hasFilters && <Badge appearance="primary">{activeCount}</Badge>}
          {hasFilters && (
            <Button appearance="subtle" spacing="compact" onClick={onClear}>
              Clear all
            </Button>
          )}
        </Inline>

        {/* AQL-mode feedback: a live syntax guard (same isParenSafeAql rule
            the server enforces — an unsafe condition is never sent, see
            buildFiltersPayload) and a one-line hint for first-time use. */}
        {filterMode === 'aql' && aqlIsUnsafe && (
          <Text size="small" color="color.text.danger">
            Unbalanced parentheses or an unclosed quote — this condition won't be applied until it's fixed.
          </Text>
        )}
        {filterMode === 'aql' && !trimmedAql && (
          <Text size="small" color="color.text.subtlest">
            Type a raw AQL condition — it only ever narrows within your own assets. Quote attribute
            names and values (e.g. "Asset Status" = "In Stock"); AND / OR / like are supported.
          </Text>
        )}

        {/* Row 2 — one type-appropriate control per PICKED attribute only
            (Basic mode; in AQL mode the typed condition is the control,
            though any still-active basic values keep applying via chips) */}
        {filterMode !== 'aql' && selectedColumns.length > 0 && (
            <Inline space="space.150" alignBlock="center" shouldWrap>
              {selectedColumns.map((col) => {
                if (col.attributeType === 'date') {
                  const current = activeFilters[col.attributeId] || {};
                  return (
                    <Inline key={col.attributeId} space="space.075" alignBlock="center">
                      <Box xcss={xcss({ minWidth: '120px' })}>
                        <DatePicker
                          id={`filter-attr-${col.attributeId}-from`}
                          value={current.from || ''}
                          onChange={(date) =>
                            onFilterChange(col.attributeId, { ...current, from: date || '' })
                          }
                          placeholder={`${col.attributeName} from`}
                        />
                      </Box>
                      <Box xcss={xcss({ minWidth: '120px' })}>
                        <DatePicker
                          id={`filter-attr-${col.attributeId}-to`}
                          value={current.to || ''}
                          onChange={(date) =>
                            onFilterChange(col.attributeId, { ...current, to: date || '' })
                          }
                          placeholder={`${col.attributeName} to`}
                        />
                      </Box>
                    </Inline>
                  );
                }

                if (col.attributeType === 'select' || col.attributeType === 'status') {
                  // Real dropdown built from the known option list, so the
                  // user can only ever pick a value that actually exists —
                  // no more partial-text mismatches between what's typed
                  // and what the server can exact-match. status uses
                  // statusOptions ({value: statusId, label: statusName});
                  // we key the Select's `value` on the LABEL (not the
                  // status ID) since filtering matches against the
                  // attribute's display text, same as what's shown in the
                  // table — the ID is only meaningful for the edit-modal's
                  // save payload, not for filtering.
                  const rawOptions =
                    col.attributeType === 'status'
                      ? (col.statusOptions || []).map((o) => ({ label: o.label, value: o.label }))
                      : (col.options || []).map((o) => ({ label: o, value: o }));

                  if (rawOptions.length === 0) {
                    // No known values to pick from (e.g. status options
                    // couldn't be resolved) — fall back to freeform text,
                    // substring-matched server-side.
                    return (
                      <Box key={col.attributeId} xcss={xcss({ minWidth: '160px', flexGrow: '1' })}>
                        <Textfield
                          id={`filter-attr-${col.attributeId}`}
                          placeholder={`${col.attributeName} (comma-separated)`}
                          value={activeFilters[col.attributeId] || ''}
                          onChange={(e) => onFilterChange(col.attributeId, e.target.value)}
                        />
                      </Box>
                    );
                  }

                  const selectedLabels = String(activeFilters[col.attributeId] || '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const selectedOptions = rawOptions.filter((o) => selectedLabels.includes(o.value));

                  return (
                    <Box key={col.attributeId} xcss={xcss({ minWidth: '180px', flexGrow: '1' })}>
                      <Select
                        inputId={`filter-attr-${col.attributeId}`}
                        options={rawOptions}
                        value={selectedOptions}
                        isMulti
                        onChange={(opts) =>
                          onFilterChange(col.attributeId, (opts || []).map((o) => o.value).join(','))
                        }
                        placeholder={col.attributeName}
                      />
                    </Box>
                  );
                }

                return (
                  <Box key={col.attributeId} xcss={xcss({ minWidth: '130px', flexGrow: '1' })}>
                    <Textfield
                      id={`filter-attr-${col.attributeId}`}
                      placeholder={col.attributeName}
                      value={activeFilters[col.attributeId] || ''}
                      onChange={(e) => onFilterChange(col.attributeId, e.target.value)}
                    />
                  </Box>
                );
              })}
            </Inline>
        )}

        {/* Active filter summary chips — each removable individually.
            OUTSIDE the selectedColumns block so a name-only filter still
            shows its chip even with no attribute controls picked. Only
            BASIC filters get chips — the raw AQL condition is already on
            screen twice (the input box and the bold "Filtered by" line
            below), so a third copy as a chip was pure noise. */}
        {(nameQuery.trim() !== '' ||
          Object.values(activeFilters).some((v) => !isFilterValueEmpty(v))) && (
          <Inline space="space.075" shouldWrap alignBlock="center">
            <Text size="small" color="color.text.subtlest">Active:</Text>
            {nameQuery.trim() && (
              <Box xcss={filterChipStyle}>
                <Inline space="space.050" alignBlock="center">
                  <Text size="small" color="color.text.brand">
                    Name/Key: "{nameQuery.trim()}"
                  </Text>
                  <Button appearance="subtle" spacing="compact" onClick={() => onNameChange('')}>
                    ✕
                  </Button>
                </Inline>
              </Box>
            )}
            {Object.entries(activeFilters)
              .filter(([, v]) => !isFilterValueEmpty(v))
              .map(([attrId, val]) => {
                const col = columns.find((c) => c.attributeId === attrId);
                return (
                  <Box key={attrId} xcss={filterChipStyle}>
                    <Inline space="space.050" alignBlock="center">
                      <Text size="small" color="color.text.brand">
                        {col?.attributeName || attrId}: "{formatFilterChipValue(val)}"
                      </Text>
                      <Button
                        appearance="subtle"
                        spacing="compact"
                        onClick={() => onFilterChange(attrId, typeof val === 'object' ? {} : '')}
                      >
                        ✕
                      </Button>
                    </Inline>
                  </Box>
                );
              })}
          </Inline>
        )}

        {/* "How did we reach these items" — the exact filter condition the
            server ANDed onto the ownership query, echoed back from
            buildFilterAql via the asset-load job result. Only the filter
            half; ownership is implied. Hidden until a filtered server
            response has actually landed (it lags a keystroke behind the
            instant client-side pass by design — it describes the CURRENT
            server-fetched result set, not the in-flight keystrokes).
            When a specific type's tab is open, the type is shown as part
            of the condition too — the server ran the attribute filter
            across ALL types (that's how every tab's count stays known),
            and the tab supplies the type narrowing, so
            `objectType = "X" AND <filter>` is precisely what describes
            the rows on screen even though the two halves are applied in
            different places. */}
        {/* One Text element, so label and condition share a font size and
            baseline — mixing size="small" with full-size bold in an
            Inline left the pair visibly misaligned. Type prefix skipped
            when the condition ALREADY references objectType (possible in
            raw-AQL mode) — otherwise a query like `objectType = "Phones"
            AND …` that narrows the result to one type would get that
            same type prepended a second time by the single-type-view
            scoping. */}
        {hasFilters && appliedFilterAql && (
          <Text>
            <Text as="span" color="color.text.subtlest">Filtered by AQL: </Text>
            <Text as="strong">
              {scopeObjectTypeName && !/\bobjectType\b/i.test(appliedFilterAql)
                ? `objectType = "${scopeObjectTypeName}" AND `
                : ''}{appliedFilterAql}
            </Text>
          </Text>
        )}
      </Stack>
    </Box>
  );
};

// ─── AllAssetsTable ───────────────────────────────────────────────────────────

const AllAssetsTable = ({ assets, filteredAssets, visibleAttributes, canEdit, onEditClick, hasMore, isLoadingMore, onLoadMore, totalCount, isFiltered }) => {
  const displayAssets = filteredAssets ?? assets;
  const [page, setPage] = useJumpToLoadedPage(isLoadingMore, displayAssets.length, PAGE_SIZE);
  const sharedCols = useMemo(
    () => getSharedColumns(assets, visibleAttributes),
    [assets, visibleAttributes]
  );

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
      ...sharedCols.map((col) => ({
        key: `col-${col.attributeId}`,
        content: col.attributeName,
        isSortable: true,
      })),
      ...(canEdit ? [{ key: 'actions', content: '', width: 6 }] : []),
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
      ...sharedCols.map((col) => ({
        key: `col-${col.attributeId}-${i}`,
        content: <Text>{asset.visibleValues?.[col.attributeId] || '—'}</Text>,
      })),
      ...(canEdit ? [
        {
          key: `edit-${i}`,
          content: (
            <Button appearance="subtle" spacing="compact" onClick={() => onEditClick(asset)}>
              Edit
            </Button>
          ),
        },
      ] : []),
    ],
  }));

  const remaining = typeof totalCount === 'number' ? Math.max(totalCount - assets.length, 0) : null;

  return (
    <Box xcss={tableWrapStyle}>
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
      {/* Filtering is now server-side (see buildFilterAql in resolvers.js),
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

const AssetTable = ({ assets, filteredAssets, columns, canEdit, onEditClick, hasMore, isLoadingMore, onLoadMore, totalCount, isFiltered }) => {
  const displayAssets = filteredAssets ?? assets;
  // Called unconditionally, ahead of the early return below — hooks can't
  // follow a conditional return (see the existing rules-of-hooks lint
  // warning elsewhere in this file for what happens when they do).
  const [page, setPage] = useJumpToLoadedPage(isLoadingMore, displayAssets.length, PAGE_SIZE);

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
      ...columns.map((col) => ({
        key: `col-${col.attributeId}`,
        content: col.attributeName,
        isSortable: true,
      })),
      ...(canEdit ? [{ key: 'actions', content: '', width: 8 }] : []),
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
      ...columns.map((col) => ({
        key: `col-${col.attributeId}-${i}`,
        content: <Text>{asset.visibleValues?.[col.attributeId] || '—'}</Text>,
      })),
      ...(canEdit ? [
        {
          key: `edit-${i}`,
          content: (
            <Button appearance="subtle" spacing="compact" onClick={() => onEditClick(asset)}>
              Edit
            </Button>
          ),
        },
      ] : []),
    ],
  }));

  const remaining = typeof totalCount === 'number' ? Math.max(totalCount - assets.length, 0) : null;

  return (
    <Box xcss={tableWrapStyle}>
      <DynamicTable
        head={head}
        rows={rows}
        // Must match PAGE_SIZE (the "Load more" batch size, see
        // handleLoadMore's per-type top-up logic) — otherwise this
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

// ─── DiagnosticsPanel ─────────────────────────────────────────────────────────
// Shown only when a customer/unlicensed user sees zero assets.
// Gives admins/developers a clear explanation of what's wrong.

const DiagnosticsPanel = ({ diagnosis }) => {
  if (!diagnosis) return null;
  return (
    <Box xcss={diagBoxStyle}>
      <Stack space="space.100">
        <Text weight="medium" color="color.text.warning">
          ⚠ No assets found — diagnostic information
        </Text>
        <Stack space="space.050">
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Account type:</Text>
            <Text size="small">{diagnosis.accountType ?? '—'}</Text>
          </Inline>
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Account ID:</Text>
            <Text size="small">{diagnosis.accountId ?? '—'}</Text>
          </Inline>
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Display name resolved:</Text>
            <Text size="small">{diagnosis.displayName || '(empty — name-based AQL skipped)'}</Text>
          </Inline>
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Workspace reachable:</Text>
            <Lozenge appearance={diagnosis.workspaceReachable ? 'success' : 'removed'}>
              {diagnosis.workspaceReachable ? 'Yes' : 'No'}
            </Lozenge>
          </Inline>
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Schema accessible:</Text>
            <Lozenge appearance={diagnosis.schemaReachable ? 'success' : 'removed'}>
              {diagnosis.schemaReachable ? `Yes (${diagnosis.schemaObjectCount} objects)` : 'No'}
            </Lozenge>
          </Inline>
        </Stack>
        {diagnosis.errors?.length > 0 && (
          <Stack space="space.050">
            {diagnosis.errors.map((e, i) => (
              <Text key={i} size="small" color="color.text.danger">• {e}</Text>
            ))}
          </Stack>
        )}
        {diagnosis.schemaReachable && diagnosis.schemaObjectCount > 0 && (
          <Text size="small" color="color.text.subtlest">
            The schema is reachable and has objects. Your user is not matched by any AQL candidate.
            Check that an Owner attribute on your assets references a Users object whose Name (or Account ID) matches: "{diagnosis.displayName || diagnosis.accountId}".
          </Text>
        )}
      </Stack>
    </Box>
  );
};

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
  // cuts off a user's merged asset list, getUserAssets returns wasLimited/
  // limitApplied/preLimitCount instead of silently dropping the extras.
  // null until the first successful fetch resolves.
  const [assetLimitInfo, setAssetLimitInfo] = useState(null);
  const [error, setError] = useState(null);
  const [editingAsset, setEditingAsset] = useState(null);
  const [editColumns, setEditColumns] = useState([]);
  const [diagnosis, setDiagnosis] = useState(null);
  const [isUnlicensed, setIsUnlicensed] = useState(false);

  // ── Filter state ────────────────────────────────────────────────────────
  // nameQuery: free-text against label + objectKey
  // activeFilters: { [attributeId]: filterValue } — one entry per column
  // filter; shape of filterValue depends on attribute type (see
  // isFilterValueEmpty / buildFiltersPayload above).
  // These drive TWO things: (1) an instant client-side narrowing pass via
  // useFilteredAssets for immediate feedback, and (2) a debounced
  // server-side refetch (see the effect below) that re-runs the
  // ownership+filter AQL and replaces `assets`/pagination with the real
  // filtered result set from the server. Both reset when the widget
  // collapses (isExpanded → false), so the user gets a clean slate each
  // time they open it fresh.
  const [nameQuery, setNameQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState({});
  // Which attributes the user has PICKED (via the "+ Filters" popup) to
  // show a control for — Assets-search-style. Held here, not in FilterBar,
  // so the picks survive FilterBar re-mounts (tab switches etc.). An
  // attribute holding an active VALUE is treated as selected regardless
  // (see effectiveSelected in FilterBar). Replaces the old
  // render-every-column bar and its collapse toggle: with only picked
  // attributes rendering, the bar is compact by default and there's
  // nothing to collapse.
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
  // either way, since the backend now applies filters to the AQL itself.
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
      // with no attribute metadata (buildAssetPayload never runs — see
      // getUserAssets' totalCount===0 early return). Overwriting
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
      // offset comes straight from getUserAssets's own totalCount/
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
  // (populated by the initial getUserAssets call) so this normally doesn't
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
  // This is now a light client-side narrowing pass for instant feedback
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
              {/*  */}
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

                  {/* Filter-triggered reloads now run as a background queue
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
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

export default App;
