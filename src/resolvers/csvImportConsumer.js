import { kvs } from '@forge/kvs';
import api, { route } from '@forge/api';
import * as XLSX from 'xlsx';
import { advanceImportPlan } from './importPostFunctions';
import {
  CONFIG_KEY,
  csvImportJobKey,
  getWorkspaceId,
  fetchObjectTypeAttributeDefs,
  parseCsvRows,
  matchCsvHeadersToAttributes,
  normalizeDateValue,
  escapeAqlValue,
  searchAssetsSinglePage,
  getAttributeId,
  getAttrValue,
} from './shared';

// ─── CSV import job consumer ───────────────────────────────────────────────────
// Does the actual work previewCsvImport only validates: parses the CSV
// again (the queued payload carries attachmentId, not the parsed rows —
// KVS/queue payloads have size limits and re-parsing is cheap), then for
// each row looks up an existing asset by its unique-key column (always
// the first CSV column — see previewCsvImport) and updates it, or creates
// a new one if none exists. See manifest.yml's csv-import-job-consumer /
// csv-import-queue.
//
// Always asApp() — queue-triggered invocations have no attached user
// session (same constraint as assetLoadConsumer.js). Object writes
// already go through asApp() by default elsewhere in this app
// (updateAssetAttribute's serviceAccount mode), so this isn't a new
// pattern for the write side; it just also now applies to the CSV read.
//
// Results are stored as SUMMARY COUNTS plus capped lists of per-row
// errors/warnings, not a full per-row list — a CSV with thousands of rows
// could otherwise push the job's KVS entry past the 128KB per-value limit
// (see CACHE_MAX_ASSETS in shared.js for the same concern elsewhere in
// this app). Successes don't need individual call-outs; failures and
// notable warnings do, so those are what's capped-but-kept.
const CHUNK_SIZE = 10; // bounded concurrency per batch — parallel within a
                        // batch, sequential across batches, so a large CSV
                        // doesn't fire hundreds of Assets API calls at once
const MAX_ERROR_ENTRIES = 200;
const MAX_WARNING_ENTRIES = 200;

