# AssetDesk Requirements Handoff

## Context

This handoff is for the next implementation agent. The current request is not to change code yet, but to understand the desired behavior and prepare implementation work.

The app is a Forge/Jira Assets experience that shows a user's related assets in a table. The user wants the table to feel more spreadsheet-like, support attribute-based filtering, export only filtered data, include assets related through ownership relationships, and evaluate long-running server-side processing patterns.

## Core Goal

Improve the "My assets" table so users can find, filter, view, and export the assets that belong to them or are related to things they own.

The implementation agent should first inspect the current code and determine what already exists, what is partial, and what is missing before making changes.

## 1. Spreadsheet-Like Asset Table

The table should support many visible columns at once because the table represents essential attributes from Jira Assets object types.

Expected behavior:

- Show columns such as `Name`, `Key`, `Asset Tag`, `Device Type`, `Asset Status`, `Operational Status`, `Status`, `Model Name`, `Purchase Date`, `Refresh Date`, `Owner Group`, `Support Group`, and other visible attributes.
- Keep the experience usable inside the limited Forge/JSM host container.
- Prefer a spreadsheet-like layout:
  - horizontal scrolling where needed;
  - compact controls;
  - fewer always-visible controls;
  - filter controls that can collapse/expand;
  - enough rows visible to make the table useful.

Do not simply make the table larger if the host container is the limiting factor. Redesign the surrounding layout to make the space work better.

## 2. Attribute-Based Filtering

Users should be able to filter results using the same attributes/columns already visible in the table.

Filtering should apply to all filterable visible attributes, not only hardcoded fields.

Expected filter types:

- Date/time attributes:
  - Example: `Purchase Date`, warranty expiry, refresh date.
  - User should be able to choose a date or date range.
  - The table should only show assets matching that range.

- Select/options/status attributes:
  - Example: `Asset Status`, `Operational Status`, `Status`, `Device Type`.
  - User should be able to select one or more valid options where supported.
  - Options should come from existing attribute metadata or values already present.

- String/text attributes:
  - Example: `Name`, `Asset Tag`, `Model Name`, `Owner Group`, `Support Group`, serial-like fields.
  - User should be able to type search text.
  - Matching should filter based on the relevant column value.

## 3. Filtering Scope

The user wants filtering to reduce the results shown on the page.

The implementation agent should inspect current pagination/loading behavior and decide the correct filter model:

- At minimum, filtering must affect the currently loaded/page-visible assets.
- Ideally, filtering should also support server-side criteria so the app can retrieve a narrower result set instead of fetching too many assets and hiding them client-side.
- If filtering is client-side only, clearly document the limitation in the code or UI behavior.
- If filtering is server-side, ensure load-more/pagination/export use the same active criteria.

Important: filtered state should not confuse the user by mixing filtered and unfiltered pages.

## 4. Export Must Respect Filters

Export buttons must output only the filtered content when filters are active.

Expected behavior:

- Excel export should include only assets matching the current filters.
- PDF export should include only assets matching the current filters.
- Export should not include hidden/non-matching rows when filters are active.
- Export should preserve the same visible columns/attributes the table is using, unless the existing export design intentionally exports more.

Implementation agent should inspect:

- whether export currently uses `assets` from the UI;
- whether export fetches server-side data independently;
- whether it ignores client-side filters;
- whether it needs to accept `searchCriteria` or a filtered asset list.

## 5. Ownership Through Related / Child Items

The asset list should include assets that are related to objects the user owns.

Example from screenshots:

- User owns a `Hardware Models` object named `Apple TV`.
- There is a `TV` object named `MYAPPLE TV`.
- `MYAPPLE TV` has an object reference such as `Model Name = Apple TV`.
- Because the user owns `Apple TV`, the user should see `MYAPPLE TV` in "My assets" even if they are not directly listed as the owner on `MYAPPLE TV`.

Required ownership behavior:

