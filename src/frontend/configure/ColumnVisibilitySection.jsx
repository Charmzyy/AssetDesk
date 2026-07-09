import React, { useState, useEffect, useMemo } from "react";
import {
  Box,
  Stack,
  Inline,
  Text,
  Button,
  Label,
  Toggle,
  Badge,
  Textfield,
  xcss,
} from "@forge/react";
import {
  errorBannerStyle,
  metaRowStyle,
  objectTypeCardStyle,
  objectTypeCardAccentStyle,
} from "./styles";

// ─── Column visibility (Step 5) ────────────────────────────────────────────────
// One expandable card per object type, each with per-attribute show/hide
// toggles. Hidden attribute ids are stored per object type in the config's
// hiddenByObjectType map and enforced server-side by buildAssetPayload
// (resolvers/shared.js). The old uncontrolled ObjectTypeColumns variant
// this superseded was deleted when ConfigurePage.jsx was split — it had no
// remaining render call sites and had already caused one edit-ambiguity
// near-miss.

const ATTRS_PER_PAGE = 8; // attributes shown per object-type page

const paginationBarStyle = xcss({
  paddingTop: "space.200",
  borderTopWidth: "border.width",
  borderTopStyle: "solid",
  borderTopColor: "color.border",
  marginTop: "space.200",
});

// ─── ObjectTypeColumnsControlled ──────────────────────────────────────────────
// Per-type card, controllable by the section's forceExpanded prop and
// pre-filtered by its active global search.

