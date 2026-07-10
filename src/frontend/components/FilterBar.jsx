import React, { useState, useMemo } from 'react';
import {
  Text,
  Inline,
  Stack,
  Box,
  Button,
  Badge,
  Textfield,
  Select,
  DatePicker,
  Popup,
  Checkbox,
  xcss,
} from '@forge/react';
import { isFilterValueEmpty, isParenSafeAql } from './shared';

// ─── FilterBar ────────────────────────────────────────────────────────────────
// Renders above the tabs/table, modeled on Jira Assets' own object-search
// panel (search box + a checkbox picker of attributes):
//   - A Basic / AQL mode toggle. Basic shows a name/key search box + the
//     attribute picker; AQL shows one raw-AQL input instead. Both kinds of
//     filter state stay live regardless of which mode's inputs are visible
//     (they AND together server-side), so switching modes never silently
//     drops an active filter.
//   - A "+ Filters" button opening a Popup with a searchable Checkbox list
//     of the current view's filterable attributes. Only CHECKED attributes
//     render an input control — previously every column rendered one up
//     front, which made the bar tall on attribute-rich schemas and pushed
//     the table further down with every extra column. The Popup overlays
//     instead of reflowing, so picking attributes never moves the table.
//   - Active filter chips (each individually removable) + count badge +
//     "Clear all"
//   - A "Filtered by:" line echoing the exact AQL condition the server
//     applied (appliedFilterAql, from buildFilterAql via the asset-load
//     job) — "how did we reach these items". Deliberately only the FILTER
//     part of the query; the ownership half is implied ("these are my
//     assets") and contains admin rule structure + the user's own identity
//     values, which isn't useful to echo back.
//
// Value/name state lives in App (controlled via onNameChange /
// onFilterChange / onClear); which attributes are picked also lives in App
// (selectedAttrIds / onToggleAttr) so the choice survives this component
// remounting. Only ephemeral UI state (popup open, picker search text) is
// local. An attribute with an ACTIVE value always counts as selected even
// if it was never explicitly checked (e.g. state restored) — otherwise its
// value would keep applying with no visible control to clear it.

const filterBarStyle = xcss({
  backgroundColor: 'color.background.input',
  borderRadius: 'border.radius.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  padding: 'space.200',
  paddingInline: 'space.250',
});

const filterChipStyle = xcss({
  backgroundColor: 'color.background.brand.subtlest',
  borderRadius: 'border.radius.100',
  padding: 'space.050',
  paddingInline: 'space.100',
  display: 'flex',
  alignItems: 'center',
});

// The "+ Filters" attribute-picker Popup panel. Capped height with its own
// scroll so a type with dozens of attributes stays a tidy overlay instead
// of a floor-to-ceiling list.
const filterPickerPanelStyle = xcss({
  padding: 'space.150',
  minWidth: '240px',
  maxHeight: '320px',
  overflowY: 'auto',
});

// Renders a chip label for one active filter's value, regardless of shape
// (plain string vs. { from, to } date range).
const formatFilterChipValue = (value) => {
  if (typeof value === 'object' && value) {
    const { from, to } = value;
    if (from && to) return `${from} → ${to}`;
    if (from) return `From ${from}`;
    if (to) return `Until ${to}`;
    return '';
  }
  return String(value || '').trim();
};

