import { kvs } from '@forge/kvs';
import { groupAssetsByType, buildXlsx, buildPdf, buildFilename } from './exportAssets';
import {
  CONFIG_KEY,
  exportJobKey,
  exportJobChunkKey,
  resolveUser,
  resolveAssetList,
  buildAssetPayload,
} from './shared';

// Base64 chars per KVS chunk — well under the 128KB per-value cap, leaving
// headroom for the JSON wrapper. See exportJobChunkKey in shared.js.
const CHUNK_SIZE = 90000;

// ─── Async export job consumer ─────────────────────────────────────────────
// See the big comment above registerExportAssets in exportAssets.js for why
// this always re-runs the ownership(+filter) AQL itself rather than
// accepting a client-supplied assets array — same reasoning, same
// resolveAssetList/buildAssetPayload pipeline, as assetLoadConsumer.js.
//
// Auth: always asApp() (via useAppAuth below), same reasoning as
// assetLoadConsumer.js — no user session exists in a queue-triggered
// invocation, and the AQL ownership filter is what scopes results to "this
// user's assets", not the auth mode.
export const handler = async (event) => {
  const { jobId, format, schemaName, filters, objectTypeId, accountId, unlicensed } = event.body || {};

  if (!jobId) {
    console.error('[exportJobConsumer] event missing jobId — cannot report a result anywhere', event);
    return;
  }

  const fail = async (message) => {
    await kvs.set(exportJobKey(jobId), { status: 'done', result: { error: message } });
  };

  try {
    const config = (await kvs.get(CONFIG_KEY)) || {};
    if (!config.schemaId) {
      await fail('No Assets schema configured.');
      return;
    }
    if (!accountId || accountId === 'unidentified') {
      await fail('Could not identify the current user. Please log in.');
      return;
    }

    const useAppAuth = true; // always — see comment above
    const user = await resolveUser(accountId, useAppAuth);

    const { values: allValues, workspaceId, hadAnySuccess, lastError } = await resolveAssetList({
      accountId, config, user, useAppAuth, forceFresh: true, filters: filters || null,
    });

    if (lastError && !hadAnySuccess) {
      await fail(lastError);
      return;
    }

    // Scope to a single object type when the export was triggered from a
    // specific tab (not "All") — see the comment on scopeObjectTypeId in
    // src/frontend/index.jsx for why this only ever applies for filtered
    // exports (the unfiltered path always sends objectTypeId: null).
    const values = objectTypeId
      ? allValues.filter((a) => String(a.objectType?.id || '') === String(objectTypeId))
      : allValues;

    if (values.length === 0) {
      await fail(filters ? 'No assets match the current filters.' : 'No assets to export.');
      return;
    }

    const { mappedValues, columnsToShow } = await buildAssetPayload({
      values, workspaceId, config, useAppAuth, ignoreHidden: false,
    });

    const groups = groupAssetsByType(mappedValues, columnsToShow);
    const resolvedSchemaName = schemaName || config.schemaName;
    const filename = buildFilename(resolvedSchemaName, format);
    const totalCount = mappedValues.length;

    const buffer = format === 'xlsx' ? buildXlsx(groups) : await buildPdf(groups, resolvedSchemaName);
    const mimeType = format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';

    const base64 = buffer.toString('base64');
    const chunkCount = Math.max(1, Math.ceil(base64.length / CHUNK_SIZE));

    await Promise.all(
      Array.from({ length: chunkCount }, (_, i) =>
        kvs.set(exportJobChunkKey(jobId, i), base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE))
      )
    );

    console.log(
      `[exportJobConsumer] jobId=${jobId} DONE format=${format} totalCount=${totalCount} ` +
      `bytes=${buffer.length} chunkCount=${chunkCount}`
    );

    await kvs.set(exportJobKey(jobId), {
      status: 'done',
      result: { filename, mimeType, totalCount, chunkCount },
    });
  } catch (error) {
    // An unexpected exception, distinct from the expected/handled outcomes
    // above (those are all `status: 'done'` with an error folded into
    // `result`, matching what the old synchronous resolvers always
    // returned) — this is a genuine job failure the frontend should show a
    // generic message for.
    console.error(`[exportJobConsumer] jobId=${jobId} job failed:`, error);
    try {
      await kvs.set(exportJobKey(jobId), { status: 'error', error: error?.message || 'Export failed.' });
    } catch (_) {
      // If even this write fails, the frontend's poll will eventually time
      // out on its own and show a generic "taking longer than expected"
      // message rather than hang forever.
    }
  }
};
