# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**AssetDesk** is an Atlassian Forge app (`jira-service-management-portal-footer-ui-kit`) that surfaces Jira Service Management (JSM) Assets objects to portal users. A Jira admin configures an Assets schema and AQL "ownership" rules via the admin-page module; portal customers (and licensed agents) then see a filtered, tabular list of their own assets in the JSM portal footer, with inline editing where permitted and XLSX/PDF export.

The project is a single-customer installation built on the Forge platform (Node.js 24.x, arm64) using **UI Kit** (NOT custom UI / `@forge/ui`). The only authoring framework permitted for components is `@forge/react` — never the standard `react` package's DOM components or other third-party React component libraries.

## Critical Forge rules (from AGENTS.md)

These are non-negotiable platform rules; violations break the app:

- **Components MUST come from `@forge/react` only** — no `<div>`, `<span>`, `<strong>`, etc. The allowed component set is enumerated in `AGENTS.md` § "UI Development" (Badge, Box, Button, DynamicTable, Form, Heading, Modal*, Select, Stack, Tabs, Text, Textfield, Toggle, UserPicker, …). There is **no `Table`** component — use `DynamicTable`.
- **`@forge/ui` is deprecated** — never import from it.
- **Resolver auth**: prefer `api.asUser()` (carries its own auth check). When using `api.asApp()` in a user context, perform explicit authorization checks via the relevant product REST APIs.
- **Minimize scopes.** Only add a scope when strictly required.
- **Unlicensed callers** (anonymous / customer / unlicensed) can hit portal-footer modules; many resolvers branch on `isUnlicensedCaller(context)` to use `asApp()` for reads/writes and to gate editing on `config.allowPortalEdit`.
- **Frontend → product API**: prefer `requestJira` / `requestConfluence` from `@forge/bridge` over backend resolvers when no server-side work is needed. This app uses backend resolvers heavily because the AQL ownership logic must run server-side.
- **KVS / storage APIs** (`@forge/kvs`, Forge SQL, custom entities) have **no client-side API** — they must be called from backend resolvers via `asApp()`. This app stores its full admin config under the KVS key `assets-schema-config` (see `CONFIG_KEY` in `src/resolvers/index.js`).
- **Entity properties** are accessed via REST only — no client-side SDK.

## Forge CLI workflow

All non-`create` / `version` / `login` commands must run from the app root. The npm script `lint` runs `eslint src/**/*` and is the only npm script wired up; there are no test or build scripts (Forge handles bundling at deploy time).

```bash
forge lint                          # validate manifest + lint
forge deploy --non-interactive --e development
forge install --non-interactive --site <site-url> --product jira --environment development
forge install --non-interactive --upgrade --site <site-url> --product jira --environment development
forge tunnel                        # local dev; redeploy+restart if manifest changes
forge logs -n 100 -e development     # tail resolver logs
```

After **any** `manifest.yml` change, run `forge lint`. If scopes or egress controls are added, you must redeploy **and** reinstall. Never use `--no-verify` on deploy. Run `pwd` to get the path to pass to the CLI.

## Module / file map

Manifest modules → source paths:

| Manifest key | Source |
|---|---|
| `jira:adminPage` (configure, useAsConfig) | `src/frontend/ConfigurePage.jsx` |
| `jira:adminPage` (get-started, useAsGetStarted) | `src/frontend/GetStartedPage.jsx` |
| `jiraServiceManagement:portalFooter` | `src/frontend/index.jsx` |
| `function: resolver` (handler `index.handler`) | `src/index.js` → `src/resolvers/index.js` |

Static assets under `src/resources/` are imported by the frontend (e.g. `GetStartedPage.jsx` imports `config_*.png` walkthrough screenshots).

## High-level architecture

### Data flow (single-user asset view)

1. **Configuration** is admin-defined in `ConfigurePage.jsx` and saved by the `saveConfig` resolver into KVS under `assets-schema-config` (with a monotonically increasing `version` and `updatedAt` timestamp). Config shape:
   ```js
   { schemaId, schemaName, hiddenByObjectType: { [typeId]: [attrId,...] },
     aqlRows: [{ attribute, operator, userField, viaReference, referenceDirection }],
     allowPortalEdit, editMode, maxUserAssetLimit, version, updatedAt }
   ```
2. **Ownership AQL** is built per-user by `buildAqlCandidates` / `buildAqlFromRow` (`src/resolvers/index.js`). Each `aqlRow` becomes one full AQL condition: `objectSchemaId = X AND <attribute> <op> <userField>()`. The `viaReference` + `referenceDirection` flags wrap the condition in `inboundReferences(...)` / `outboundReferences(...)` for reference-traversal ownership.
3. **Search** — `searchAllCandidates` runs every candidate AQL in parallel, paginates each up to the **1000-object platform cap** (`ASSETS_API_TOTAL_CAP`, `ASSETS_API_PAGE_SIZE = 100`), and merges results de-duplicated by `id`.
4. **Caching** — `resolveAssetList` writes a slim per-user stub list (`compressRawAsset` = `{ id, objectType: { id, name } }`) into KVS at `asset-list-cache:<accountId>` for **60 s** (`ASSET_LIST_CACHE_TTL_MS`). **Cache is bypassed whenever a `filters` payload is present** (cache key is accountId-only) and writes only happen for unfiltered, successful fetches. Caches are invalidated on `updateAssetAttribute` via `kvs.delete`.
5. **Hydration / payload building** — `buildAssetPayload` runs a 3-stage per-type pipeline: (1) fetch attribute definitions per object type, (2) resolve status labels for status-type attributes, (3) map each asset to `{ id, label, objectKey, objectTypeId, objectTypeName, visibleValues, rawValues }` and produce `columnsToShow` (excluding `Name`/`Key`/`Created`/`Updated` built-ins and any admin-hidden attribute). Pagination / "load more" goes through `getUserAssetsPage`, which hydrates stubs on demand (filtered fetches already have `.attributes` and skip the extra round-trip).
6. **Edit** — `updateAssetAttribute` re-verifies ownership via `verifyAssetOwnership` (always `asApp()`), then PUTs the attribute back to `/jsm/assets/workspace/{wsId}/v1/object/{objectId}`. `editMode === 'userAccount'` (legacy) writes as the user; default `serviceAccount` writes as the app and is the only mode that works for unlicensed portal customers.
7. **Export** — `exportAssets` (client-supplied array) and `exportAssetsWithFilters` (server re-runs the ownership+filter AQL against `maxUserAssetLimit`) both delegate to `groupAssetsByType` + `buildXlsx` (via `xlsx`) or `buildPdf` (via `pdfkit`, A4 landscape) in `src/resolvers/exportAssets.js`, returning `base64` + `filename` + `mimeType` for the client to trigger a download.
8. **Reconciliation** — `reconcileConfig` diffs the saved `hiddenByObjectType` against the live schema/types/attributes; `applyReconciliation` strips ghost IDs. Used by the admin page when the underlying schema has been edited in Jira.

