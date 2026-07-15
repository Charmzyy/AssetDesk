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
  IMPORT_TEMPLATE_FILENAME,
} from './shared';
import { attachImportTemplateToIssue } from './importTemplate';

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

// How many per-row errors/warnings each unit's result keeps in the PLAN
// (and therefore in the comment + panel). The job record itself keeps up
// to 200 of each (csvImportConsumer.js) — but the plan holds every
// unit's result in ONE KVS value, so a 10-sheet workbook at 200 errors a
// sheet would blow the 128 KB cap. Small caps here; the comment points
// at the panel/job record for the rest.
const PLAN_RESULT_ERRORS_CAP = 10;
const PLAN_RESULT_WARNINGS_CAP = 5;

// How many unmatched-column NAMES the plan comment spells out per unit —
// beyond this it's "+N more", and the true total comes from
// totalColumns - matchedColumns (unmatchedColumns itself is capped at
// UNMATCHED_CAP, so its length can undercount).
const COMMENT_UNMATCHED_CAP = 8;

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

// A paragraph is a string, or an array of segments for mixed text/links —
// a segment is a string or { text, href } (rendered as an inline link,
// used to link the attached template file right in the comment).
const adfTextSegment = (seg) =>
  typeof seg === 'string'
    ? { type: 'text', text: seg }
    : { type: 'text', text: seg.text, marks: [{ type: 'link', attrs: { href: seg.href } }] };

const adfParagraph = (segments) => ({
  type: 'paragraph',
  content: (Array.isArray(segments) ? segments : [segments]).map(adfTextSegment),
});

