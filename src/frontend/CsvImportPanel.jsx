import React, { useEffect, useState, useCallback, useRef } from 'react';
import ForgeReconciler, {
  Text,
  Heading,
  Box,
  Stack,
  Inline,
  Button,
  Select,
  SectionMessage,
  ProgressBar,
  Spinner,
  Toggle,
  Label,
  xcss,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

// ─── Styles ───────────────────────────────────────────────────────────────────

const panelStyle = xcss({ padding: 'space.200' });

const summaryBoxStyle = xcss({
  backgroundColor: 'color.background.neutral',
  borderRadius: 'border.radius.100',
  padding: 'space.150',
});

// ─── CSV import issue panel ─────────────────────────────────────────────────────
// Always-visible content on the ticket view (jira:issuePanel — see
// manifest.yml). Lets an agent pick a CSV attachment on this ticket + the
// Assets object type it maps to, preview the column matching (no writes
// yet), then start the actual import — which runs as a background queue
// job (startCsvImportJob / getCsvImportJobResult, see
// src/resolvers/csvImport.js and csvImportConsumer.js) since a CSV of any
// real size doing a per-row AQL lookup + create/update would exceed
// Forge's 25s synchronous invoke() ceiling, the same reasoning behind the
// asset-load job in src/frontend/index.jsx.

const POLL_INTERVAL_MS = 1000;
const PLAN_POLL_INTERVAL_MS = 1500;

// Same data-URI download trick ExportButtons uses for XLSX/PDF exports —
// the resolver hands back base64 + filename + mimeType and the browser
// does the rest.
const triggerBase64Download = (base64, filename, mimeType) => {
  const link = document.createElement('a');
  link.href = `data:${mimeType};base64,${base64}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const App = () => {
  const [issueId, setIssueId] = useState(null);
  const [schemaId, setSchemaId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [attachments, setAttachments] = useState([]);
  const [objectTypes, setObjectTypes] = useState([]);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState(null);
  const [selectedObjectTypeId, setSelectedObjectTypeId] = useState(null);

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  // { totalRows, headers, matchedAttributes, unmatchedColumns, uniqueKeyHeader, uniqueKeyAttributeName }
  // uniqueKeyHeader is always the CSV's first column, by convention — see
  // previewCsvImport/csvImportConsumer.js. No picker: whichever column is
  // first in the file is what existing assets get looked up by.
  const [preview, setPreview] = useState(null);

  // Default (off) preserves the original upsert goal — "look up the asset
  // before creating one" — matching an existing key updates it. Turning
  // this on switches to strict create-only: a matching key is reported as
  // a failed row instead of being overwritten, for cases where an
  // existing match might mean "this key got reused by mistake" rather
  // than "this is the same asset being re-imported."
  const [createOnly, setCreateOnly] = useState(false);

  const [job, setJob] = useState(null); // { status, total, processed, summary, errors, errorsTruncated, error }
  const jobPollTokenRef = useRef(0);

  // ── Automated import plan state ──────────────────────────────────────────
  // The plan is the per-issue record built by the analyze workflow
  // post-function (or this panel's Analyze button) — see
  // src/resolvers/importPostFunctions.js. The panel renders it with a
  // per-unit object-type override Select (the escape hatch for units the
  // file/sheet-name detector left unresolved) and a Confirm button that
  // starts the same chained per-sheet import the approve post-function
  // starts.
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);       // analyze in flight
  const [planStarting, setPlanStarting] = useState(false); // confirm in flight
  const [planCreateOnly, setPlanCreateOnly] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false); // template download in flight
  const planPollTokenRef = useRef(0);

  const pollPlan = useCallback(async (currentIssueId, token) => {
    // Same stale-poll token guard as pollJob below.
    for (;;) {
      if (planPollTokenRef.current !== token) return;
      const result = await invoke('getImportPlan', { issueId: currentIssueId });
      if (planPollTokenRef.current !== token) return;
      if (result.plan) setPlan(result.plan);
      if (!result.plan || result.plan.status !== 'importing') return;
      await new Promise((resolve) => setTimeout(resolve, PLAN_POLL_INTERVAL_MS));
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const [ctx, config] = await Promise.all([view.getContext(), invoke('getConfig')]);
        const currentIssueId = ctx?.extension?.issue?.id || null;
        setIssueId(currentIssueId);
        setSchemaId(config?.schemaId || null);

        if (!currentIssueId) {
          setLoadError('Could not determine which ticket this panel is on.');
          return;
        }
        if (!config?.schemaId) {
          setLoadError('A Jira admin needs to configure an Assets schema before CSV import is available.');
          return;
        }

        const [attachmentsResult, objectTypesResult, planResult] = await Promise.all([
          invoke('getIssueCsvAttachments', { issueId: currentIssueId }),
          invoke('getObjectTypes', { schemaId: config.schemaId }),
          invoke('getImportPlan', { issueId: currentIssueId }),
        ]);

        if (attachmentsResult.error) setLoadError(attachmentsResult.error);
        setAttachments(attachmentsResult.attachments || []);
        setObjectTypes(objectTypesResult.objectTypes || []);
        if (planResult.plan) {
          setPlan(planResult.plan);
          // An import kicked off elsewhere (the approve post-function, or
          // another agent's panel) may still be running — resume polling.
          if (planResult.plan.status === 'importing') {
            pollPlan(currentIssueId, ++planPollTokenRef.current);
          }
        }
      } catch (err) {
        setLoadError(err?.message || 'Failed to load this panel.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handlePreview = useCallback(async () => {
    if (!selectedAttachmentId || !selectedObjectTypeId) return;
    setIsPreviewing(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const result = await invoke('previewCsvImport', {
        issueId,
        attachmentId: selectedAttachmentId,
        objectTypeId: selectedObjectTypeId,
      });
      if (result.error) {
        setPreviewError(result.error);
        return;
      }
      setPreview(result);
    } catch (err) {
      setPreviewError(err?.message || 'Failed to preview this CSV.');
    } finally {
      setIsPreviewing(false);
    }
  }, [issueId, selectedAttachmentId, selectedObjectTypeId]);

  const pollJob = useCallback(async (jobId, token) => {
    // token guards against a stale poll loop (e.g. the agent re-runs
    // preview/import) continuing to overwrite state after a newer one
    // has started — same idea as latestLoadRequestIdRef in index.jsx.
    for (;;) {
      if (jobPollTokenRef.current !== token) return;
      const result = await invoke('getCsvImportJobResult', { jobId });
      if (jobPollTokenRef.current !== token) return;
      setJob(result);
      if (result.status === 'done' || result.status === 'error') return;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }, []);

  const handleStartImport = useCallback(async () => {
    if (!preview || !preview.uniqueKeyAttributeName) return;
    const token = ++jobPollTokenRef.current;
    setJob({ status: 'pending', total: preview.totalRows, processed: 0, summary: { created: 0, updated: 0, unchanged: 0, failed: 0 }, errors: [], warnings: [] });
    try {
      const start = await invoke('startCsvImportJob', {
        issueId,
        attachmentId: selectedAttachmentId,
        objectTypeId: selectedObjectTypeId,
        createOnly,
      });
      if (start.error) {
        setJob({ status: 'error', error: start.error });
        return;
      }
      pollJob(start.jobId, token);
    } catch (err) {
      setJob({ status: 'error', error: err?.message || 'Failed to start the import.' });
    }
  }, [issueId, selectedAttachmentId, selectedObjectTypeId, createOnly, preview, pollJob]);

  const handleAnalyzePlan = useCallback(async () => {
    setPlanBusy(true);
    setPlanError(null);
    try {
      const result = await invoke('analyzeImportPlan', { issueId });
      if (result.error) {
        setPlanError(result.error);
        if (result.plan) setPlan(result.plan);
        return;
      }
      setPlan(result.plan);
    } catch (err) {
      setPlanError(err?.message || 'Failed to analyze the attachment.');
    } finally {
      setPlanBusy(false);
    }
  }, [issueId]);

  const handleOverrideUnit = useCallback(async (unitIndex, opt) => {
    if (!opt?.value) return;
    setPlanError(null);
    try {
      const objectTypeName = objectTypes.find((t) => t.id === opt.value)?.name || '';
      const result = await invoke('overrideImportPlanUnit', {
        issueId, unitIndex, objectTypeId: opt.value, objectTypeName,
      });
      if (result.error) {
        setPlanError(result.error);
        return;
      }
      setPlan(result.plan);
    } catch (err) {
      setPlanError(err?.message || 'Failed to change the object type.');
    }
  }, [issueId, objectTypes]);

  // Downloads the generated import template (one headers-only sheet per
  // object type, README with instructions — see resolvers/importTemplate.js)
  // so the agent can hand users a file whose sheet names and headers are
  // guaranteed to pass the analyze step.
  const handleDownloadTemplate = useCallback(async () => {
    setTemplateBusy(true);
    setPlanError(null);
    try {
      const result = await invoke('generateImportTemplate', { issueId });
      if (result.error) {
        setPlanError(result.error);
        return;
      }
      triggerBase64Download(result.base64, result.filename, result.mimeType);
    } catch (err) {
      setPlanError(err?.message || 'Failed to generate the import template.');
    } finally {
      setTemplateBusy(false);
    }
  }, [issueId]);

  const handleConfirmPlan = useCallback(async () => {
    setPlanStarting(true);
    setPlanError(null);
    try {
      const result = await invoke('confirmImportPlan', { issueId, createOnly: planCreateOnly });
      if (result.error) {
        setPlanError(result.error);
        return;
      }
      setPlan(result.plan);
      pollPlan(issueId, ++planPollTokenRef.current);
    } catch (err) {
      setPlanError(err?.message || 'Failed to start the import.');
    } finally {
      setPlanStarting(false);
    }
  }, [issueId, planCreateOnly, pollPlan]);

  if (loading) {
    return (
      <Box xcss={panelStyle}>
        <Inline space="space.100" alignBlock="center">
          <Spinner size="small" />
          <Text size="small" color="color.text.subtlest">Loading…</Text>
        </Inline>
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box xcss={panelStyle}>
        <SectionMessage appearance="warning">
          <Text>{loadError}</Text>
        </SectionMessage>
      </Box>
    );
  }

  const jobInFlight = job && job.status !== 'done' && job.status !== 'error';
  const planImporting = plan?.status === 'importing';
  // uniqueKeyOk implies an objectTypeId is set — units the detector (or a
  // manual override) resolved AND whose first column matched. `result` is
  // ignored here on purpose: re-running a finished plan is allowed
  // (startImportPlanJobs clears previous results).
  const planRunnableCount = plan ? plan.units.filter((u) => u.objectTypeId && u.uniqueKeyOk).length : 0;

  return (
    <Box xcss={panelStyle}>
      <Stack space="space.200">
        <Heading as="h4">Import Assets from CSV / Excel</Heading>

        {/* ── Automated import plan ─────────────────────────────────────── */}
        <Stack space="space.150">
          <Heading as="h5">Automatic import plan</Heading>
          <Text size="small" color="color.text.subtlest">
            Detects each target object type from the newest CSV/XLSX attachment's file or sheet name —
            e.g. "tv_stock.csv" imports into TV, and each sheet of a workbook imports into the type its name mentions.
          </Text>

          {planError && (
            <SectionMessage appearance="error">
              <Text>{planError}</Text>
            </SectionMessage>
          )}

          {!plan && (
            <Inline space="space.100">
              <Button onClick={handleAnalyzePlan} isLoading={planBusy} isDisabled={planBusy}>
                Analyze newest attachment
              </Button>
              <Button onClick={handleDownloadTemplate} isLoading={templateBusy} isDisabled={templateBusy}>
                Download template
              </Button>
            </Inline>
          )}

          {plan && (
            <Stack space="space.150">
              <Inline space="space.100" alignBlock="center">
                {planImporting && <Spinner size="small" />}
                <Text size="small" weight="medium">
                  "{plan.filename}" — {plan.units.length} {plan.kind === 'xlsx' ? 'sheet(s)' : 'file'}
                  {planImporting ? ' — importing…' : plan.status === 'done' ? ' — finished' : ''}
                </Text>
              </Inline>

              {plan.units.map((unit) => (
                <Box key={unit.index} xcss={summaryBoxStyle}>
                  <Stack space="space.075">
                    <Inline space="space.150" alignBlock="center" shouldWrap>
                      <Text weight="medium">
                        {unit.sheetName ? `Sheet "${unit.sheetName}"` : plan.filename}
                      </Text>
                      <Text size="small" color="color.text.subtlest">{unit.totalRows} row(s)</Text>
                      <Box xcss={xcss({ minWidth: '220px' })}>
                        <Select
                          inputId={`plan-unit-type-${unit.index}`}
                          placeholder="Select object type…"
                          options={objectTypes.map((t) => ({ label: t.name, value: t.id }))}
                          value={
                            unit.objectTypeId
                              ? {
                                  label: unit.objectTypeName || objectTypes.find((t) => t.id === unit.objectTypeId)?.name || unit.objectTypeId,
                                  value: unit.objectTypeId,
                                }
                              : null
                          }
                          onChange={(opt) => handleOverrideUnit(unit.index, opt)}
                          isDisabled={planImporting || planBusy || planStarting}
                        />
                      </Box>
                    </Inline>

                    {unit.objectTypeId && (
                      <Text size="small" color="color.text.subtlest">
                        {unit.matchedBy === 'manual' ? 'Manually chosen' : `Detected from the ${unit.sheetName ? 'sheet' : 'file'} name`} —
                        {' '}{unit.matchedColumns}/{unit.totalColumns} column(s) matched
                        {unit.uniqueKeyOk ? ` — key column "${unit.uniqueKeyHeader}" OK` : ''}
                      </Text>
                    )}

                    {/* Name the columns that won't import — the count above
                        says how many, this says which, so the user knows
                        exactly what to rename in the file. */}
                    {unit.objectTypeId && unit.unmatchedColumns?.length > 0 && (
                      <Text size="small" color="color.text.subtlest">
                        Ignored columns (no attribute with that name): {unit.unmatchedColumns.join(', ')}
                      </Text>
                    )}

                    {unit.isParentType && (
                      <Text size="small" color="color.text.warning">
                        {unit.objectTypeName} is a parent type — if these objects belong in one of its child types, pick the child above before importing.
                      </Text>
                    )}

                    {unit.reason && !unit.result && (
                      <Text size="small" color="color.text.danger">{unit.reason}</Text>
                    )}

                    {unit.result && (
                      unit.result.error ? (
                        <Text size="small" color="color.text.danger">Failed: {unit.result.error}</Text>
                      ) : (
                        <Stack space="space.025">
                          <Text size="small">
                            Done — {unit.result.summary?.created || 0} created, {unit.result.summary?.updated || 0} updated,
                            {' '}{unit.result.summary?.unchanged || 0} unchanged, {unit.result.summary?.failed || 0} failed
                          </Text>
                          {/* Per-row detail — the plan keeps a capped slice of
                              each unit's errors/warnings (see
                              advanceImportPlan in importPostFunctions.js);
                              the summary comment shows the same slice. */}
                          {unit.result.errors?.length > 0 && (
                            <>
                              <Text size="small" color="color.text.subtlest">
                                Failed rows{(unit.result.summary?.failed || 0) > unit.result.errors.length ? ` (first ${unit.result.errors.length} of ${unit.result.summary.failed})` : ''}:
                              </Text>
                              {unit.result.errors.map((e, i) => (
                                <Text key={i} size="small" color="color.text.danger">
                                  Row {e.row}{e.keyValue ? ` (${e.keyValue})` : ''}: {e.message}
                                </Text>
                              ))}
                            </>
                          )}
                          {unit.result.warnings?.length > 0 && (
                            <>
                              <Text size="small" color="color.text.subtlest">
                                Imported with warnings{(unit.result.warningsTotal || 0) > unit.result.warnings.length ? ` (first ${unit.result.warnings.length} of ${unit.result.warningsTotal})` : ''} — usually a reference value that didn't match an existing object:
                              </Text>
                              {unit.result.warnings.map((w, i) => (
                                <Text key={i} size="small" color="color.text.warning">
                                  Row {w.row}: {w.message}
                                </Text>
                              ))}
                            </>
                          )}
                        </Stack>
                      )
                    )}
                  </Stack>
                </Box>
              ))}

              <Inline space="space.100" alignBlock="center">
                <Toggle
                  id="plan-create-only-toggle"
                  isChecked={planCreateOnly}
                  onChange={() => setPlanCreateOnly((prev) => !prev)}
                  isDisabled={planImporting || planStarting}
                />
                <Label labelFor="plan-create-only-toggle">
                  Create only — treat an existing match as an error instead of updating it
                </Label>
              </Inline>

              <Inline space="space.100">
                <Button
                  appearance="primary"
                  onClick={handleConfirmPlan}
                  isDisabled={planRunnableCount === 0 || planImporting || planBusy}
                  isLoading={planStarting}
                >
                  {plan.status === 'done' ? 'Run again' : `Start import (${planRunnableCount} ready)`}
                </Button>
                <Button onClick={handleAnalyzePlan} isDisabled={planBusy || planImporting || planStarting} isLoading={planBusy}>
                  Re-analyze
                </Button>
                <Button onClick={handleDownloadTemplate} isLoading={templateBusy} isDisabled={templateBusy || planImporting}>
                  Download template
                </Button>
              </Inline>
            </Stack>
          )}
        </Stack>

        {/* ── Manual single-CSV import (original flow, unchanged) ────────── */}
        <Heading as="h5">Manual single-CSV import</Heading>

        {attachments.length === 0 && (
          <SectionMessage appearance="info">
            <Text>Attach a CSV file to this ticket to import assets from it. Each row becomes one asset and columns map to attributes — the FIRST column is always used to look up an existing asset (e.g. Asset Tag or Serial Number), so re-running the same file updates existing assets instead of duplicating them.</Text>
          </SectionMessage>
        )}

        {attachments.length > 0 && (
          <Stack space="space.150">
            <Inline space="space.150" shouldWrap>
              <Box xcss={xcss({ minWidth: '220px', flexGrow: '1' })}>
                <Select
                  inputId="csv-attachment-select"
                  placeholder="Select a CSV attachment…"
                  options={attachments.map((a) => ({ label: `${a.filename} (${a.size} bytes)`, value: a.id }))}
                  value={
                    selectedAttachmentId
                      ? { label: attachments.find((a) => a.id === selectedAttachmentId)?.filename, value: selectedAttachmentId }
                      : null
                  }
                  onChange={(opt) => { setSelectedAttachmentId(opt?.value || null); setPreview(null); setPreviewError(null); }}
                  isDisabled={Boolean(jobInFlight)}
                />
              </Box>
              <Box xcss={xcss({ minWidth: '200px', flexGrow: '1' })}>
                <Select
                  inputId="csv-object-type-select"
                  placeholder="Select target object type…"
                  options={objectTypes.map((t) => ({ label: t.name, value: t.id }))}
                  value={
                    selectedObjectTypeId
                      ? { label: objectTypes.find((t) => t.id === selectedObjectTypeId)?.name, value: selectedObjectTypeId }
                      : null
                  }
                  onChange={(opt) => { setSelectedObjectTypeId(opt?.value || null); setPreview(null); setPreviewError(null); }}
                  isDisabled={Boolean(jobInFlight)}
                />
              </Box>
              <Button
                appearance="default"
                onClick={handlePreview}
                isDisabled={!selectedAttachmentId || !selectedObjectTypeId || isPreviewing || Boolean(jobInFlight)}
                isLoading={isPreviewing}
              >
                Preview
              </Button>
            </Inline>

            {previewError && (
              <SectionMessage appearance="error">
                <Text>{previewError}</Text>
              </SectionMessage>
            )}

            {preview && (
              <Box xcss={summaryBoxStyle}>
                <Stack space="space.150">
                  <Text weight="medium">{preview.totalRows} row{preview.totalRows !== 1 ? 's' : ''} found</Text>
                  <Text size="small">
                    Matched columns: {preview.matchedAttributes.map((m) => m.attributeName).join(', ') || '—'}
                  </Text>
                  {preview.unmatchedColumns.length > 0 && (
                    <Text size="small" color="color.text.subtlest">
                      Unmatched columns (will be ignored): {preview.unmatchedColumns.join(', ')}
                    </Text>
                  )}

                  {preview.uniqueKeyAttributeName ? (
                    <Text size="small">
                      Looking up existing assets by <Text size="small" weight="medium">{preview.uniqueKeyHeader}</Text> (the first column) →
                      {' '}<Text size="small" weight="medium">{preview.uniqueKeyAttributeName}</Text>
                    </Text>
                  ) : (
                    <Text size="small" color="color.text.danger">
                      The first column ("{preview.uniqueKeyHeader}") doesn't match an attribute on this object type — reorder the CSV so the unique-key column comes first, or pick a different object type.
                    </Text>
                  )}

                  <Inline space="space.100" alignBlock="center">
                    <Toggle
                      id="csv-create-only-toggle"
                      isChecked={createOnly}
                      onChange={() => setCreateOnly((prev) => !prev)}
                      isDisabled={Boolean(jobInFlight)}
                    />
                    <Label labelFor="csv-create-only-toggle">
                      Create only — treat an existing match as an error instead of updating it
                    </Label>
                  </Inline>

                  <Inline>
                    <Button
                      appearance="primary"
                      onClick={handleStartImport}
                      isDisabled={!preview.uniqueKeyAttributeName || Boolean(jobInFlight)}
                    >
                      Start Import
                    </Button>
                  </Inline>
                </Stack>
              </Box>
            )}

            {job && (
              <Box xcss={summaryBoxStyle}>
                <Stack space="space.100">
                  {jobInFlight && (
                    <>
                      <Inline space="space.100" alignBlock="center">
                        <Spinner size="small" />
                        <Text size="small">
                          {job.total > 0 ? `Processing ${job.processed || 0} of ${job.total}…` : 'Starting…'}
                        </Text>
                      </Inline>
                      {job.total > 0 && (
                        <ProgressBar value={(job.processed || 0) / job.total} ariaLabel="Import progress" />
                      )}
                    </>
                  )}

                  {job.status === 'error' && (
                    <Text color="color.text.danger">{job.error || 'The import job failed unexpectedly.'}</Text>
                  )}

                  {job.status === 'done' && (
                    <Stack space="space.075">
                      {job.error ? (
                        <Text color="color.text.danger">{job.error}</Text>
                      ) : (
                        <>
                          <Text weight="medium">
                            Done — {job.summary?.created || 0} created, {job.summary?.updated || 0} updated,
                            {' '}{job.summary?.unchanged || 0} unchanged, {job.summary?.failed || 0} failed
                          </Text>
                          {job.errors?.length > 0 && (
                            <Stack space="space.025">
                              <Text size="small" color="color.text.subtlest">
                                Failed rows{job.errorsTruncated ? ` (showing first ${job.errors.length})` : ''}:
                              </Text>
                              {job.errors.map((e, i) => (
                                <Text key={i} size="small" color="color.text.danger">
                                  Row {e.row}{e.keyValue ? ` (${e.keyValue})` : ''}: {e.message}
                                </Text>
                              ))}
                            </Stack>
                          )}
                          {job.warnings?.length > 0 && (
                            <Stack space="space.025">
                              <Text size="small" color="color.text.subtlest">
                                Imported with warnings{job.warningsTruncated ? ` (showing first ${job.warnings.length})` : ''} — usually a reference column value (e.g. Model Name) that didn't match an existing object:
                              </Text>
                              {job.warnings.map((w, i) => (
                                <Text key={i} size="small" color="color.text.warning">
                                  Row {w.row}: {w.message}
                                </Text>
                              ))}
                            </Stack>
                          )}
                        </>
                      )}
                    </Stack>
                  )}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

export default App;
