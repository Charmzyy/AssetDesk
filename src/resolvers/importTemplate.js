import * as XLSX from 'xlsx';
import api, { route } from '@forge/api';
import {
  IMPORT_TEMPLATE_FILENAME,
  fetchSchemaObjectTypes,
  fetchObjectTypeAttributeDefs,
} from './shared';

// ─── Import template generation ────────────────────────────────────────────────
// Builds the XLSX workbook a user should fill in to import assets: one
// headers-only sheet per (non-abstract) object type in the configured
// schema, plus a README sheet with instructions. The whole point is that
// a filled-in copy sails through the automated analyze step
// (importPostFunctions.js) without any manual fixing, so every choice
// here mirrors what that pipeline expects:
//
//   - Sheet names are the EXACT object type names, so
//     detectObjectTypeFromName resolves each sheet unambiguously.
//   - Row 1 holds the attribute NAMES, which is what
//     matchCsvHeadersToAttributes matches on (case-insensitively).
//   - The type's label attribute (usually "Name") is the FIRST column —
//     the first column is the unique key by convention, and the label is
//     the one attribute every type has and every reference lookup uses.
//   - Sheets are ordered so reference TARGETS come before the types that
//     reference them — plan units run sequentially in workbook order, so
//     a workbook filled in as-generated imports its references in a
//     resolvable order (Manufacturers before the Laptops that name them).
//   - No example rows: anything under the header row is treated as real
//     data and imported, so guidance lives on the README sheet only.
//
// Consumed from two places: the generateImportTemplate resolver (panel
// download button, asUser) and the analyze post-function (auto-attach to
// the ticket when sheets couldn't be matched, asApp) — hence the caller
// is a parameter, same pattern as the fetch helpers in shared.js.

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Excel's hard limits: 31 chars per sheet name, and a handful of
// forbidden characters. Same rules as sanitizeSheetName in
// exportAssets.js — duplicated rather than shared because the export
// version doesn't report WHETHER it changed the name, which matters here
// (a shortened name may no longer token-match its type, so the README
// has to warn about it).
const toSheetName = (typeName, usedNames) => {
  const base = String(typeName || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let n = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    n += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return { sheetName: candidate, renamed: candidate !== typeName };
};

// Orders types so that every type comes AFTER the types it references
// (restricted to references within this workbook — a reference to a type
// outside the set can't be helped by ordering). Simple Kahn-style layering;
// a reference cycle (A references B references A) can't be topologically
// ordered, so the first remaining type is emitted to break the tie and
// preserve the original schema order as much as possible.
const orderTypesByReference = (types, defsByTypeId) => {
  const idsInSet = new Set(types.map((t) => t.id));
  const depsOf = new Map(
    types.map((t) => [
      t.id,
      new Set(
        (defsByTypeId.get(t.id) || [])
          .filter((d) => d.attributeType === 'object' && idsInSet.has(d.referenceObjectTypeId) && d.referenceObjectTypeId !== t.id)
          .map((d) => d.referenceObjectTypeId)
      ),
    ])
  );

  const ordered = [];
  const placed = new Set();
  let remaining = [...types];
  while (remaining.length > 0) {
    const ready = remaining.filter((t) => [...depsOf.get(t.id)].every((dep) => placed.has(dep)));
    const batch = ready.length > 0 ? ready : [remaining[0]];
    batch.forEach((t) => {
      ordered.push(t);
      placed.add(t.id);
    });
    remaining = remaining.filter((t) => !placed.has(t.id));
  }
  return ordered;
};

export const buildImportTemplateWorkbook = async (caller, workspaceId, schemaId) => {
  const allTypes = await fetchSchemaObjectTypes(caller, workspaceId, schemaId);
  // Abstract types can never hold objects (the analyzer blocks them too),
  // so they get no sheet. Parent types CAN hold objects and stay in —
  // the README tells users to delete sheets they don't need.
  const types = allTypes.filter((t) => !t.abstract);
  const typeNameById = new Map(allTypes.map((t) => [t.id, t.name]));

  const defsByTypeId = new Map();
  await Promise.all(
    types.map(async (t) => {
      const defs = await fetchObjectTypeAttributeDefs(caller, workspaceId, t.id);
      // Non-editable attributes can't be written by the import — leave
      // them off the template so users don't fill in columns that would
      // be rejected. The label attribute always stays: it's the unique
      // key column even in the unlikely case it's marked non-editable.
      defsByTypeId.set(t.id, defs.filter((d) => d.isLabel || d.isEditable));
    })
  );

  const orderedTypes = orderTypesByReference(types, defsByTypeId).filter(
    (t) => (defsByTypeId.get(t.id) || []).length > 0
  );

  const workbook = XLSX.utils.book_new();
  const usedNames = new Set(['readme']); // reserve README before any type claims it
  const sheetNotes = []; // per-sheet README lines (key column + reference columns)
  const renamedNotes = []; // types whose sheet name had to be shortened/altered

  orderedTypes.forEach((t) => {
    const defs = defsByTypeId.get(t.id);
    // Label attribute first = unique-key column; the rest keep the
    // schema's own attribute order.
    const columns = [...defs.filter((d) => d.isLabel), ...defs.filter((d) => !d.isLabel)];
    const headers = columns.map((d) => d.attributeName);

    const sheet = XLSX.utils.aoa_to_sheet([headers]);
    sheet['!cols'] = headers.map((h) => ({ wch: Math.min(Math.max(h.length, 10) + 2, 40) }));

    const { sheetName, renamed } = toSheetName(t.name, usedNames);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    if (renamed) {
      renamedNotes.push(
        `Sheet "${sheetName}" is the object type "${t.name}" (the name didn't fit Excel's sheet-name limits) — if analysis doesn't detect it automatically, pick the type in the import panel.`
      );
    }

    const refColumns = columns
      .filter((d) => d.attributeType === 'object')
      .map((d) => `"${d.attributeName}" -> ${typeNameById.get(d.referenceObjectTypeId) || 'another object type'}`);
    sheetNotes.push(
      `Sheet "${sheetName}" — key column: "${headers[0]}"${refColumns.length > 0 ? `; reference columns (use the referenced object's Name): ${refColumns.join(', ')}` : ''}`
    );
  });

  // README goes FIRST so it's what opens by default. The importer ignores
  // it entirely (extractImportUnits filters sheets named README).
  const readmeRows = [
    ['AssetDesk import template'],
    [],
    ['How to use this file:'],
    ['1. Each sheet is named after an Assets object type. Fill in one row per asset under the header row.'],
    ['2. Do not rename the sheets or the column headers — the importer matches both by name.'],
    ['3. The FIRST column on each sheet is the unique key: rows are matched to existing assets by it, so it must be filled in and unique. Re-importing the same key updates that asset.'],
    ['4. Dates use YYYY-MM-DD (DD/MM/YYYY is also accepted).'],
    ['5. Reference columns expect the Name of an existing object in the referenced type. The sheets are already ordered so referenced types import first — keep that order.'],
    ['6. Delete any sheets you do not need, and leave cells blank to skip an attribute.'],
    [`7. Save your filled-in copy under a DIFFERENT file name before attaching it to the ticket — a file named ${IMPORT_TEMPLATE_FILENAME} is ignored by the importer.`],
    ['8. This README sheet is ignored by the importer — keep or delete it.'],
    [],
    ['Sheets in this file:'],
    ...sheetNotes.map((line) => [line]),
    ...(renamedNotes.length > 0 ? [[], ['Shortened sheet names:'], ...renamedNotes.map((line) => [line])] : []),
  ];
  const readmeSheet = XLSX.utils.aoa_to_sheet(readmeRows);
  readmeSheet['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(workbook, readmeSheet, 'README');
  // book_append_sheet appends, but README should open first.
  workbook.SheetNames = ['README', ...workbook.SheetNames.filter((n) => n !== 'README')];

  return {
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
    sheetCount: orderedTypes.length,
  };
};

// The `content` URL the attachment REST API returns is only usable by the
// APP (it points at the api.atlassian.com gateway, which a person clicking
// it in a browser can't authenticate against — they get "You do not have
// permission to view attachment"). The link a human can click is the
// site's own /secure/attachment/{id}/{filename} download path, which just
// needs issue view permission — so build that from the site base URL.
const buildUserFacingAttachmentUrl = async (attachmentId) => {
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/serverInfo`);
    if (!res.ok) return null;
    const baseUrl = String((await res.json()).baseUrl || '').replace(/\/$/, '');
    if (!baseUrl) return null;
    return `${baseUrl}/secure/attachment/${attachmentId}/${encodeURIComponent(IMPORT_TEMPLATE_FILENAME)}`;
  } catch (err) {
    console.warn('[buildUserFacingAttachmentUrl] failed:', err?.message || err);
    return null;
  }
};

// Attaches the generated template to an issue, unless one with the fixed
// template filename is already there (re-analyzing an unfixed file
// shouldn't pile up identical copies). Always asApp — the callers are the
// analyze post-function and its panel twin, and the comment/attachment
// pair is app-authored feedback either way. Returns
// { status: 'attached' | 'already-present' | 'failed', url } where url is
// the attachment's user-facing download link (when known) so the plan
// comment can link the file directly. Failures are logged, never thrown —
// like postIssueComment, this is best-effort feedback that must not sink
// the analysis that triggered it.
export const attachImportTemplateToIssue = async (issueId, workspaceId, schemaId) => {
  try {
    const issueRes = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}?fields=attachment`);
    if (issueRes.ok) {
      const attachments = (await issueRes.json()).fields?.attachment || [];
      const existing = attachments.find(
        (a) => (a.filename || '').toLowerCase() === IMPORT_TEMPLATE_FILENAME.toLowerCase()
      );
      if (existing) {
        return { status: 'already-present', url: existing.id ? await buildUserFacingAttachmentUrl(existing.id) : null };
      }
    }

    const { buffer } = await buildImportTemplateWorkbook(api.asApp(), workspaceId, schemaId);

    // Native FormData/Blob from the nodejs runtime — Jira's add-attachment
    // endpoint wants multipart/form-data with the XSRF check disabled.
    // No explicit Content-Type header: fetch derives it (with the
    // boundary) from the FormData body.
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: XLSX_MIME_TYPE }), IMPORT_TEMPLATE_FILENAME);
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/attachments`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
      body: form,
    });
    if (!res.ok) {
      console.warn(`[attachImportTemplateToIssue] ${issueId} upload failed: ${res.status} ${await res.text()}`);
      return { status: 'failed', url: null };
    }
    const created = (await res.json())[0] || {};
    return { status: 'attached', url: created.id ? await buildUserFacingAttachmentUrl(created.id) : null };
  } catch (err) {
    console.warn(`[attachImportTemplateToIssue] ${issueId} failed:`, err?.message || err);
    return { status: 'failed', url: null };
  }
};