const ObjectTypeColumnsControlled = ({
  objectType,
  hiddenIds,
  onToggle,
  onToggleAll,
  forceExpanded,
  globalFilter,
}) => {
  const attrs = objectType.attributes || [];
  const [localExpanded, setLocalExpanded] = useState(false);
  const [localFilter, setLocalFilter] = useState("");
  const [page, setPage] = useState(0);

  // forceExpanded prop takes precedence over local state
  const isExpanded = forceExpanded || localExpanded;

  const visibleCount = attrs.filter((a) => !hiddenIds.has(a.attributeId)).length;
  const allVisible = visibleCount === attrs.length;
  const noneVisible = visibleCount === 0;

  // When global filter changes, reset local page
  useEffect(() => { setPage(0); }, [globalFilter, localFilter]);

  // Apply both global and local filters
  const filteredAttrs = useMemo(() => {
    const gq = globalFilter.trim().toLowerCase();
    const lq = localFilter.trim().toLowerCase();
    return attrs.filter((a) => {
      if (gq && !a.attributeName?.toLowerCase().includes(gq)) return false;
      if (lq && !a.attributeName?.toLowerCase().includes(lq)) return false;
      return true;
    });
  }, [attrs, globalFilter, localFilter]);

  const totalPages = Math.ceil(filteredAttrs.length / ATTRS_PER_PAGE);
  const pagedAttrs = filteredAttrs.slice(page * ATTRS_PER_PAGE, (page + 1) * ATTRS_PER_PAGE);

  if (attrs.length === 0) {
    return (
      <Box xcss={objectTypeCardStyle}>
        <Inline spread="space-between" alignBlock="center">
          <Text weight="medium">{objectType.objectTypeName}</Text>
          <Text size="small" color="color.text.subtlest">No configurable attributes.</Text>
        </Inline>
      </Box>
    );
  }

  // Auto-expand when global filter matches attributes inside this type
  const hasGlobalMatch = globalFilter && filteredAttrs.length > 0;
  const cardXcss = isExpanded || hasGlobalMatch ? objectTypeCardAccentStyle : objectTypeCardStyle;

  return (
    <Box xcss={cardXcss}>
      <Stack space="space.150">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <Inline spread="space-between" alignBlock="center">
          <Inline space="space.150" alignBlock="center">
            <Button
              appearance="subtle"
              spacing="compact"
              onClick={() => setLocalExpanded((prev) => !prev)}
            >
              {(isExpanded || hasGlobalMatch) ? "▾" : "▸"}
            </Button>
            <Text weight="medium">{objectType.objectTypeName}</Text>
            <Badge appearance={visibleCount > 0 ? "primary" : "removed"}>
              {visibleCount}
            </Badge>
            <Text size="small" color="color.text.subtlest">/ {attrs.length}</Text>
          </Inline>
          <Inline space="space.075">
            <Button
              appearance="subtle"
              spacing="compact"
              isDisabled={allVisible}
              onClick={() => onToggleAll(objectType.objectTypeId, attrs, true)}
            >
              Show all
            </Button>
            <Button
              appearance="subtle"
              spacing="compact"
              isDisabled={noneVisible}
              onClick={() => onToggleAll(objectType.objectTypeId, attrs, false)}
            >
              Hide all
            </Button>
          </Inline>
        </Inline>

        {/* ── Expanded content ────────────────────────────────────────────── */}
        {(isExpanded || hasGlobalMatch) && (
          <Stack space="space.150">
            {/* Per-type local search (only shown when there are many attrs AND no global filter) */}
            {attrs.length > ATTRS_PER_PAGE && !globalFilter && (
              <Textfield
                id={`local-filter-${objectType.objectTypeId}`}
                placeholder={`Filter within ${objectType.objectTypeName}…`}
                value={localFilter}
                onChange={(e) => setLocalFilter(e.target.value)}
              />
            )}

            {filteredAttrs.length === 0 && (
              <Text size="small" color="color.text.subtlest">
                No attributes match the current filter.
              </Text>
            )}

            {pagedAttrs.map((attr) => {
              const isVisible = !hiddenIds.has(attr.attributeId);
              return (
                <Inline key={attr.attributeId} alignBlock="center" spread="space-between">
                  <Inline alignBlock="center" space="space.150">
                    <Toggle
                      id={`toggle-${objectType.objectTypeId}-${attr.attributeId}`}
                      isChecked={isVisible}
                      onChange={() => onToggle(objectType.objectTypeId, attr.attributeId)}
                    />
                    <Text
                      size="small"
                      color={isVisible ? "color.text" : "color.text.subtlest"}
                    >
                      {attr.attributeName}
                    </Text>
                  </Inline>
                  {!isVisible && (
                    <Text size="small" color="color.text.danger">Hidden</Text>
                  )}
                </Inline>
              );
            })}

            {/* Pagination */}
            {totalPages > 1 && (
              <Box xcss={paginationBarStyle}>
                <Inline spread="space-between" alignBlock="center">
                  <Text size="small" color="color.text.subtlest">
                    {page + 1} / {totalPages} ({filteredAttrs.length} attrs)
                  </Text>
                  <Inline space="space.100">
                    <Button
                      appearance="subtle"
                      spacing="compact"
                      isDisabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      ← Prev
                    </Button>
                    <Button
                      appearance="subtle"
                      spacing="compact"
                      isDisabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next →
                    </Button>
                  </Inline>
                </Inline>
              </Box>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  );
};

// ─── ColumnVisibilitySection ──────────────────────────────────────────────────
// Wraps all per-type cards with a global search + "expand all / collapse all"

const ColumnVisibilitySection = ({
  objectTypeGroups,
  hiddenByObjectType,
  onToggle,
  onToggleAll,
  loadingAttrs,
  attrError,
}) => {
  const [globalFilter, setGlobalFilter] = useState("");
  const [expandAll, setExpandAll] = useState(false);

  const filteredGroups = useMemo(() => {
    const q = globalFilter.trim().toLowerCase();
    if (!q) return objectTypeGroups;
    return objectTypeGroups.filter(
      (g) =>
        g.objectTypeName?.toLowerCase().includes(q) ||
        (g.attributes || []).some((a) => a.attributeName?.toLowerCase().includes(q))
    );
  }, [objectTypeGroups, globalFilter]);

  const totalTypes = objectTypeGroups.length;
  const totalAttrs = objectTypeGroups.reduce((acc, g) => acc + (g.attributes?.length || 0), 0);
  const totalHidden = objectTypeGroups.reduce(
    (acc, g) => acc + (hiddenByObjectType[g.objectTypeId]?.size || 0),
    0
  );

  return (
    <Stack space="space.200">
      <Stack space="space.100">
        <Label labelFor="">Step 5 — Visible Columns per Object Type</Label>
        <Text size="small" color="color.text.subtlest">
          Toggle which attributes portal users can see. Built-in fields (Name, Key, Created, Updated) are always visible.
          Click an object type header to expand it.
        </Text>
      </Stack>

      {loadingAttrs && (
        <Text size="small" color="color.text.subtlest">Loading attributes…</Text>
      )}

      {attrError && (
        <Box xcss={errorBannerStyle}>
          <Text color="color.text.danger" size="small">✕ {attrError}</Text>
        </Box>
      )}

      {!loadingAttrs && !attrError && objectTypeGroups.length === 0 && (
        <Box xcss={metaRowStyle}>
          <Text size="small" color="color.text.subtlest">No object types found for this schema.</Text>
        </Box>
      )}

      {!loadingAttrs && objectTypeGroups.length > 0 && (
        <Stack space="space.150">
          {/* Summary bar */}
          <Box xcss={metaRowStyle}>
            <Inline spread="space-between" alignBlock="center">
              <Inline space="space.200" alignBlock="center">
                <Text size="small" color="color.text.subtlest">
                  {totalTypes} object type{totalTypes !== 1 ? "s" : ""} · {totalAttrs} attribute{totalAttrs !== 1 ? "s" : ""}
                </Text>
                {totalHidden > 0 && (
                  <Badge appearance="removed">{totalHidden} hidden</Badge>
                )}
                {totalHidden === 0 && (
                  <Badge appearance="added">All visible</Badge>
                )}
              </Inline>
              <Button
                appearance="subtle"
                spacing="compact"
                onClick={() => setExpandAll((v) => !v)}
              >
                {expandAll ? "Collapse all" : "Expand all"}
              </Button>
            </Inline>
          </Box>

          {/* Global search */}
          <Textfield
            id="global-attr-search"
            placeholder={`Search object types or attributes…`}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />

          {filteredGroups.length === 0 && globalFilter && (
            <Box xcss={metaRowStyle}>
              <Text size="small" color="color.text.subtlest">
                No object types or attributes match "{globalFilter}"
              </Text>
            </Box>
          )}

          {filteredGroups.map((group) => (
            <ObjectTypeColumnsControlled
              key={group.objectTypeId}
              objectType={group}
              hiddenIds={hiddenByObjectType[group.objectTypeId] ?? new Set()}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
              forceExpanded={expandAll}
              globalFilter={globalFilter}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
};

export default ColumnVisibilitySection;
