import React, { useState } from 'react';
import { Text, Inline, Stack, Box, Button, Spinner, xcss } from '@forge/react';
import { invoke } from '@forge/bridge';

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

// Export controls row — right-aligned, sits above the tabs/table inside the
// expanded body. Subtle/compact buttons to match the restrained visual
// weight of the rest of the widget (no primary-colored buttons outside the
// actual "Refresh now" call-to-action in the staleness banner).
const exportButtonsStyle = xcss({
  display: 'flex',
  justifyContent: 'flex-end',
  paddingBottom: 'space.150',
});

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

export default ExportButtons;
