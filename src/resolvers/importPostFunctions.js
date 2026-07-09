import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { Queue } from '@forge/events';
import { randomUUID } from 'crypto';
import {
  CONFIG_KEY,
  csvImportJobKey,
  importPlanKey,
  getWorkspaceId,
  fetchObjectTypeAttributeDefs,
  fetchSchemaObjectTypes,
  parseCsvRows,
  matchCsvHeadersToAttributes,
  detectObjectTypeFromName,
  extractImportUnits,
  isImportableAttachment,
} from './shared';

// ─── Automated CSV/XLSX import via workflow post-functions ─────────────────────
// Two post-functions the admin places on transitions of an import request
// type (see manifest.yml):
//
//   analyzeHandler — "Analyze": finds the NEWEST CSV/XLSX attachment on
//     the issue, splits it into import units (one for a CSV, one per
//     non-empty sheet for an XLSX), detects each unit's target object type
//     from the file/sheet NAME (see detectObjectTypeFromName in shared.js
//     — token match, longest wins, ties are ambiguous), validates columns
//     and the first-column unique key against that type, saves the whole
//     thing as a PLAN in KVS, and posts the plan as an issue comment.
//     Nothing is written to Assets at this stage.
//
//   approveHandler — "Approve": loads the saved plan and starts the actual
//     import. Confirmation is workflow-native: whoever may execute the
//     approve transition may import — no extra authorization model.
//
// Units run SEQUENTIALLY, chained through the queue: only the first
// runnable unit is enqueued here; csvImportConsumer.js calls
// advanceImportPlan when its job finishes, which enqueues the next unit
// (or finalizes the plan and posts the summary comment). Two reasons over
// pushing all units at once: (1) queue messages have no ordering
// guarantee, and workbook order matters — a "Manufacturers" sheet must
// finish before a "Laptops" sheet whose reference columns look those
// objects up by name; (2) one 900s consumer budget per sheet instead of
// per workbook.
//
// Everything here runs asApp() — post-functions and queue consumers have
// no attached user session. The panel-facing resolvers that reuse
// buildImportPlanForIssue/startImportPlanJobs add their own asUser()
// issue-visibility check first (see csvImport.js).

// Caps keep the plan comfortably under KVS's 128 KB per-value limit even
// for wide sheets / type-heavy schemas — the plan stores METADATA only,
// never row data (the consumer re-downloads and re-parses the attachment,
// same as the existing single-CSV job).
const HEADERS_CAP = 50;
const UNMATCHED_CAP = 30;
const CANDIDATES_CAP = 10;

const getIssueId = (event) => {
  const id = event?.issue?.id || event?.issue?.key || event?.context?.issue?.id;
  return id != null ? String(id) : null;
};

const isRunnableUnit = (u) => Boolean(u.objectTypeId && u.uniqueKeyOk && !u.result);

const newPendingJobRecord = () => ({
  status: 'pending', total: 0, processed: 0,
  summary: { created: 0, updated: 0, unchanged: 0, failed: 0 },
  errors: [], warnings: [],
});

// ─── Issue comments (ADF) ──────────────────────────────────────────────────────
// The only feedback channel for the automated flow — nobody is watching
// the panel. Comment failures are logged but never fail the operation
// they're reporting on.

const adfParagraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

export const postIssueComment = async (issueId, blocks) => {
  const content = blocks.map((b) =>
    typeof b === 'string'
      ? adfParagraph(b)
      : {
          type: 'bulletList',
          content: b.bullets.map((t) => ({ type: 'listItem', content: [adfParagraph(t)] })),
        }
  );
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/comment`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: { type: 'doc', version: 1, content } }),
    });
    if (!res.ok) {
      console.warn(`[postIssueComment] ${issueId} failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn(`[postIssueComment] ${issueId} failed:`, err?.message || err);
  }
};

const unitLabel = (plan, unit) =>
  unit.sheetName ? `Sheet "${unit.sheetName}"` : `File "${plan.filename}"`;

