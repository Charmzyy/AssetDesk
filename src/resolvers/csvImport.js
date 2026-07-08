import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { Queue } from '@forge/events';
import { randomUUID } from 'crypto';
import {
  CONFIG_KEY,
  csvImportJobKey,
  getWorkspaceId,
  fetchObjectTypeAttributeDefs,
  parseCsvRows,
  matchCsvHeadersToAttributes,
} from './shared';

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
};