export const postIssueComment = async (issueId, blocks) => {
  const content = blocks.map((b) =>
    typeof b === 'string' || Array.isArray(b)
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
      `${label} -> ${unit.objectTypeName}${unit.matchedBy === 'manual' ? ' (manual)' : ''} — ` +
      `${unit.totalRows} row(s), ${unit.matchedColumns}/${unit.totalColumns} columns matched, key "${unit.uniqueKeyHeader}" OK`;
    // Name the columns that WON'T import, not just the count — "8/11
    // matched" leaves the user diffing headers against the schema by
    // hand; naming the three losers tells them exactly what to rename.
    const unmatchedTotal = unit.totalColumns - unit.matchedColumns;
    if (unmatchedTotal > 0 && unit.unmatchedColumns?.length > 0) {
      const shown = unit.unmatchedColumns.slice(0, COMMENT_UNMATCHED_CAP);
      const more = unmatchedTotal - shown.length;
      line += `. Ignored columns: ${shown.map((h) => `"${h}"`).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
    }
    if (unit.isParentType) {
      line += `. NOTE: ${unit.objectTypeName} is a PARENT type — if these belong in a child type, change it in the import panel first`;
    }
    return line;
  }
  return `${label} -> skipped: ${unit.reason || 'no object type resolved'}`;
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
  // The generated template is excluded by its fixed filename: it's a valid
  // XLSX this app may itself have attached (see analyzeHandler), and it
  // must never win the "newest" pick over the user's actual data file.
  const attachment = allAttachments
    .filter(isImportableAttachment)
    .filter((a) => (a.filename || '').toLowerCase() !== IMPORT_TEMPLATE_FILENAME.toLowerCase())
    .sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0))[0];
  if (!attachment) {
    // errorCode lets analyzeHandler react to THIS failure specifically
    // (attach a template showing what to upload) without string-matching
    // the human-readable message.
    return { error: 'No CSV or XLSX attachment found on this ticket.', errorCode: 'no-attachment' };
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
        ? `"${raw.nameSource}" matches several object types (${unit.candidates.map((c) => c.name).join(', ')}) — pick one in the import panel.`
        : `No object type matches "${raw.nameSource}" — rename the ${raw.sheetName ? 'sheet' : 'file'} after a type, or pick one in the import panel.`;
      continue;
    }

    const type = detection.match;
    if (type.abstract) {
      const children = objectTypes.filter((t) => t.parentObjectTypeId === type.id);
      unit.candidates = children.slice(0, CANDIDATES_CAP).map((t) => ({ id: t.id, name: t.name }));
      unit.reason = `"${type.name}" is abstract and can't hold objects — pick one of its child types${children.length ? ` (${children.map((c) => c.name).join(', ')})` : ''} in the import panel.`;
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
  if (unit) {
    // The outcome's errors/warnings arrive uncapped-in-memory (up to the
    // job record's 200 each) — cap them before they're persisted into the
    // plan, which holds EVERY unit's result in one KVS value (see
    // PLAN_RESULT_*_CAP above). warningsTotal is kept because, unlike
    // failures (summary.failed), nothing else records how many there were.
    const allWarnings = outcome?.warnings || [];
    unit.result = {
      summary: outcome?.summary,
      error: outcome?.error,
      errors: (outcome?.errors || []).slice(0, PLAN_RESULT_ERRORS_CAP),
      warnings: allWarnings.slice(0, PLAN_RESULT_WARNINGS_CAP),
      warningsTotal: allWarnings.length,
    };
  }

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
  const blocks = [
    `AssetDesk import finished for "${plan.filename}":`,
    { bullets: lines },
  ];

  // Per-row detail under the counts — the comment is this flow's only
  // feedback channel, and "2 failed" with no row/reason forces the user
  // to open the panel just to find out what to fix. Capped per unit (see
  // PLAN_RESULT_*_CAP); anything beyond the caps points at the panel.
  let anyOverflow = false;
  plan.units.forEach((u) => {
    if (!u.result) return;
    const label = unitLabel(plan, u);
    const failedTotal = u.result.summary?.failed || 0;
    const errs = u.result.errors || [];
    if (errs.length > 0) {
      blocks.push(`${label} — failed rows${failedTotal > errs.length ? ` (first ${errs.length} of ${failedTotal})` : ''}:`);
      blocks.push({ bullets: errs.map((e) => `Row ${e.row}${e.keyValue ? ` (${e.keyValue})` : ''}: ${e.message}`) });
      if (failedTotal > errs.length) anyOverflow = true;
    }
    const warns = u.result.warnings || [];
    const warningsTotal = u.result.warningsTotal || warns.length;
    if (warns.length > 0) {
      blocks.push(`${label} — imported with warnings${warningsTotal > warns.length ? ` (first ${warns.length} of ${warningsTotal})` : ''}:`);
      blocks.push({ bullets: warns.map((w) => `Row ${w.row}: ${w.message}`) });
      if (warningsTotal > warns.length) anyOverflow = true;
    }
  });
  if (anyOverflow) {
    blocks.push('Open the "Import Assets from CSV" panel on this ticket for the full list.');
  }
  await postIssueComment(issueId, blocks);
};

// ─── The post-function handlers themselves (see manifest.yml) ──────────────────

// Attaches the generated import template to the issue and returns the
// comment paragraph describing it — a segment array so the filename is a
// clickable download link (see adfTextSegment) — or null when there's
// nothing to say (no schema configured, or the upload failed).
// Best-effort by design: the analysis result must post whether or not
// this works. The structure explanation itself lives on the template's
// README sheet, so the comment stays to one line.
const tryAttachTemplate = async (issueId) => {
  try {
    const config = (await kvs.get(CONFIG_KEY)) || {};
    if (!config.schemaId) return null;
    const workspaceId = await getWorkspaceId(true);
    const { status, url } = await attachImportTemplateToIssue(issueId, workspaceId, config.schemaId);
    if (status === 'failed') return null;
    const fileRef = url ? { text: IMPORT_TEMPLATE_FILENAME, href: url } : `"${IMPORT_TEMPLATE_FILENAME}"`;
    return [
      status === 'attached' ? 'Template ' : 'See the attached template ',
      fileRef,
      status === 'attached' ? ' attached' : '',
      ' — fill it in (go through  the README sheet), save it under a new file name and attach it here.',
    ].filter((seg) => seg !== '');
  } catch (err) {
    console.warn(`[tryAttachTemplate] ${issueId} failed:`, err?.message || err);
    return null;
  }
};

export const analyzeHandler = async (event) => {
  const issueId = getIssueId(event);
  if (!issueId) {
    console.error('[analyzeHandler] could not determine issue from event', event);
    return;
  }
  try {
    const { plan, error, errorCode } = await buildImportPlanForIssue(issueId, { analyzedBy: 'postfunction' });
    if (error) {
      const blocks = [`AssetDesk import: ${error}`];
      // No file at all is the same knowledge gap as a wrongly-named one —
      // give the user the template that shows what to upload.
      if (errorCode === 'no-attachment') {
        const templateNote = await tryAttachTemplate(issueId);
        if (templateNote) blocks.push(templateNote);
      }
      await postIssueComment(issueId, blocks);
      return;
    }
    const runnable = plan.units.filter(isRunnableUnit).length;
    const blocks = [
      `AssetDesk import plan for "${plan.filename}" — ${runnable} of ${plan.units.length} ${plan.kind === 'xlsx' ? 'sheet(s)' : 'file(s)'} ready to import:`,
      { bullets: plan.units.map((u) => unitPlanLine(plan, u)) },
    ];
    // Any unit without a resolved object type means the file/sheet naming
    // didn't line up with the schema — exactly the situation the template
    // exists to demonstrate. (Units that resolved but failed the key
    // check get column-level guidance in their plan line instead.)
    if (plan.units.some((u) => !u.objectTypeId)) {
      const templateNote = await tryAttachTemplate(issueId);
      if (templateNote) blocks.push(templateNote);
    }
    // The how-to-run line only earns its place when there's something to
    // run; a 0-ready plan ends on the fix-it guidance instead.
    blocks.push(
      runnable > 0
        ? 'To import: run the approve transition, or confirm in the "Import Assets from CSV" panel on this ticket. Nothing has been imported yet.'
        : 'Nothing has been imported yet.'
    );
    await postIssueComment(issueId, blocks);
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