// "object"-type attributes (e.g. Model Name → Hardware Models) reference
// ANOTHER object type — Assets rejects a plain display name for those
// ("Samsung is not valid Object id or key"), so the CSV's text has to be
// looked up in the referenced object type to find the actual object id to
// send. Cached (via the caller-supplied `cache` Map) since the same
// reference value (e.g. "Samsung") typically repeats across many rows —
// but the cache is created fresh per handler invocation (see `handler`
// below), not held at module scope, since a warm Forge container could
// otherwise reuse a stale id across unrelated import jobs if the
// referenced object was renamed/recreated in between.
const resolveObjectReference = async (cache, workspaceId, schemaId, referenceObjectTypeId, name) => {
  const cacheKey = `${referenceObjectTypeId}:${name.toLowerCase()}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const aql = `objectTypeId = ${referenceObjectTypeId} AND objectSchemaId = ${schemaId} AND Name = "${escapeAqlValue(name)}"`;
  const lookup = await searchAssetsSinglePage(workspaceId, aql, true);
  const match = (lookup.values || [])[0];
  const resolvedId = match ? String(match.id) : null;
  cache.set(cacheKey, resolvedId);
  return resolvedId;
};

// Builds the {objectTypeAttributeId, objectAttributeValues} array a
// create/update call needs, from one CSV row's matched columns. Async
// because "object"-type attributes need a lookup — everything else is
// synchronous under the hood.
const buildAttributesPayload = async ({ matched, row, workspaceId, schemaId, rowNumber, recordWarning, referenceCache }) => {
  const entries = await Promise.all(
    matched.map(async ({ header, attribute }) => {
      const rawValue = String(row[header] ?? '').trim();
      if (!rawValue) return null;

      // Date attributes need Assets' ISO 'YYYY-MM-DD' format — a
      // spreadsheet's displayed 'DD/MM/YYYY' (or a raw Excel date serial,
      // if the source file stored one) gets rejected outright otherwise
      // ("21/10/2025 is not valid (Date)").
      if (attribute.attributeType === 'date') {
        return { objectTypeAttributeId: Number(attribute.attributeId), value: normalizeDateValue(rawValue) };
      }

      // Reference attributes: resolve the CSV's display text to the
      // referenced object's id. If nothing matches (typo, or the
      // referenced object genuinely doesn't exist), drop just this one
      // attribute — rather than failing the whole row — but flag it as a
      // warning so it isn't silently lost.
      if (attribute.attributeType === 'object' && attribute.referenceObjectTypeId) {
        const resolvedId = await resolveObjectReference(referenceCache, workspaceId, schemaId, attribute.referenceObjectTypeId, rawValue);
        if (!resolvedId) {
          recordWarning(rowNumber, `"${rawValue}" not found for ${attribute.attributeName} — left blank`);
          return null;
        }
        return { objectTypeAttributeId: Number(attribute.attributeId), value: resolvedId };
      }

      return { objectTypeAttributeId: Number(attribute.attributeId), value: rawValue };
    })
  );

  return entries
    .filter(Boolean)
    .map(({ objectTypeAttributeId, value }) => ({
      objectTypeAttributeId,
      objectAttributeValues: [{ value }],
    }));
};

export const handler = async (event) => {
  // sheetName/filename/plan are only present on plan-chained jobs from
  // importPostFunctions.js (or the panel's plan confirm); the original
  // single-CSV panel flow sends neither and behaves exactly as before.
  const { jobId, attachmentId, objectTypeId, createOnly, sheetName, filename, plan: planRef } = event.body || {};

  if (!jobId) {
    console.error('[csvImportConsumer] event missing jobId — cannot report a result anywhere', event);
    return;
  }

  // Duplicate-within-file and missing-unique-key rows are counted under
  // `failed` (with a message in `errors`) rather than a separate
  // "skipped" bucket — from the agent's perspective both are just "this
  // row didn't import, here's why," and one bucket is simpler to read.
  const summary = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  const errors = [];
  let errorsTruncated = false;
  const recordError = (rowNumber, keyValue, message) => {
    summary.failed += 1;
    if (errors.length < MAX_ERROR_ENTRIES) {
      errors.push({ row: rowNumber, keyValue, message });
    } else {
      errorsTruncated = true;
    }
  };

  // Warnings don't count as failures — the row still imported, just with
  // one attribute dropped (see buildAttributesPayload's reference
  // resolution above).
  const warnings = [];
  let warningsTruncated = false;
  const recordWarning = (rowNumber, message) => {
    if (warnings.length < MAX_WARNING_ENTRIES) {
      warnings.push({ row: rowNumber, message });
    } else {
      warningsTruncated = true;
    }
  };

  // Terminal-state writer — every done/error exit goes through here so a
  // plan-chained job (planRef present) also advances its import plan:
  // record this unit's outcome, enqueue the next sheet, or finalize the
  // plan and post the summary comment (see importPostFunctions.js). Plan
  // bookkeeping failures are logged but never clobber the job's own
  // result record, which is already written by then.
  const finalizeJob = async (record) => {
    await kvs.set(csvImportJobKey(jobId), record);
    if (!planRef) return;
    try {
      // errors/warnings ride along uncapped (well, at the job record's own
      // 200-each cap) — advanceImportPlan trims them to its own much
      // smaller caps before persisting them into the plan and the summary
      // comment.
      await advanceImportPlan({
        issueId: planRef.issueId,
        unitIndex: planRef.unitIndex,
        outcome: { summary: record.summary, error: record.error, errors: record.errors, warnings: record.warnings },
      });
    } catch (err) {
      console.error(`[csvImportConsumer] jobId=${jobId} failed to advance the import plan:`, err);
    }
  };

  try {
    const config = (await kvs.get(CONFIG_KEY)) || {};
    if (!config.schemaId) {
      await finalizeJob({
        status: 'done', total: 0, processed: 0, summary, errors, errorsTruncated, warnings, warningsTruncated,
        error: 'No Assets schema configured.',
      });
      return;
    }

    const caller = api.asApp();
    const contentRes = await caller.requestJira(route`/rest/api/3/attachment/content/${attachmentId}`);
    if (!contentRes.ok) {
      await finalizeJob({
        status: 'done', total: 0, processed: 0, summary, errors, errorsTruncated, warnings, warningsTruncated,
        error: `Could not download the attachment: ${contentRes.status}`,
      });
      return;
    }
    // XLSX attachments are binary — .text() would mangle them, so download
    // as a buffer either way. A bare CSV is just the buffer as UTF-8; an
    // XLSX sheet becomes CSV text via sheet_to_csv, so everything
    // downstream (parseCsvRows, header matching, the first-column
    // unique-key convention) is identical to the original single-CSV path.
    const buffer = Buffer.from(await contentRes.arrayBuffer());
    let csvText;
    if (sheetName != null || /\.xlsx$/i.test(filename || '')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const targetSheet = sheetName != null ? sheetName : workbook.SheetNames[0];
      const sheet = workbook.Sheets[targetSheet];
      if (!sheet) {
        await finalizeJob({
          status: 'done', total: 0, processed: 0, summary, errors, errorsTruncated, warnings, warningsTruncated,
          error: `Sheet "${targetSheet}" no longer exists in "${filename || 'the attachment'}" — was the file replaced after it was analyzed? Re-run the analyze step.`,
        });
        return;
      }
      csvText = XLSX.utils.sheet_to_csv(sheet);
    } else {
      csvText = buffer.toString('utf8');
    }
    const { headers, rows } = parseCsvRows(csvText);

    const workspaceId = await getWorkspaceId(true);
    const attributeDefs = await fetchObjectTypeAttributeDefs(caller, workspaceId, objectTypeId);
    const { matched } = matchCsvHeadersToAttributes(headers, attributeDefs);

    // The first CSV column is always the unique key, by convention — same
    // rule previewCsvImport applies, so what the agent previewed is
    // exactly what gets used here.
    const uniqueKeyHeader = headers[0];
    const uniqueKeyMatch = matched.find((m) => m.header === uniqueKeyHeader);
    if (!uniqueKeyMatch) {
      await finalizeJob({
        status: 'done', total: rows.length, processed: 0, summary, errors, errorsTruncated, warnings, warningsTruncated,
        error: `The first column "${uniqueKeyHeader}" doesn't match an attribute on this object type — nothing was imported.`,
      });
      return;
    }
    const uniqueKeyAttributeName = uniqueKeyMatch.attribute.attributeName;

    console.log(
      `[csvImportConsumer] jobId=${jobId} objectTypeId=${objectTypeId} sheet=${sheetName ?? '(csv)'} totalRows=${rows.length} ` +
      `matchedColumns=${matched.length}/${headers.length} uniqueKeyHeader="${uniqueKeyHeader}" (attribute="${uniqueKeyAttributeName}")`
    );

    await kvs.set(csvImportJobKey(jobId), { status: 'in_progress', total: rows.length, processed: 0, summary, errors, errorsTruncated, warnings, warningsTruncated });

    const seenKeyValues = new Set();
    // Scoped to this one job run — see the comment on resolveObjectReference
    // for why this isn't held at module scope.
    const referenceCache = new Map();
    let processed = 0;

    const processRow = async (row, rowNumber) => {
      const keyValue = String(row[uniqueKeyHeader] ?? '').trim();
      if (!keyValue) {
        recordError(rowNumber, '', `Missing ${uniqueKeyAttributeName}`);
        return;
      }
      if (seenKeyValues.has(keyValue)) {
        recordError(rowNumber, keyValue, `Duplicate ${uniqueKeyAttributeName} within this file — only the first occurrence was processed`);
        return;
      }
      seenKeyValues.add(keyValue);

      try {
        const attributesPayload = await buildAttributesPayload({
          matched, row, workspaceId, schemaId: config.schemaId, rowNumber, recordWarning, referenceCache,
        });
        const aql = `objectTypeId = ${objectTypeId} AND objectSchemaId = ${config.schemaId} AND "${uniqueKeyAttributeName}" = "${escapeAqlValue(keyValue)}"`;

        const lookup = await searchAssetsSinglePage(workspaceId, aql, true);
        if (lookup.error) {
          recordError(rowNumber, keyValue, `Lookup failed: ${lookup.error}`);
          return;
        }

        const existing = (lookup.values || [])[0];
        if (existing && createOnly) {
          // Strict create-only mode: an existing match means either a
          // reused key (someone didn't realize this asset was already in
          // the system) or a genuinely different asset that happens to
          // share the same key value — either way, silently overwriting
          // it is the wrong call. Report it as a failed row instead of
          // touching the existing object at all.
          recordError(rowNumber, keyValue, `An asset with this ${uniqueKeyAttributeName} already exists (${existing.objectKey || existing.id}) — not overwritten (create-only mode)`);
          return;
        }
        if (existing) {
          // Only write if something in this row actually differs from
          // what's already stored — otherwise every re-run of the same
          // CSV would PUT every matched row again with no real change,
          // which is wasted API calls and misleadingly reports rows as
          // "updated" that weren't. existing.attributes is already
          // present (searchAssetsSinglePage always requests
          // includeAttributes=true), and getAttrValue(attr, true) returns
          // values in the same raw shape buildAttributesPayload computes
          // (ISO dates, referenced-object ids, plain text), so they're
          // directly comparable.
          const currentValueById = new Map(
            (existing.attributes || []).map((attr) => [getAttributeId(attr), getAttrValue(attr, true)])
          );
          const hasChanges = attributesPayload.some(({ objectTypeAttributeId, objectAttributeValues }) => {
            const newValue = objectAttributeValues[0]?.value ?? '';
            const currentValue = currentValueById.get(String(objectTypeAttributeId)) ?? '';
            return newValue !== currentValue;
          });

          if (!hasChanges) {
            summary.unchanged += 1;
            return;
          }

          const res = await caller.requestJira(
            route`/jsm/assets/workspace/${workspaceId}/v1/object/${existing.id}`,
            {
              method: 'PUT',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({
                objectTypeId: Number(objectTypeId),
                attributes: attributesPayload,
                avatarUUID: '',
                hasAvatar: false,
              }),
            }
          );
          if (!res.ok) {
            recordError(rowNumber, keyValue, `Update failed: ${res.status} ${await res.text()}`);
            return;
          }
          summary.updated += 1;
        } else {
          const res = await caller.requestJira(
            route`/jsm/assets/workspace/${workspaceId}/v1/object/create`,
            {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({
                objectTypeId: Number(objectTypeId),
                attributes: attributesPayload,
                avatarUUID: '',
                hasAvatar: false,
              }),
            }
          );
          if (!res.ok) {
            recordError(rowNumber, keyValue, `Create failed: ${res.status} ${await res.text()}`);
            return;
          }
          summary.created += 1;
        }
      } catch (e) {
        recordError(rowNumber, keyValue, e?.message || 'Unexpected error processing this row');
      }
    };

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map((row, idx) => processRow(row, i + idx + 1))); // 1-indexed row numbers for display
      processed += chunk.length;
      await kvs.set(csvImportJobKey(jobId), { status: 'in_progress', total: rows.length, processed, summary, errors, errorsTruncated, warnings, warningsTruncated });
    }

    console.log(`[csvImportConsumer] jobId=${jobId} DONE`, summary);
    await finalizeJob({ status: 'done', total: rows.length, processed: rows.length, summary, errors, errorsTruncated, warnings, warningsTruncated });
  } catch (error) {
    console.error(`[csvImportConsumer] jobId=${jobId} job failed:`, error);
    try {
      await finalizeJob({ status: 'error', summary, error: error?.message || 'CSV import failed' });
    } catch (_) {
      // Frontend poll will eventually time out on its own if even this write fails.
    }
  }
};