const unitPlanLine = (plan, unit) => {
  const label = unitLabel(plan, unit);
  if (unit.objectTypeId && unit.uniqueKeyOk) {
    let line =
      `${label} -> ${unit.objectTypeName} (matched by ${unit.matchedBy === 'manual' ? 'manual choice' : 'name'}) — ` +
      `${unit.totalRows} row(s), ${unit.matchedColumns}/${unit.totalColumns} column(s) matched, ` +
      `key column "${unit.uniqueKeyHeader}" OK`;
    if (unit.isParentType) {
      line += `. NOTE: ${unit.objectTypeName} is a PARENT type — if the objects belong in one of its child types, change it in the AssetDesk import panel before approving`;
    }
    return line;
  }
  return `${label} -> SKIPPED: ${unit.reason || 'no object type resolved'}`;
};

// ─── Plan building (the "analyze" half) ────────────────────────────────────────

export const buildImportPlanForIssue = async (issueId, { analyzedBy = 'postfunction' } = {}) => {
  const config = (await kvs.get(CONFIG_KEY)) || {};
  if (!config.schemaId) return { error: 'No Assets schema configured.' };

  const existing = await kvs.get(importPlanKey(issueId));
  if (existing?.status === 'importing') {
    return { error: 'An import is currently running for this ticket — wait for it to finish before re-analyzing.', plan: existing };
  }

  const issueRes = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}?fields=attachment`);
  if (!issueRes.ok) {
    return { error: `Could not read this ticket's attachments: ${issueRes.status}` };
  }
  const allAttachments = (await issueRes.json()).fields?.attachment || [];
  // Newest importable attachment only — analyzing several at once confuses
  // more than it helps; re-attaching and re-analyzing is the workflow.
  const attachment = allAttachments
    .filter(isImportableAttachment)
    .sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0))[0];
  if (!attachment) {
    return { error: 'No CSV or XLSX attachment found on this ticket.' };
  }

  const contentRes = await api.asApp().requestJira(route`/rest/api/3/attachment/content/${attachment.id}`);
  if (!contentRes.ok) {
    return { error: `Could not download "${attachment.filename}": ${contentRes.status}` };
  }
  const buffer = Buffer.from(await contentRes.arrayBuffer());

  const { kind, units: rawUnits } = extractImportUnits(buffer, attachment.filename);
  if (rawUnits.length === 0) {
    return { error: `"${attachment.filename}" has no non-empty sheets.` };
  }

  const workspaceId = await getWorkspaceId(true);
  const objectTypes = await fetchSchemaObjectTypes(api.asApp(), workspaceId, config.schemaId);
  const parentIds = new Set(objectTypes.map((t) => t.parentObjectTypeId).filter(Boolean));

  // Two sheets can legitimately target the same type across re-analyses of
  // similar files — cache attribute-def fetches per type within this run.
  const defsByType = new Map();
  const getDefs = async (typeId) => {
    if (!defsByType.has(typeId)) {
      defsByType.set(typeId, await fetchObjectTypeAttributeDefs(api.asApp(), workspaceId, typeId));
    }
    return defsByType.get(typeId);
  };

  const units = [];
  for (let i = 0; i < rawUnits.length; i++) {
    const raw = rawUnits[i];
    const { headers, rows } = parseCsvRows(raw.csvText);
    const unit = {
      index: i,
      sheetName: raw.sheetName,
      nameSource: raw.nameSource,
      totalRows: rows.length,
      headers: headers.slice(0, HEADERS_CAP),
      totalColumns: headers.length,
      objectTypeId: null,
      objectTypeName: '',
      matchedBy: null,
      isParentType: false,
      candidates: [],
      matchedColumns: 0,
      unmatchedColumns: [],
      uniqueKeyOk: false,
      uniqueKeyHeader: headers[0] || '',
      reason: '',
    };
    units.push(unit);

    if (headers.length === 0) {
      unit.reason = 'No columns found — is this a valid CSV/sheet?';
      continue;
    }

    const detection = detectObjectTypeFromName(raw.nameSource, objectTypes);
    if (!detection.match) {
      unit.candidates = detection.candidates.slice(0, CANDIDATES_CAP).map((t) => ({ id: t.id, name: t.name }));
      unit.reason = detection.ambiguous
        ? `Name "${raw.nameSource}" matches more than one object type (${unit.candidates.map((c) => c.name).join(', ')}) — pick one in the AssetDesk import panel.`
        : `No object type name found in "${raw.nameSource}" — rename the ${raw.sheetName ? 'sheet' : 'file'} to include one, or pick a type in the AssetDesk import panel.`;
      continue;
    }

    const type = detection.match;
    if (type.abstract) {
      const children = objectTypes.filter((t) => t.parentObjectTypeId === type.id);
      unit.candidates = children.slice(0, CANDIDATES_CAP).map((t) => ({ id: t.id, name: t.name }));
      unit.reason = `"${type.name}" is an abstract object type and can't hold objects — pick one of its child types${children.length ? ` (${children.map((c) => c.name).join(', ')})` : ''} in the AssetDesk import panel.`;
      continue;
    }

    unit.objectTypeId = type.id;
    unit.objectTypeName = type.name;
    unit.matchedBy = 'name';
    // A parent type CAN hold objects, so a match on one isn't blocked —
    // but in a parent/children schema the objects usually live in the
    // children, so it's flagged loudly in the plan comment instead.
    unit.isParentType = parentIds.has(type.id);

    const defs = await getDefs(type.id);
    const { matched, unmatched } = matchCsvHeadersToAttributes(headers, defs);
    unit.matchedColumns = matched.length;
    unit.unmatchedColumns = unmatched.slice(0, UNMATCHED_CAP);
    // Same first-column-is-the-unique-key convention as the manual flow
    // (previewCsvImport / csvImportConsumer.js).
    unit.uniqueKeyOk = matched.some((m) => m.header === headers[0]);
    if (!unit.uniqueKeyOk) {
      unit.reason = `First column "${headers[0]}" doesn't match an attribute on ${type.name} — this ${raw.sheetName ? 'sheet' : 'file'} will be skipped unless fixed.`;
    }
  }

  const plan = {
    status: 'awaiting-confirmation',
    attachmentId: String(attachment.id),
    filename: attachment.filename,
    kind,
    createdAt: Date.now(),
    analyzedBy,
    createOnly: false,
    units,
  };
  await kvs.set(importPlanKey(issueId), plan);
  console.log(
    `[buildImportPlanForIssue] issueId=${issueId} file="${plan.filename}" kind=${kind} ` +
    `units=${units.length} runnable=${units.filter(isRunnableUnit).length} analyzedBy=${analyzedBy}`
  );
  return { plan };
};