### Frontend (`src/frontend/index.jsx`)

`App` is a single large component (~2000 lines) with deeply commented state, refs, and helpers. Major regions:
- **Style constants** at the top (`xcss(...)` tokens).
- **`AttributeField` / `EditAssetModal`** — modal editing; per-attribute-type field rendering (status, object-ref, select, date, text).
- **`AssetTable` / `AllAssetsTable` / `LoadMoreRow`** — `DynamicTable`-based rendering with inline expand rows.
- **`FilterBar`** — name query + per-attribute filters. Two-pass filtering: instant client-side narrowing of already-loaded assets (`useFilteredAssets`), then debounced server-side refetch with the filter AQL (`buildFilterAql`).
- **Per-type tabs**: when multiple object types match, renders `<Tabs>` with an "All" tab + one tab per type, each with its own pagination state in `paginationByType`.
- **Asset-limit banner**: shows when `config.maxUserAssetLimit` truncated the server-side result (clamped to `MAX_USER_ASSET_LIMIT_CEILING = 5000`, default `500`).
- **Diagnostics panel** (`DiagnosticsPanel` + `diagnoseCaller` resolver): surfaced for unlicensed users seeing zero assets.

### Resolver patterns to follow

- New resolvers are registered with `resolver.define('<name>', async ({ payload, context }) => { ... })`. Single export point: `export const handler = resolver.getDefinitions();` at the bottom of `src/resolvers/index.js`. `exportAssets.js` adds itself via `registerExportAssets(resolver)` to keep export logic isolated.
- Caller selection: `const caller = useAppAuth ? api.asApp() : api.asUser();` (where `useAppAuth` typically equals `isUnlicensedCaller(context)`).
- Workspace ID: cache the `getWorkspaceId(useAppAuth)` result; the helper tries `/rest/servicedeskapi/assets/workspace` then `/jsm/assets/workspace`.
- User profile: shared `resolveUser(accountId, useAppAuth)` helper. For licensed agents, fall back to `/rest/api/3/myself` if `displayName` is empty.
- AQL string safety: any user-controlled value goes through `escapeAqlValue` (escapes `\` and `"`).
- The `exportAssetsWithFilters` resolver pattern (server-side AQL re-run when filters are present, client-array path when not) is the template to copy if you need any future "export X of my assets" endpoints — it sidesteps the pagination boundary that would otherwise leak partial filtered results to the exporter.

### Configuration (manifest) notes

- Scopes include the read/write CMDB scopes that back Assets, plus `storage:app` (for KVS), `manage:servicedesk-customer`, `manage:jira-configuration`. Several asset-management scopes are commented out — only re-enable them if the new feature genuinely needs them.
- Runtime is `nodejs24.x`, `arm64`, 256 MB. The bundled `pdfkit` and `xlsx` exports run inside this budget — keep the export payloads bounded by `maxUserAssetLimit`.
- Resources are explicitly mapped to `src/frontend/<name>.jsx` paths; renaming frontend files means updating the manifest.

## House style

- Vanilla, idiomatic JavaScript (no TypeScript in this repo).
- Heavy in-code commentary aimed at an intermediate JS developer new to Forge — when you change a non-obvious function, preserve or improve the surrounding explanation, especially around AQL construction, caching decisions, and platform caps.
- Imports use the project's existing style (double quotes in `ConfigurePage`/`GetStartedPage`, single in `resolvers` — match the file you are editing).
- The repo follows the `AGENTS.md` guidance on UI-Kit-only components, `.asUser()` preference, minimal scopes, and "simplest possible solution" — defer to `AGENTS.md` for any rule that is not repeated here.

## Common pitfalls

- There is no UI Kit `Table` — use `DynamicTable`.
- Don't import React DOM components from `react` directly — only hooks and `useState`/`useEffect`/`useMemo`/`useCallback`/`useRef` are safe; the rendering primitives all come from `@forge/react`.
- The KVS value cap is 128 KB. The `CACHE_MAX_ASSETS = 1000` guard in `setCachedAssetList` exists to stay under it; if you raise it, verify the payload size of the new stub shape.
- Asset attribute references in AQL use the **attribute NAME**, not its numeric ID. A bare numeric `attributeName` (unresolved column lookup) is dropped with a warning in `buildFilterAql` — never let it through or every ownership candidate 400s.
- `assetListCacheKey(accountId)` is per-user; if you add a path that needs cache invalidation, call `kvs.delete(assetListCacheKey(activeAccountId))` like `updateAssetAttribute` does.
