# Architecture & Infrastructure

How AssetDesk is put together: the platform it runs on, the modules it declares,
the async job system, storage layout, and end-to-end data-flow diagrams for every
major feature.

> Diagrams are in [Mermaid](https://mermaid.js.org/) — they render on GitHub and in
> VS Code (with the built-in Markdown preview + Mermaid extension). An ASCII
> fallback is included where the diagram is essential.

---

## 1. Platform: Atlassian Forge

Forge is Atlassian's serverless app platform. Key properties that shaped this app:

| Property | Consequence in this codebase |
|---|---|
| Backend = AWS Lambda-style functions (Node.js 24, arm64, 256 MB here) | No persistent server; every resolver call is stateless. Module-scope variables can leak between invocations on a "warm" container — which is why e.g. the CSV reference cache is created per-invocation, not at module scope. |
| **Synchronous `invoke()` calls are killed at 25 s** | All heavy work moved to Async Events queue consumers (up to 900 s). This is the single most important architectural constraint. |
| UI Kit renders components server-defined, natively in Jira | No DOM access, no arbitrary HTML/CSS/JS. Only `@forge/react` components. One deliberate exception: `triggerBase64Download` in the portal footer touches `document` to trigger file downloads — it works because portal footer runs with enough bridge access for that. |
| KVS (key-value store): **128 KB max per value** | Asset-list cache stores slim stubs and skips caching above 1,000 assets; CSV job results cap error lists at 200; export files are split across multiple chunk keys. |
| Scopes are declared in `manifest.yml` and consented at install | The app holds read/write CMDB scopes, `storage:app`, `read:attachment:jira`, and a few Jira read scopes. Adding a scope requires redeploy **and** reinstall. |
| `asApp()` vs `asUser()` auth | `asUser()` carries the caller's own permissions (preferred where possible). `asApp()` acts as the app's service account — required for unlicensed portal customers (who have no Assets permission) and for **all queue consumers** (no user session exists in a queue-triggered invocation). |

### Technology stack

| Layer | Technology | Used for |
|---|---|---|
| UI | `@forge/react` 11 (UI Kit), React 18 hooks | All four frontends |
| Frontend↔backend | `@forge/bridge` `invoke()` | Calling resolvers |
| Backend framework | `@forge/resolver` | Resolver registration/dispatch |
| Product APIs | `@forge/api` (`asApp`/`asUser` + `route`) | Jira REST + Assets (Insight) REST |
| Background work | `@forge/events` (`Queue`) + `consumer` modules | The three async jobs |
| Storage | `@forge/kvs` | Config, caches, job status/results |
| Spreadsheets | `xlsx` (SheetJS) | XLSX export **and** CSV parsing **and** Excel date-serial decoding |
| PDFs | `pdfkit` | PDF export (A4 landscape, manual table layout) |

---

## 2. Module map (manifest.yml)

```mermaid
flowchart LR
    subgraph UI["UI modules (who sees what)"]
        A["jira:adminPage<br/>Configure<br/>ConfigurePage.jsx"]
        B["jira:adminPage<br/>Get started<br/>GetStartedPage.jsx"]
        C["jiraServiceManagement:portalFooter<br/>AssetDesk 'My Assets'<br/>frontend/index.jsx<br/><i>unlicensedAccess: anonymous, customer, unlicensed</i>"]
        D["jira:issuePanel<br/>Import Assets from CSV<br/>CsvImportPanel.jsx<br/><i>agents only</i>"]
    end

    subgraph FN["function modules"]
        R["resolver<br/>(index.handler)"]
        F1["asset-load-consumer-fn<br/>timeout 300s"]
        F2["csv-import-consumer-fn<br/>timeout 900s"]
        F3["export-consumer-fn<br/>timeout 600s"]
    end

    subgraph Q["queues (consumer modules)"]
        Q1["asset-load-queue"]
        Q2["csv-import-queue"]
        Q3["export-queue"]
    end

    A -- invoke() --> R
    B -- invoke() --> R
    C -- invoke() --> R
    D -- invoke() --> R
    R -- Queue.push --> Q1 --> F1
    R -- Queue.push --> Q2 --> F2
    R -- Queue.push --> Q3 --> F3
```

Notes:

- All four UI modules share the **same** resolver function. There is no per-module
  authorization at the function level — resolvers that must not be callable by
  customers check `isUnlicensedCaller(context)` or rely on the module being
  admin-/agent-only. (See [review.md](review.md) for a hardening suggestion here.)
- The portal footer explicitly opts into `unlicensedAccess` — that is what lets
  anonymous/customer/unlicensed users invoke resolvers at all, and why many code
  paths branch on license status.

---

## 3. The async job pattern

Used three times (asset load, CSV import, export). Learn it once:

```mermaid
sequenceDiagram
    participant FE as Frontend (UI Kit)
    participant SR as start* resolver<br/>(sync, < 1 s)
    participant KVS as Forge KVS
    participant Q as Queue
    participant CO as Consumer function<br/>(async, up to 900 s)

    FE->>SR: invoke('start…Job', payload)
    SR->>SR: capture identity from context<br/>(accountId, unlicensed flag)
    SR->>KVS: set job:<id> = { status: 'pending' }
    Note over SR,KVS: pending marker written BEFORE the push —<br/>otherwise a fast consumer could write 'done'<br/>and then be overwritten by a late 'pending'
    SR->>Q: queue.push({ jobId, …payload, identity })
    SR-->>FE: { jobId }

    Q->>CO: event (no user session — asApp() only)
    CO->>CO: do the heavy work
    CO->>KVS: set job:<id> = { status: 'done', result } (or 'error')

    loop poll every 1–1.5 s (bounded attempts)
        FE->>SR: invoke('get…JobResult', { jobId })
        SR->>KVS: get job:<id>
        SR-->>FE: { status, result? }
    end
```

Why each piece is the way it is:

- **Identity is captured in the start resolver**, not the consumer. A queue-triggered
  invocation has no attached user session, so `context.accountType` /
  `context.accountId` are meaningless there. The synchronous start call is the last
  moment `context` can be trusted, so `unlicensed` and `accountId` are captured
  there and passed through the queue payload.
- **Consumers always use `asApp()`.** Not a choice — there is no user to be. Safety
  rests on the AQL ownership filter scoping results per-user, plus explicit
  ownership verification before writes (`verifyAssetOwnership`).
- **Polling, not push.** UI Kit has no server-push channel; polling a tiny KVS read
  every second is cheap and bounded (60 attempts for asset load, ~400 × 1.5 s for
  export matching its consumer timeout).
- **The three job KVS namespaces** are `asset-load-job:<uuid>`,
  `csv-import-job:<uuid>`, `export-job:<uuid>` (+ `export-job:<uuid>:chunk:<n>`),
  all defined in `src/resolvers/shared.js`.

---

## 4. Storage layout (KVS)

| Key | Written by | Read by | Contents / notes |
|---|---|---|---|
| `assets-schema-config` | `saveConfig`, `applyReconciliation` | almost everything | The single admin config object (see below). Full replace on save, `version` increments monotonically. |
| `asset-list-cache:<accountId>` | `resolveAssetList` (unfiltered successes only) | `resolveAssetList` | 60 s TTL. Slim stubs `{id, objectType:{id,name}}` only. Skipped entirely above 1,000 assets (128 KB safety). Deleted on `updateAssetAttribute`. **Bypassed whenever filters are active** — the key is per-account only, so a filtered result must never be cached under it. |
| `asset-load-job:<jobId>` | start resolver + consumer | poll resolver | `{ status: pending\|done\|error, result?, error? }` |
| `csv-import-job:<jobId>` | start resolver + consumer | poll resolver | Adds live progress: `{ status, total, processed, summary:{created,updated,unchanged,failed}, errors[≤200], warnings[≤200] }` — consumer re-writes it after every 10-row chunk so the panel can show a progress bar. |
| `export-job:<jobId>` | start resolver + consumer | poll resolver | Metadata only: `{ status, result: { filename, mimeType, totalCount, chunkCount } }`. |
| `export-job:<jobId>:chunk:<n>` | export consumer | `getExportJobResult` | The base64 file body split into ≤ 90,000-char slices (128 KB cap). Reassembled and **deleted** on first successful poll read. |

### The config object (`assets-schema-config`)

```js
{
  schemaId: "3",                    // which Assets schema is exposed
  schemaName: "IT Assets",
  hiddenByObjectType: {             // attributes hidden from portal users,
    "258": ["1131", "1140"],        //   keyed by objectTypeId → [attributeId]
  },
  aqlRows: [{                       // ownership rules — each row becomes one AQL candidate
    attribute: "Owner",             //   attribute NAME (AQL uses names, not ids!)
    operator: "=",
    userField: "displayName",       //   accountId | displayName | email | currentUser
    viaReference: false,            //   wrap in inbound/outboundReferences(...)?
    referenceDirection: "outbound",
  }],
  allowPortalEdit: true,            // may unlicensed customers edit?
  editMode: "serviceAccount",       // asApp writes (default) vs asUser (legacy, agents only)
  maxUserAssetLimit: 500,           // server-side cap per user (ceiling 5000)
  version: 42,                      // monotonic; frontends poll getConfigVersion to detect change
  updatedAt: "2026-07-06T…"
}
```

---

## 5. Data flow: loading "My Assets" (the core path)

```mermaid
flowchart TD
    A["Portal footer mounts<br/>(frontend/index.jsx App)"] --> B["invoke('startAssetLoadJob')<br/>{accountId, limit, filters?}"]
    B --> C["assetLoadConsumer.handler<br/>(asset-load-queue)"]
    C --> D["resolveUser(accountId)<br/>profile for AQL value substitution"]
    D --> E["resolveAssetList"]
    E --> F{"filters present?"}
    F -- "no" --> G["check asset-list-cache:accountId<br/>(60s TTL)"]
    F -- "yes" --> H["buildFilterAql(filters)<br/>→ extra AND condition"]
    G -- "miss" --> I
    H --> I["buildAqlCandidates(config.aqlRows, user)<br/>one full AQL per ownership rule"]
    I --> J["searchAllCandidates —<br/>all candidates in PARALLEL"]
    J --> K["searchAssets per candidate:<br/>page 1, then remaining pages in parallel<br/>(100/page, 1000 platform cap)"]
    K --> L["merge, de-dupe by id,<br/>clamp to maxUserAssetLimit"]
    L --> M["buildAssetPayload —<br/>3-stage hydration (defs → statuses → mapping)"]
    M --> N["kvs.set asset-load-job:id<br/>{status:'done', result}"]
    N --> O["Frontend poll picks it up →<br/>renders tabs + DynamicTable"]
```

What each stage produces:

1. **`buildAqlCandidates`** — for each admin rule, a complete query like
   `objectSchemaId = 3 AND "Owner" = "Jane Doe"` (values escaped via
   `escapeAqlValue`; `viaReference` rules become
   `… AND object HAVING outboundReferences("Owner" = "Jane Doe")`).
2. **`searchAllCandidates`** — runs every candidate concurrently, merges results,
   de-duplicates by asset id (an asset matched by two rules appears once).
3. **`buildAssetPayload`** — turns raw Assets API objects into the UI shape:
   `{ id, label, objectKey, objectTypeId, objectTypeName, visibleValues, rawValues }`
   plus `columnsToShow` (attribute definitions minus built-ins minus admin-hidden).
4. **Pagination after page 1** goes through the *synchronous* `getUserAssetsPage`
   (10 at a time — small enough to stay far below 25 s), hydrating cached stubs
   on demand.

### Filtering (two-pass)

Typing in the FilterBar does two things at once:

- **Instant client pass** — `useFilteredAssets` narrows already-loaded rows in
  memory immediately (substring for text, exact for status, range for dates).
- **Debounced server pass** — the same filter state is shaped by
  `buildFiltersPayload` and sent through a fresh asset-load job;
  `buildFilterAql` converts it to AQL ANDed onto every ownership candidate, so the
  *full* matching set (not just loaded pages) comes back. Server results replace
  the client-narrowed view when they arrive; a `latestLoadRequestIdRef` staleness
  guard discards responses that were superseded by newer keystrokes.

---

## 6. Data flow: inline edit

```mermaid
sequenceDiagram
    participant U as User (portal)
    participant FE as EditAssetModal
    participant R as updateAssetAttribute
    participant J as Jira Assets API

    U->>FE: change a field, Save
    FE->>R: invoke('updateAssetAttribute', {objectId, attrId, value…})
    R->>R: unlicensed? → require config.allowPortalEdit
    R->>J: verifyAssetOwnership — re-runs ownership AQL asApp()<br/>and checks objectId is in the result
    alt not owned
        R-->>FE: error "You do not have permission…"
    else owned
        R->>J: PUT /object/{id} (asApp by default;<br/>asUser only in legacy 'userAccount' mode)
        R->>R: kvs.delete(asset-list-cache:accountId)
        R-->>FE: updated object
    end
```

The ownership re-verification is the critical line of defense: the client supplies
`objectId`, so without it any caller could edit any object the app can reach.

---

## 7. Data flow: export (XLSX / PDF)

```mermaid
flowchart TD
    A["ExportButtons click"] --> B["invoke('startExportJob')<br/>{format, filters?, objectTypeId?}"]
    B --> C["exportJobConsumer (export-queue, 600s)"]
    C --> D["re-run resolveAssetList server-side<br/>(fresh fetch, filters honored,<br/>maxUserAssetLimit enforced)"]
    D --> E["buildAssetPayload → groupAssetsByType"]
    E --> F{"format"}
    F -- xlsx --> G["buildXlsx — one sheet per object type,<br/>auto column widths (SheetJS)"]
    F -- pdf --> H["buildPdf — A4 landscape, manual row layout,<br/>repeated headers on page breaks (pdfkit)"]
    G --> I["base64 → 90k-char chunks →<br/>export-job:id:chunk:0..N"]
    H --> I
    I --> J["export-job:id = {done, filename, mimeType, chunkCount}"]
    J --> K["getExportJobResult reassembles chunks,<br/>DELETES them, returns full base64"]
    K --> L["triggerBase64Download —<br/>data: URI + synthetic click"]
```

Design decisions worth knowing:

- The consumer **always re-fetches** rather than accepting a client-supplied asset
  array. This guarantees the export reflects the full matching set (not just
  paginated-in rows), keeps the queue payload tiny, and closes the "client sends a
  doctored array" hole the old synchronous `exportAssets` resolver had.
- When exporting from a specific type's tab with filters active, `objectTypeId`
  narrows the result to that type — "export what I'm looking at."
- Chunk cleanup happens on first successful read; an abandoned job's chunks are
  currently only cleaned up implicitly (see [review.md](review.md) → TTL suggestion).

---

## 8. Data flow: CSV import

```mermaid
flowchart TD
    A["Agent opens issue panel"] --> B["getIssueCsvAttachments<br/>(asUser — agent's own permission)"]
    B --> C["Agent picks attachment + object type"]
    C --> D["previewCsvImport:<br/>parse CSV, match headers to attribute names,<br/>report matched/unmatched + unique-key column"]
    D --> E["Agent reviews, toggles create-only, Start"]
    E --> F["startCsvImportJob → csv-import-queue"]
    F --> G["csvImportConsumer (asApp, 900s)"]
    G --> H["re-download + re-parse CSV<br/>(payload carries attachmentId, not rows)"]
    H --> I["per row, in chunks of 10:"]
    I --> J["1. unique key = FIRST column's value<br/>(missing/duplicate → failed)"]
    J --> K["2. buildAttributesPayload:<br/>dates → ISO · object refs → resolve name→id<br/>(unresolved ref = warning, attr dropped)"]
    K --> L["3. AQL lookup by unique key"]
    L --> M{"exists?"}
    M -- "no" --> N["POST /object/create → created++"]
    M -- "yes + createOnly" --> O["failed++ ('already exists — not overwritten')"]
    M -- "yes" --> P{"any value<br/>actually different?"}
    P -- "no" --> Q["unchanged++ (no API write)"]
    P -- "yes" --> R["PUT /object/{id} → updated++"]
    I --> S["progress written to KVS each chunk →<br/>panel shows ProgressBar + live counts"]
```

Conventions the import relies on (documented in code, enforce them in your CSVs):

- **The first CSV column is always the unique key.** No configuration — preview
  and consumer derive it identically from the same parsed headers.
- **Headers match attribute *names*** (case-insensitive exact match). Unmatched
  columns are ignored and reported, never guessed.
- Errors (row failed) and warnings (row imported, one attribute dropped) are
  separate lists, each capped at 200 entries with a truncation flag.

---

## 9. Data flow: admin configuration

```mermaid
flowchart LR
    A["ConfigurePage loads"] --> B["getSchemas / getObjectTypes /<br/>getObjectTypeAttributes (all asUser —<br/>admin's own Assets permission)"]
    B --> C["Admin: pick schema → hide attributes per type →<br/>define AQL ownership rows → test with validateAql +<br/>searchAssetUsers/getAssetsForUser preview → limits/toggles"]
    C --> D["saveConfig → sanitizes shapes,<br/>bumps version, FULL-REPLACES<br/>assets-schema-config in KVS"]
    A --> E["reconcileConfig (on load):<br/>diff saved hidden ids vs live schema<br/>→ drift banner"]
    E --> F["applyReconciliation:<br/>strip confirmed-ghost type/attr ids<br/>from saved config"]
```

Reconciliation subtleties (hard-won — see git-less history in `CLAUDE.md`):

- Attribute fetches run in **chunks of 5** with failures tracked per type. A type
  whose fetch failed (rate-limit etc.) is reported as *unverified*, **not** treated
  as "all its attributes were deleted" — that distinction is what fixed a recurring
  false "Schema drift detected" banner.
- `saveConfig` **replaces** the whole config. The frontend guards against
  re-selecting the already-selected schema, which previously reset
  `hiddenByObjectType` to `{}` in UI state and, if saved, permanently erased it.

---

## 10. Caching & performance summary

| Mechanism | Where | Why |
|---|---|---|
| 60 s per-user asset-list cache (slim stubs) | `resolveAssetList` | Pagination ("Load more") hits the same list repeatedly; re-running all ownership AQLs each click would be slow and rate-limit-prone. |
| Parallel page fetches after page 1 | `searchAssets` | Turned N sequential round-trips into ~2 round-trips of latency; part of the original 25 s-timeout fix. |
| Parallel ownership candidates | `searchAllCandidates` | Same reasoning across rules. |
| Bounded concurrency (chunks of 5/10) | `reconcileConfig`, `csvImportConsumer` | Full parallelism across many types/rows tripped Jira rate limiting; chunking trades a little latency for reliability. |
| Per-job reference-lookup cache | `csvImportConsumer` | The same reference value ("Samsung") repeats across many rows; one AQL lookup per distinct value instead of per row. |
| Filtered-request cache bypass | `resolveAssetList` | Cache key is per-account only — serving a cached unfiltered list to a filtered request (or vice versa) would silently show wrong results. |