// ─── Plan execution (the "approve" half) ───────────────────────────────────────

const enqueueUnitJob = async (issueId, plan, unit) => {
  const jobId = randomUUID();
  unit.jobId = jobId;
  // Pending marker BEFORE the push — same ordering rationale as
  // startCsvImportJob in csvImport.js.
  await kvs.set(csvImportJobKey(jobId), newPendingJobRecord());
  await kvs.set(importPlanKey(issueId), plan);
  const queue = new Queue({ key: 'csv-import-queue' });
  await queue.push({
    body: {
      jobId,
      issueId,
      attachmentId: plan.attachmentId,
      objectTypeId: unit.objectTypeId,
      sheetName: unit.sheetName,
      filename: plan.filename,
      createOnly: Boolean(plan.createOnly),
      plan: { issueId, unitIndex: unit.index },
    },
  });
  return jobId;
};

export const startImportPlanJobs = async (issueId, { createOnly = false } = {}) => {
  const plan = await kvs.get(importPlanKey(issueId));
  if (!plan) {
    return { error: 'No import plan found for this ticket — run the analyze step (or the panel\'s Analyze button) first.' };
  }
  if (plan.status === 'importing') {
    return { error: 'An import is already running for this ticket.' };
  }
  // Re-running a finished plan is allowed (the import is an upsert, so a
  // re-run is idempotent-ish) — clear the previous run's results first.
  if (plan.status === 'done') {
    plan.units.forEach((u) => { delete u.result; delete u.jobId; });
  }

  const runnable = plan.units.filter(isRunnableUnit);
  if (runnable.length === 0) {
    return { error: 'No sheet in the plan is ready to import — resolve the object types in the AssetDesk import panel first.' };
  }

  plan.status = 'importing';
  plan.createOnly = Boolean(createOnly);
  plan.startedAt = Date.now();
  // Only the FIRST runnable unit is enqueued — csvImportConsumer.js chains
  // the rest via advanceImportPlan (see module comment for why).
  await enqueueUnitJob(issueId, plan, runnable[0]);
  console.log(`[startImportPlanJobs] issueId=${issueId} queued unit ${runnable[0].index} of ${runnable.length} runnable`);
  return { plan, started: runnable.length };
};

