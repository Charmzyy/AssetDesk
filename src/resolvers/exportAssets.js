import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { kvs } from '@forge/kvs';
import { Queue } from '@forge/events';
import { randomUUID } from 'crypto';
import { isUnlicensedCaller, exportJobKey, exportJobChunkKey } from './shared';

const groupAssetsByType = (assets, columns) => {
  const groups = new Map(); // typeId -> { objectTypeName, columns, assets }

  assets.forEach((asset) => {
    const typeId = String(asset.objectTypeId || '');
    const key = typeId || asset.objectTypeName || 'unknown';

    if (!groups.has(key)) {
      const typeCols = columns.filter(
        (col) => !col.objectTypeId || String(col.objectTypeId) === typeId
      );
      groups.set(key, {
        objectTypeId: typeId,
        objectTypeName: asset.objectTypeName || 'Unknown Type',
        columns: typeCols,
        assets: [],
      });
    }
    groups.get(key).assets.push(asset);
  });

  return [...groups.values()].sort((a, b) => b.assets.length - a.assets.length);
};

const groupToRows = (group) => {
  const header = ['Name', 'Key', ...group.columns.map((c) => c.attributeName)];
  const dataRows = group.assets.map((asset) => [
    asset.label || '',
    asset.objectKey || '',
    ...group.columns.map((col) => asset.visibleValues?.[col.attributeId] || ''),
  ]);
  return [header, ...dataRows];
};

const sanitizeSheetName = (name, usedNames) => {
  let base = String(name || 'Sheet')
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31) || 'Sheet';

  let candidate = base;
  let n = 2;
  while (usedNames.has(candidate)) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    n += 1;
  }
  usedNames.add(candidate);
  return candidate;
};

const buildXlsx = (groups) => {
  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set();

  groups.forEach((group) => {
    const rows = groupToRows(group);
    const sheet = XLSX.utils.aoa_to_sheet(rows);

    const headerRow = rows[0];
    sheet['!cols'] = headerRow.map((_, colIndex) => {
      const lengths = rows.map((row) => String(row[colIndex] ?? '').length);
      return { wch: Math.min(Math.max(...lengths, 8) + 2, 50) };
    });

    const sheetName = sanitizeSheetName(group.objectTypeName, usedSheetNames);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  });

  if (groups.length === 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['No assets']]), 'Assets');
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const PAGE_MARGIN = 40;
const ROW_PADDING = 6;
const HEADER_FONT_SIZE = 9;
const BODY_FONT_SIZE = 8;

const buildPdf = (groups, schemaName) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - PAGE_MARGIN * 2;

    doc
      .fontSize(16)
      .text(schemaName ? `${schemaName} — Asset Export` : 'Asset Export')
      .fontSize(9)
      .fillColor('#666666')
      .text(new Date().toLocaleString())
      .fillColor('#000000')
      .moveDown(1);

    if (groups.length === 0) {
      doc.fontSize(11).text('No assets to export.');
      doc.end();
      return;
    }

    groups.forEach((group, groupIndex) => {
      if (groupIndex > 0) doc.addPage();

      doc
        .fontSize(13)
        .text(`${group.objectTypeName} (${group.assets.length})`, { underline: true })
        .moveDown(0.5);

      const rows = groupToRows(group);
      const [headerRow, ...dataRows] = rows;
      const colCount = headerRow.length;
      const colWidth = pageWidth / colCount;
      const pageBottom = doc.page.height - PAGE_MARGIN;

      const drawRow = (cells, { bold, shaded, y }) => {
        const rowHeight =
          Math.max(
            ...cells.map((text) =>
              doc.heightOfString(String(text || '—'), {
                width: colWidth - ROW_PADDING * 2,
                fontSize: bold ? HEADER_FONT_SIZE : BODY_FONT_SIZE,
              })
            )
          ) + ROW_PADDING * 2;

        if (shaded) doc.rect(PAGE_MARGIN, y, pageWidth, rowHeight).fill('#f0f0f0');

        cells.forEach((text, i) => {
          doc
            .fontSize(bold ? HEADER_FONT_SIZE : BODY_FONT_SIZE)
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fillColor('#000000')
            .text(String(text || '—'), PAGE_MARGIN + i * colWidth + ROW_PADDING, y + ROW_PADDING, {
              width: colWidth - ROW_PADDING * 2,
            });
        });

        doc
          .moveTo(PAGE_MARGIN, y + rowHeight)
          .lineTo(PAGE_MARGIN + pageWidth, y + rowHeight)
          .strokeColor('#dddddd')
          .stroke();

        return rowHeight;
      };

      let y = doc.y;
      y += drawRow(headerRow, { bold: true, shaded: true, y });

      dataRows.forEach((row) => {
        const estHeight =
          Math.max(
            ...row.map((text) =>
              doc.heightOfString(String(text || '—'), {
                width: colWidth - ROW_PADDING * 2,
                fontSize: BODY_FONT_SIZE,
              })
            )
          ) + ROW_PADDING * 2;

        if (y + estHeight > pageBottom) {
          doc.addPage();
          y = PAGE_MARGIN;
          y += drawRow(headerRow, { bold: true, shaded: true, y });
        }

        y += drawRow(row, { y });
      });

      doc.y = y + 10;
    });

    doc.end();
  });