const FilterBar = ({
  columns,
  nameQuery,
  activeFilters,
  selectedAttrIds,
  onToggleAttr,
  onNameChange,
  onFilterChange,
  onClear,
  appliedFilterAql,
  scopeObjectTypeName,
  filterMode,
  onModeChange,
  aqlQuery,
  onAqlChange,
}) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [attrSearch, setAttrSearch] = useState('');

  const trimmedAql = (aqlQuery || '').trim();
  const aqlIsUnsafe = Boolean(trimmedAql) && !isParenSafeAql(trimmedAql);

  const activeCount =
    (nameQuery.trim() ? 1 : 0) +
    (trimmedAql ? 1 : 0) +
    Object.values(activeFilters).filter((v) => !isFilterValueEmpty(v)).length;

  const hasFilters = activeCount > 0;

  // Checked attributes ∪ attributes with a live value — see the component
  // comment for why an active value always implies "selected".
  const effectiveSelected = useMemo(() => {
    const set = new Set(selectedAttrIds);
    Object.entries(activeFilters).forEach(([id, v]) => {
      if (!isFilterValueEmpty(v)) set.add(id);
    });
    return set;
  }, [selectedAttrIds, activeFilters]);

  const selectedColumns = columns.filter((c) => effectiveSelected.has(c.attributeId));

  const pickerSearch = attrSearch.trim().toLowerCase();
  const pickerColumns = pickerSearch
    ? columns.filter((c) => (c.attributeName || '').toLowerCase().includes(pickerSearch))
    : columns;

  return (
    <Box xcss={filterBarStyle}>
      <Stack space="space.150">
        {/* Row 1 — mode toggle, then either the Basic inputs (search box +
            attribute picker) or the raw-AQL input, plus count + clear. The
            Popup overlays so opening it never pushes the table down.
            Switching modes hides the other mode's INPUTS but never clears
            its state — everything active still shows in the chips row and
            still applies (the two modes AND together server-side). */}
        <Inline space="space.150" alignBlock="center" shouldWrap>
          <Inline space="space.050" alignBlock="center">
            <Button
              appearance={filterMode === 'aql' ? 'subtle' : 'primary'}
              spacing="compact"
              onClick={() => onModeChange('basic')}
            >
              Basic
            </Button>
            <Button
              appearance={filterMode === 'aql' ? 'primary' : 'subtle'}
              spacing="compact"
              onClick={() => onModeChange('aql')}
            >
              AQL
            </Button>
          </Inline>

          {filterMode === 'aql' ? (
            <Box xcss={xcss({ minWidth: '260px', flexGrow: '1' })}>
              <Textfield
                id="filter-raw-aql"
                placeholder={`e.g. "Operational Status" = "Active" AND "Model Name" like "Dell"`}
                value={aqlQuery}
                onChange={(e) => onAqlChange(e.target.value)}
              />
            </Box>
          ) : (
            <Box xcss={xcss({ minWidth: '200px', flexGrow: '1' })}>
              <Textfield
                id="filter-name"
                placeholder="Search by name or key…"
                value={nameQuery}
                onChange={(e) => onNameChange(e.target.value)}
              />
            </Box>
          )}

          {filterMode !== 'aql' && <Popup
            isOpen={isPickerOpen}
            onClose={() => setIsPickerOpen(false)}
            placement="bottom-start"
            content={() => (
              <Box xcss={filterPickerPanelStyle}>
                <Stack space="space.100">
                  <Textfield
                    id="filter-attr-search"
                    placeholder="Search attributes…"
                    value={attrSearch}
                    onChange={(e) => setAttrSearch(e.target.value)}
                  />
                  {pickerColumns.map((col) => (
                    <Checkbox
                      key={col.attributeId}
                      label={col.attributeName}
                      isChecked={effectiveSelected.has(col.attributeId)}
                      onChange={() => onToggleAttr(col.attributeId, effectiveSelected.has(col.attributeId))}
                    />
                  ))}
                  {pickerColumns.length === 0 && (
                    <Text size="small" color="color.text.subtlest">
                      No attributes match "{attrSearch.trim()}"
                    </Text>
                  )}
                </Stack>
              </Box>
            )}
            trigger={() => (
              <Button
                appearance={selectedColumns.length > 0 ? 'primary' : 'default'}
                onClick={() => setIsPickerOpen((open) => !open)}
              >
                + Filters{selectedColumns.length > 0 ? ` (${selectedColumns.length})` : ''}
              </Button>
            )}
          />}

          {hasFilters && <Badge appearance="primary">{activeCount}</Badge>}
          {hasFilters && (
            <Button appearance="subtle" spacing="compact" onClick={onClear}>
              Clear all
            </Button>
          )}
        </Inline>

        {/* AQL-mode feedback: a live syntax guard (same isParenSafeAql rule
            the server enforces — an unsafe condition is never sent, see
            buildFiltersPayload) and a one-line hint for first-time use. */}
        {filterMode === 'aql' && aqlIsUnsafe && (
          <Text size="small" color="color.text.danger">
            Unbalanced parentheses or an unclosed quote — this condition won't be applied until it's fixed.
          </Text>
        )}
        {filterMode === 'aql' && !trimmedAql && (
          <Text size="small" color="color.text.subtlest">
            Type a raw AQL condition . Quote attribute
            names and values (e.g. "Asset Status" = "In Stock"); AND / OR / like are supported.
          </Text>
        )}

        {/* Row 2 — one type-appropriate control per PICKED attribute only
            (Basic mode; in AQL mode the typed condition is the control,
            though any still-active basic values keep applying via chips) */}
        {filterMode !== 'aql' && selectedColumns.length > 0 && (
            <Inline space="space.150" alignBlock="center" shouldWrap>
              {selectedColumns.map((col) => {
                if (col.attributeType === 'date') {
                  const current = activeFilters[col.attributeId] || {};
                  return (
                    <Inline key={col.attributeId} space="space.075" alignBlock="center">
                      <Box xcss={xcss({ minWidth: '120px' })}>
                        <DatePicker
                          id={`filter-attr-${col.attributeId}-from`}
                          value={current.from || ''}
                          onChange={(date) =>
                            onFilterChange(col.attributeId, { ...current, from: date || '' })
                          }
                          placeholder={`${col.attributeName} from`}
                        />
                      </Box>
                      <Box xcss={xcss({ minWidth: '120px' })}>
                        <DatePicker
                          id={`filter-attr-${col.attributeId}-to`}
                          value={current.to || ''}
                          onChange={(date) =>
                            onFilterChange(col.attributeId, { ...current, to: date || '' })
                          }
                          placeholder={`${col.attributeName} to`}
                        />
                      </Box>
                    </Inline>
                  );
                }

                if (col.attributeType === 'select' || col.attributeType === 'status') {
                  // Real dropdown built from the known option list, so the
                  // user can only ever pick a value that actually exists —
                  // no more partial-text mismatches between what's typed
                  // and what the server can exact-match. status uses
                  // statusOptions ({value: statusId, label: statusName});
                  // we key the Select's `value` on the LABEL (not the
                  // status ID) since filtering matches against the
                  // attribute's display text, same as what's shown in the
                  // table — the ID is only meaningful for the edit-modal's
                  // save payload, not for filtering.
                  const rawOptions =
                    col.attributeType === 'status'
                      ? (col.statusOptions || []).map((o) => ({ label: o.label, value: o.label }))
                      : (col.options || []).map((o) => ({ label: o, value: o }));

                  if (rawOptions.length === 0) {
                    // No known values to pick from (e.g. status options
                    // couldn't be resolved) — fall back to freeform text,
                    // substring-matched server-side.
                    return (
                      <Box key={col.attributeId} xcss={xcss({ minWidth: '160px', flexGrow: '1' })}>
                        <Textfield
                          id={`filter-attr-${col.attributeId}`}
                          placeholder={`${col.attributeName} (comma-separated)`}
                          value={activeFilters[col.attributeId] || ''}
                          onChange={(e) => onFilterChange(col.attributeId, e.target.value)}
                        />
                      </Box>
                    );
                  }

                  const selectedLabels = String(activeFilters[col.attributeId] || '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const selectedOptions = rawOptions.filter((o) => selectedLabels.includes(o.value));

                  return (
                    <Box key={col.attributeId} xcss={xcss({ minWidth: '180px', flexGrow: '1' })}>
                      <Select
                        inputId={`filter-attr-${col.attributeId}`}
                        options={rawOptions}
                        value={selectedOptions}
                        isMulti
                        onChange={(opts) =>
                          onFilterChange(col.attributeId, (opts || []).map((o) => o.value).join(','))
                        }
                        placeholder={col.attributeName}
                      />
                    </Box>
                  );
                }

                return (
                  <Box key={col.attributeId} xcss={xcss({ minWidth: '130px', flexGrow: '1' })}>
                    <Textfield
                      id={`filter-attr-${col.attributeId}`}
                      placeholder={col.attributeName}
                      value={activeFilters[col.attributeId] || ''}
                      onChange={(e) => onFilterChange(col.attributeId, e.target.value)}
                    />
                  </Box>
                );
              })}
            </Inline>
        )}

        {/* Active filter summary chips — each removable individually.
            OUTSIDE the selectedColumns block so a name-only filter still
            shows its chip even with no attribute controls picked. Only
            BASIC filters get chips — the raw AQL condition is already on
            screen twice (the input box and the bold "Filtered by" line
            below), so a third copy as a chip was pure noise. */}
        {(nameQuery.trim() !== '' ||
          Object.values(activeFilters).some((v) => !isFilterValueEmpty(v))) && (
          <Inline space="space.075" shouldWrap alignBlock="center">
            <Text size="small" color="color.text.subtlest">Active:</Text>
            {nameQuery.trim() && (
              <Box xcss={filterChipStyle}>
                <Inline space="space.050" alignBlock="center">
                  <Text size="small" color="color.text.brand">
                    Name/Key: "{nameQuery.trim()}"
                  </Text>
                  <Button appearance="subtle" spacing="compact" onClick={() => onNameChange('')}>
                    ✕
                  </Button>
                </Inline>
              </Box>
            )}
            {Object.entries(activeFilters)
              .filter(([, v]) => !isFilterValueEmpty(v))
              .map(([attrId, val]) => {
                const col = columns.find((c) => c.attributeId === attrId);
                return (
                  <Box key={attrId} xcss={filterChipStyle}>
                    <Inline space="space.050" alignBlock="center">
                      <Text size="small" color="color.text.brand">
                        {col?.attributeName || attrId}: "{formatFilterChipValue(val)}"
                      </Text>
                      <Button
                        appearance="subtle"
                        spacing="compact"
                        onClick={() => onFilterChange(attrId, typeof val === 'object' ? {} : '')}
                      >
                        ✕
                      </Button>
                    </Inline>
                  </Box>
                );
              })}
          </Inline>
        )}

        {/* "How did we reach these items" — the exact filter condition the
            server ANDed onto the ownership query, echoed back from
            buildFilterAql via the asset-load job result. Only the filter
            half; ownership is implied. Hidden until a filtered server
            response has actually landed (it lags a keystroke behind the
            instant client-side pass by design — it describes the CURRENT
            server-fetched result set, not the in-flight keystrokes).
            When a specific type's tab is open, the type is shown as part
            of the condition too — the server ran the attribute filter
            across ALL types (that's how every tab's count stays known),
            and the tab supplies the type narrowing, so
            `objectType = "X" AND <filter>` is precisely what describes
            the rows on screen even though the two halves are applied in
            different places. One Text element, so label and condition
            share a font size and baseline — mixing size="small" with
            full-size bold in an Inline left the pair visibly misaligned.
            Type prefix skipped when the condition ALREADY references
            objectType (possible in raw-AQL mode) — otherwise a query like
            `objectType = "Phones" AND …` that narrows the result to one
            type would get that same type prepended a second time by the
            single-type-view scoping. */}
        {hasFilters && appliedFilterAql && (
          <Text>
            <Text as="span" color="color.text.subtlest">Filtered by AQL: </Text>
            <Text as="strong">
              {scopeObjectTypeName && !/\bobjectType\b/i.test(appliedFilterAql)
                ? `objectType = "${scopeObjectTypeName}" AND `
                : ''}{appliedFilterAql}
            </Text>
          </Text>
        )}
      </Stack>
    </Box>
  );
};

export default FilterBar;