// Called by csvImportConsumer.js after each plan-chained job reaches a
// terminal state: records the unit's outcome, enqueues the next runnable
// unit, or — when none remain — finalizes the plan and posts the summary
// comment.
export const advanceImportPlan = async ({ issueId, unitIndex, outcome }) => {
  const plan = await kvs.get(importPlanKey(issueId));
  if (!plan || plan.status !== 'importing') {
    console.warn(`[advanceImportPlan] issueId=${issueId} no importing plan found — skipping`);
    return;
  }
  const unit = plan.units.find((u) => u.index === unitIndex);
  if (unit) unit.result = outcome || {};

  const next = plan.units.find((u) => u.index > unitIndex && isRunnableUnit(u));
  if (next) {
    await enqueueUnitJob(issueId, plan, next);
    console.log(`[advanceImportPlan] issueId=${issueId} unit ${unitIndex} done, queued unit ${next.index}`);
    return;
  }

  plan.status = 'done';
  plan.finishedAt = Date.now();
  await kvs.set(importPlanKey(issueId), plan);
  console.log(`[advanceImportPlan] issueId=${issueId} all units done`);

  const lines = plan.units.map((u) => {
    const label = unitLabel(plan, u);
    if (!u.result) return `${label} -> skipped (${u.reason || 'no object type resolved'})`;
    if (u.result.error) return `${label} -> FAILED: ${u.result.error}`;
    const s = u.result.summary || {};
    return `${label} -> ${u.objectTypeName}: ${s.created || 0} created, ${s.updated || 0} updated, ${s.unchanged || 0} unchanged, ${s.failed || 0} failed`;
  });
  await postIssueComment(issueId, [
    `AssetDesk import finished for "${plan.filename}":`,
    { bullets: lines },
  ]);
};

// ─── The post-function handlers themselves (see manifest.yml) ──────────────────

export const analyzeHandler = async (event) => {
  const issueId = getIssueId(event);
  if (!issueId) {
    console.error('[analyzeHandler] could not determine issue from event', event);
    return;
  }
  try {
    const { plan, error } = await buildImportPlanForIssue(issueId, { analyzedBy: 'postfunction' });
    if (error) {
      await postIssueComment(issueId, [`AssetDesk import: ${error}`]);
      return;
    }
    const runnable = plan.units.filter(isRunnableUnit).length;
    await postIssueComment(issueId, [
      `AssetDesk import plan for "${plan.filename}" — ${runnable} of ${plan.units.length} ${plan.kind === 'xlsx' ? 'sheet(s)' : 'file(s)'} ready to import:`,
      { bullets: plan.units.map((u) => unitPlanLine(plan, u)) },
      'To run it, execute the transition that has the "AssetDesk — Run approved asset import" post-function, or open the "Import Assets from CSV" panel on this ticket to adjust and confirm. Nothing has been imported yet.',
    ]);
  } catch (err) {
    console.error('[analyzeHandler] failed:', err);
    await postIssueComment(issueId, [`AssetDesk import analysis failed: ${err?.message || 'unexpected error'}`]);
  }
};

export const approveHandler = async (event) => {
  const issueId = getIssueId(event);
  if (!issueId) {
    console.error('[approveHandler] could not determine issue from event', event);
    return;
  }
  try {
    // createOnly deliberately defaults to false (upsert) on the workflow
    // path — the safer create-only mode is available from the panel, where
    // a human is choosing it consciously.
    const { plan, started, error } = await startImportPlanJobs(issueId, { createOnly: false });
    if (error) {
      await postIssueComment(issueId, [`AssetDesk import: ${error}`]);
      return;
    }
    await postIssueComment(issueId, [
      `AssetDesk import started for "${plan.filename}" — ${started} ${plan.kind === 'xlsx' ? 'sheet(s)' : 'file(s)'} queued. A summary comment will be posted here when it finishes.`,
    ]);
  } catch (err) {
    console.error('[approveHandler] failed:', err);
    await postIssueComment(issueId, [`AssetDesk import failed to start: ${err?.message || 'unexpected error'}`]);
  }
};