- Ownership should not only mean "the current user is directly set on the asset."
- Ownership should also include assets that reference, are children of, or are otherwise related to an object the user owns.
- The result list should merge direct-owned assets and related-child assets without duplicates.

Implementation agent should inspect the AQL builder/rules and determine whether this is already supported.

Possible implementation direction:

- Add or verify an admin-configurable ownership mode like "children of owned objects" or "via reference".
- Support AQL relationship traversal using inbound or outbound references.
- Allow configuration of which object-reference attribute connects child assets to owned parent/model objects.
- Ensure ownership verification for edits uses the same logic, so a user can only edit related assets if that is intended by configuration.

## 6. AQL Requirements

The agent should review the existing AQL generation.

Requirements:

- Existing direct ownership AQL rules should continue working.
- Add/verify support for AQL rules that return assets related to objects owned by the current user.
- Support both directions where relevant:
  - child references parent/model object;
  - parent/model has inbound references from child assets.
- Make this configurable, because different schemas may use different object reference directions and attribute names.
- Avoid duplicates when multiple AQL rules match the same asset.

The user specifically wants the AQL requirement checked so that related objects like `MYAPPLE TV` are included when the user owns `Apple TV`.

## 7. Long-Running Server-Side Operations

The implementation agent should check whether the current code already includes, partially includes, or lacks a server-side long-running job pattern for export and heavy operations.

Goal to explore:

- Move export and other potentially long-running operations to server-side implementation where appropriate.
- Consider Atlassian Forge Async Events API plus Long-Running Compute.
- Consumer functions normally default to shorter execution windows, but can be configured up to `900` seconds / 15 minutes using `timeoutSeconds`.

Inspect whether:

- exports currently run client-side, resolver-side, or through queued async jobs;
- `manifest.yml` already includes Async Events API modules;
- any function already uses `timeoutSeconds`;
- large exports could time out with the current approach;
- there is a job/progress/status model already present.

## 8. CSV Ticket Attachment Import Use Case

The user also wants the architecture to support heavy CSV import work.

Use case:

- Process a CSV ticket attachment.
- Each CSV row represents an asset.
- CSV columns map to asset attributes.
- `Serial Number` is the primary/unique key.
- Before creating an asset, look up whether an asset with the same `Serial Number` already exists.
- If found, update or skip based on the intended behavior.
- If not found, create a new asset object.

Implementation considerations:

- This should likely be server-side and async.
- The UI should not block while processing.
- The user should receive progress/status/error details.
- Failures should identify the row and reason.
- The process should avoid duplicate asset creation.

## 9. Acceptance Criteria

The next implementation should be considered successful when:

- Users can filter the asset table by date ranges, option/select/status values, and string values from visible attributes.
- Filters apply consistently to the current table view.
- Exported Excel/PDF content matches the active filtered result set.
- Direct-owned assets still appear.
- Assets related to objects the user owns also appear, such as child assets referencing an owned model object.
- Duplicate assets are not shown when multiple AQL rules match.
- The agent has inspected and documented whether long-running export/import operations should use Forge Async Events and `timeoutSeconds`.
- The CSV import use case has a proposed or implemented server-side async design.

## 10 Deal with this error that come up when deploying 
1 issue found. Run forge lint to review the warnings.

√ Deploying AssetDesk to development...

i Packaging app files
‼ export 'default' (imported as 'XLSXModule') was not found in 'xlsx' (possible exports: CFB, SSF, parse_xlscfb, parse_zip, read, readFile, readFileSync, set_cptable, set_fs, stream, utils, version, write, writeFile, writeFileAsync, writeFileSync, writeFileXLSX, writeXLSX)

## 11. Important Instruction For The Implementation Agent

Before coding, inspect the existing implementation and explicitly report:

- what already exists;
- what is partially implemented;
- what is missing;
- which files/functions need changes;
- whether the existing AQL model can support related-child ownership or needs extension;
- whether export currently respects filtered data;
- whether async long-running compute is already present.

Then implement the smallest safe change set that satisfies these goals.
