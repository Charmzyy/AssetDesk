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
  parseCsvRows,
  matchCsvHeadersToAttributes,
  isUnlicensedCaller,
} from './shared';
import { buildImportPlanForIssue, startImportPlanJobs } from './importPostFunctions';

// ─── CSV ticket-attachment asset import ────────────────────────────────────────
// Lets an agent attach a CSV to a ticket, pick which attachment + which
// Assets object type it maps to, preview the column matching, then kick
// off a background import (see csvImportConsumer.js) that looks up each
// row by its unique key and updates the existing asset or creates a new
// one. The FIRST CSV column is always the unique key (by convention — no
// picker, no config) — csvImportConsumer.js re-derives this the same way
// from the same parsed headers, so preview and the actual import always
// agree on which column that is. Registered from src/resolvers/index.js
// alongside registerAdminResolvers/registerExportAssets — same "one
// Resolver instance, definitions split across files" pattern.
//
// getIssueCsvAttachments/previewCsvImport are normal synchronous
// invoke()-backed calls made from the agent's own browsing session, so
// they use asUser() (the agent's own permission to view this ticket and
// its attachments) — unlike csvImportConsumer.js, which runs as a queue
// consumer with no attached user session and can only use asApp().

export const registerCsvImportResolvers = (resolver) => {
  resolver.define('getIssueCsvAttachments', async ({ payload }) => {
    const issueId = payload?.issueId;
    if (!issueId) return { attachments: [], error: 'issueId is required' };
    try {
      const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=attachment`);
      if (!res.ok) {
        return { attachments: [], error: `Could not read this ticket's attachments: ${res.status}` };
      }
      const data = await res.json();
      const attachments = (data.fields?.attachment || [])
        .filter((a) => /\.csv$/i.test(a.filename || '') || a.mimeType === 'text/csv')
        .map((a) => ({ id: a.id, filename: a.filename, size: a.size }));
      return { attachments };
    } catch (err) {
      console.error('[getIssueCsvAttachments] error:', err);
      return { attachments: [], error: err?.message || 'Failed to read attachments' };
    }
  });

  resolver.define('previewCsvImport', async ({ payload }) => {
    const { attachmentId, objectTypeId } = payload || {};
    if (!attachmentId || !objectTypeId) {
      return { error: 'attachmentId and objectTypeId are required' };
    }
    try {
      const config = (await kvs.get(CONFIG_KEY)) || {};
      if (!config.schemaId) return { error: 'No Assets schema configured.' };

      const contentRes = await api.asUser().requestJira(route`/rest/api/3/attachment/content/${attachmentId}`);
      if (!contentRes.ok) {
        return { error: `Could not download the attachment: ${contentRes.status}` };
      }
      const csvText = await contentRes.text();
      const { headers, rows } = parseCsvRows(csvText);

      if (headers.length === 0) {
        return { error: 'This file has no columns — is it a valid CSV?' };
      }

      const workspaceId = await getWorkspaceId(false);
      const attributeDefs = await fetchObjectTypeAttributeDefs(api.asUser(), workspaceId, objectTypeId);
      const { matched, unmatched } = matchCsvHeadersToAttributes(headers, attributeDefs);

      // The first column is always the unique key (by convention) —
      // report whether it actually matched an attribute on this object
      // type, since that's what determines whether import is possible.
      const uniqueKeyHeader = headers[0];
      const uniqueKeyMatch = matched.find((m) => m.header === uniqueKeyHeader);

      return {
        totalRows: rows.length,
        headers,
        matchedAttributes: matched.map((m) => ({ header: m.header, attributeName: m.attribute.attributeName })),
        unmatchedColumns: unmatched,
        uniqueKeyHeader,
        uniqueKeyAttributeName: uniqueKeyMatch?.attribute.attributeName || null,
      };
    } catch (err) {
      console.error('[previewCsvImport] error:', err);
      return { error: err?.message || 'Failed to preview this CSV' };
    }
  });

  resolver.define('startCsvImportJob', async ({ payload, context }) => {
    const { issueId, attachmentId, objectTypeId, createOnly } = payload || {};
    if (!issueId || !attachmentId || !objectTypeId) {
      return { error: 'issueId, attachmentId, and objectTypeId are required' };
    }

    const jobId = randomUUID();
    console.log(
      `[startCsvImportJob] jobId=${jobId} issueId=${issueId} attachmentId=${attachmentId} objectTypeId=${objectTypeId} ` +
      `createOnly=${Boolean(createOnly)} requestedBy=${context?.accountId}`
    );

    // Written BEFORE the push — same reasoning as startAssetLoadJob: avoids
    // a window where the consumer could finish before this 'pending'
    // marker exists and get overwritten by it.
    await kvs.set(csvImportJobKey(jobId), { status: 'pending', total: 0, processed: 0, summary: { created: 0, updated: 0, unchanged: 0, failed: 0 }, errors: [], warnings: [] });

    const queue = new Queue({ key: 'csv-import-queue' });
    await queue.push({ body: { jobId, issueId, attachmentId, objectTypeId, createOnly: Boolean(createOnly) } });

    return { jobId };
  });

  resolver.define('getCsvImportJobResult', async ({ payload }) => {
    const jobId = payload?.jobId;
    if (!jobId) return { status: 'error', error: 'jobId is required' };
    const job = await kvs.get(csvImportJobKey(jobId));
    if (!job) return { status: 'error', error: 'Job not found or expired' };
    return job;
  });

  // ─── Import-plan resolvers (the panel side of importPostFunctions.js) ───────
  // The plan build/start cores run asApp() (they're shared with the
  // workflow post-functions, which have no user session), so every
  // resolver here gates on the CALLER first: resolvers are reachable from
  // any of this app's modules — including the portal footer — so "the
  // request came in" proves nothing. The gate: not a portal-only caller,
  // AND the user can read this issue as THEMSELVES (asUser carries its own
  // permission check). That mirrors how the post-function path is gated by
  // who may execute the transition.
  const importPlanAccessError = async (issueId, context) => {
    if (!issueId) return 'issueId is required';
    if (isUnlicensedCaller(context)) return 'Import management is not available for portal-only users.';
    try {
      const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=id`);
      if (!res.ok) return 'You do not have access to this ticket.';
    } catch (_) {
      return 'You do not have access to this ticket.';
    }
    return null;
  };

  resolver.define('getImportPlan', async ({ payload, context }) => {
    const issueId = payload?.issueId != null ? String(payload.issueId) : null;
    const accessError = await importPlanAccessError(issueId, context);
    if (accessError) return { plan: null, error: accessError };
    const plan = await kvs.get(importPlanKey(issueId));
    return { plan: plan || null };
  });

  resolver.define('analyzeImportPlan', async ({ payload, context }) => {
    const issueId = payload?.issueId != null ? String(payload.issueId) : null;
    const accessError = await importPlanAccessError(issueId, context);
    if (accessError) return { error: accessError };
    try {
      return await buildImportPlanForIssue(issueId, { analyzedBy: 'panel' });
    } catch (err) {
      console.error('[analyzeImportPlan] error:', err);
      return { error: err?.message || 'Failed to analyze the attachment' };
    }
  });

  // Manual object-type override for one unit — the panel's escape hatch
  // for units the name detector left unresolved (or resolved to a parent
  // when a child was meant). Revalidates columns/unique key against the
  // chosen type using the HEADERS STORED IN THE PLAN (capped at 50 — see
  // importPostFunctions.js), so no attachment re-download is needed; the
  // consumer re-derives everything from the real file at import time
  // anyway.
  resolver.define('overrideImportPlanUnit', async ({ payload, context }) => {
    const { issueId: rawIssueId, unitIndex, objectTypeId, objectTypeName } = payload || {};
    const issueId = rawIssueId != null ? String(rawIssueId) : null;
    const accessError = await importPlanAccessError(issueId, context);
    if (accessError) return { error: accessError };
    if (unitIndex == null || !objectTypeId) return { error: 'unitIndex and objectTypeId are required' };

    const plan = await kvs.get(importPlanKey(issueId));
    if (!plan) return { error: 'No import plan found — analyze the attachment first.' };
    if (plan.status === 'importing') return { error: 'An import is currently running — wait for it to finish.' };
    const unit = plan.units.find((u) => u.index === unitIndex);
    if (!unit) return { error: 'That sheet is not in the current plan — re-analyze the attachment.' };

    try {
      const workspaceId = await getWorkspaceId(false);
      const attributeDefs = await fetchObjectTypeAttributeDefs(api.asUser(), workspaceId, objectTypeId);
      const headers = unit.headers || [];
      const { matched, unmatched } = matchCsvHeadersToAttributes(headers, attributeDefs);

      unit.objectTypeId = String(objectTypeId);
      unit.objectTypeName = objectTypeName || '';
      unit.matchedBy = 'manual';
      unit.isParentType = false; // a manual choice is deliberate — no parent warning
      unit.candidates = [];
      unit.matchedColumns = matched.length;
      unit.unmatchedColumns = unmatched.slice(0, 30);
      unit.uniqueKeyOk = matched.some((m) => m.header === headers[0]);
      unit.reason = unit.uniqueKeyOk
        ? ''
        : `First column "${headers[0] || ''}" doesn't match an attribute on ${objectTypeName || 'this type'} — this ${unit.sheetName ? 'sheet' : 'file'} will be skipped.`;
      delete unit.result;
      delete unit.jobId;

      await kvs.set(importPlanKey(issueId), plan);
      return { plan };
    } catch (err) {
      console.error('[overrideImportPlanUnit] error:', err);
      return { error: err?.message || 'Failed to apply the override' };
    }
  });

  resolver.define('confirmImportPlan', async ({ payload, context }) => {
    const issueId = payload?.issueId != null ? String(payload.issueId) : null;
    const accessError = await importPlanAccessError(issueId, context);
    if (accessError) return { error: accessError };
    try {
      console.log(`[confirmImportPlan] issueId=${issueId} requestedBy=${context?.accountId} createOnly=${Boolean(payload?.createOnly)}`);
      return await startImportPlanJobs(issueId, { createOnly: Boolean(payload?.createOnly) });
    } catch (err) {
      console.error('[confirmImportPlan] error:', err);
      return { error: err?.message || 'Failed to start the import' };
    }
  });
};