const safeFilename = (schemaName) =>
  (schemaName || 'assets').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

export const buildFilename = (schemaName, format) => {
  const date = new Date().toISOString().slice(0, 10);
  return `${safeFilename(schemaName)}_${date}.${format}`;
};

export { groupAssetsByType, buildXlsx, buildPdf };

// ─── Async export job (exportAssets/exportAssetsWithFilters moved off the ──────
// synchronous path) ─────────────────────────────────────────────────────────
// Both formerly ran synchronously inside a single invoke() call: the
// unfiltered one built the file from whatever `assets` array the client had
// already loaded, the filtered one re-ran the ownership+filter AQL itself
// first. Either could exceed Forge's 25s invoke() ceiling — a large PDF
// alone can take a while to lay out (heightOfString per cell in buildPdf),
// and re-running the AQL for a big filtered set adds more on top of that.
//
// Rather than keep two code paths, startExportJob always re-runs the
// ownership (+ optional filter) AQL server-side inside the consumer
// (exportJobConsumer.js), the same way the main asset-load job already
// does — resolveAssetList already treats `filters: null` as "no filter"
// identically to how it's called from assetLoadConsumer.js. This also
// sidesteps ever having to ship a potentially-huge `assets` array through
// the queue (Forge's Async Events payload is far smaller than KVS's 128KB
// cap, let alone an invoke() body) and guarantees the export reflects a
// fresh fetch rather than whatever was paginated into client memory.
export const registerExportAssets = (resolver) => {
  resolver.define('startExportJob', async ({ payload, context }) => {
    const { format } = payload || {};
    if (!['xlsx', 'pdf'].includes(format)) {
      return { error: `Unknown export format: ${format}` };
    }

    const activeAccountId = payload?.accountId || context?.accountId;
    if (!activeAccountId || activeAccountId === 'unidentified') {
      return { error: 'Could not identify the current user. Please log in.' };
    }

    // Captured HERE, inside the synchronous request where `context` is
    // trustworthy — a queue-triggered consumer invocation has no attached
    // user session, so isUnlicensedCaller(context) wouldn't mean anything
    // reliable there (same reasoning as startAssetLoadJob).
    const unlicensed = isUnlicensedCaller(context);
    const jobId = randomUUID();

    await kvs.set(exportJobKey(jobId), { status: 'pending', createdAt: Date.now() });

    const queue = new Queue({ key: 'export-queue' });
    await queue.push({
      body: {
        jobId,
        format,
        schemaName: payload?.schemaName,
        filters: payload?.filters || null,
        objectTypeId: payload?.objectTypeId || null,
        accountId: activeAccountId,
        unlicensed,
      },
    });

    return { jobId };
  });

  resolver.define('getExportJobResult', async ({ payload }) => {
    const jobId = payload?.jobId;
    if (!jobId) return { status: 'error', error: 'jobId is required' };

    const job = await kvs.get(exportJobKey(jobId));
    if (!job) return { status: 'error', error: 'Job not found or expired' };
    if (job.status !== 'done' || !job.result || job.result.error || !job.result.chunkCount) {
      return job;
    }

    // The consumer split the base64 file across N chunk keys to stay under
    // KVS's 128KB per-value cap (see exportJobChunkKey in shared.js) —
    // reassemble here before handing it back. The invoke() response
    // channel to the frontend has no such per-key cap, so this is the only
    // place chunking needs to be undone.
    const { chunkCount, ...meta } = job.result;
    const chunks = await Promise.all(
      Array.from({ length: chunkCount }, (_, i) => kvs.get(exportJobChunkKey(jobId, i)))
    );

    // Clean up now that the file's been handed off — no reason to leave a
    // multi-hundred-KB blob sitting in KVS once it's been downloaded.
    await Promise.all(Array.from({ length: chunkCount }, (_, i) => kvs.delete(exportJobChunkKey(jobId, i))));
    await kvs.delete(exportJobKey(jobId));

    return { status: 'done', result: { ...meta, base64: chunks.join('') } };
  });
};