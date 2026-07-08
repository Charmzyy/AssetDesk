

import React, { useState, useEffect, useCallback, useMemo } from "react";
import ForgeReconciler, {
  Box,
  Stack,
  Inline,
  Text,
  Heading,
  Lozenge,
  Button,
  Select,
  Label,
  Toggle,
  Badge,
  Textfield,
  DynamicTable,
  SectionMessage,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
  ModalTransition,
  DatePicker,
  Tabs,
  Tab,
  TabList,
  TabPanel,
  xcss,
} from "@forge/react";
import { invoke } from "@forge/bridge";

// ─── Styles ──────────────────────────────────────────────────────────────────

const pageStyle = xcss({ padding: "space.400", maxWidth: "860px" });

const headerStyle = xcss({
  borderBottomWidth: "border.width",
  borderBottomStyle: "solid",
  borderBottomColor: "color.border",
  paddingBottom: "space.300",
  marginBottom: "space.400",
});

const cardStyle = xcss({
  backgroundColor: "color.background.input",
  borderRadius: "border.radius.200",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  padding: "space.400",
});

const savedBannerStyle = xcss({
  backgroundColor: "color.background.success",
  borderRadius: "border.radius.100",
  padding: "space.150",
  paddingInline: "space.200",
});

const errorBannerStyle = xcss({
  backgroundColor: "color.background.danger",
  borderRadius: "border.radius.100",
  padding: "space.150",
  paddingInline: "space.200",
});

const warningBannerStyle = xcss({
  backgroundColor: "color.background.warning",
  borderRadius: "border.radius.100",
  padding: "space.150",
  paddingInline: "space.200",
});

const metaRowStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  padding: "space.200",
});

const sectionLabelStyle = xcss({
  color: "color.text.subtlest",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
});

const dividerStyle = xcss({
  borderTopWidth: "border.width",
  borderTopStyle: "solid",
  borderTopColor: "color.border",
  paddingTop: "space.300",
});

const objectTypeCardStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  padding: "space.200",
});

const objectTypeCardAccentStyle = xcss({
  backgroundColor: "color.background.selected",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border.selected",
  padding: "space.200",
});

const userResultStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  padding: "space.150",
  paddingInline: "space.200",
});

const selectedUserStyle = xcss({
  backgroundColor: "color.background.selected",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border.selected",
  padding: "space.150",
  paddingInline: "space.200",
});

const assetKeyStyle = xcss({
  backgroundColor: "color.background.brand.subtlest",
  borderRadius: "border.radius.100",
  padding: "space.050",
  paddingInline: "space.100",
});

const cellStyle = xcss({
  wordBreak: "break-word",
  minWidth: "80px",
  whiteSpace: "normal",
});

const readonlyFieldStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  padding: "space.150",
});

const fieldRowStyle = xcss({
  paddingBottom: "space.200",
  borderBottomWidth: "border.width",
  borderBottomStyle: "solid",
  borderBottomColor: "color.border",
});

const modalLabelStyle = xcss({
  color: "color.text.subtlest",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
});

const errorInlineStyle = xcss({
  backgroundColor: "color.background.danger",
  borderRadius: "border.radius.100",
  padding: "space.100",
  paddingInline: "space.150",
});

const tableWrapStyle = xcss({ paddingTop: "space.200" });

const aqlRowCardStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  padding: "space.200",
});

const aqlRowValidStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border.success",
  padding: "space.200",
});

const aqlRowErrorStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border.danger",
  padding: "space.200",
});

const aqlPreviewStyle = xcss({
  backgroundColor: "color.background.input",
  borderRadius: "border.radius.100",
  padding: "space.150",
  paddingInline: "space.200",
});

const aqlHintStyle = xcss({
  backgroundColor: "color.background.brand.subtlest",
  borderRadius: "border.radius.100",
  padding: "space.150",
  paddingInline: "space.200",
});

// ─── New: search box style for attribute filter ───────────────────────────────

const searchBoxStyle = xcss({
  backgroundColor: "color.background.input",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  padding: "space.150",
  paddingInline: "space.200",
});

const attrGridStyle = xcss({
  display: "grid",
  gap: "space.100",
});

const paginationBarStyle = xcss({
  paddingTop: "space.200",
  borderTopWidth: "border.width",
  borderTopStyle: "solid",
  borderTopColor: "color.border",
  marginTop: "space.200",
});

// ─── Constants ───────────────────────────────────────────────────────────────

const OPERATOR_OPTIONS = [
  { label: "= (equals)", value: "=" },
  { label: "like (contains)", value: "like" },
  { label: "!= (not equals)", value: "!=" },
  { label: "in (one of)", value: "in" },
];

const USER_FIELD_OPTIONS = [
  { label: "Account ID", value: "accountId", hint: "Atlassian account ID (most reliable)" },
  { label: "Display Name", value: "displayName", hint: "Full name shown in Jira" },
  { label: "Email Address", value: "email", hint: "User's email address" },
  { label: "currentUser() — licensed users only", value: "currentUser", hint: "Built-in AQL function; does not work for portal customers" },
];

// Direction is relative to the object this RULE is trying to match (the
// child/candidate asset) — NOT relative to how Jira's object detail page
// labels the link. E.g. if a "Laptop" has an outbound "Reference" attribute
// pointing at a "Person" it belongs to, the rule that grants ownership of
// the Laptop via the Person's own ownership attribute uses "outbound" here,
// even though the Person's detail page shows that same link as "Inbound
// references". See buildAqlFromRow in shared.js for how this maps to
// inboundReferences()/outboundReferences() AQL functions.
const REFERENCE_DIRECTION_OPTIONS = [
  { label: "Outbound — this asset links out to the match", value: "outbound" },
  { label: "Inbound — the match links out to this asset", value: "inbound" },
];

const ATTRS_PER_PAGE = 8; // attributes shown per object-type page

// ─── Helpers ─────────────────────────────────────────────────────────────────

const buildAqlPreview = (row, schemaId) => {
  if (!row.attribute || !row.operator || !row.userField) return null;
  const schema = schemaId ? `objectSchemaId = ${schemaId} AND ` : "objectSchemaId = ? AND ";
  if (row.userField === "currentUser") {
    return `${schema}${row.attribute} ${row.operator} currentUser()`;
  }
  const fieldLabel = USER_FIELD_OPTIONS.find((o) => o.value === row.userField)?.label || row.userField;
  return `${schema}${row.attribute} ${row.operator} "{${fieldLabel}}"`;
};

// ─── AqlRowEditor ─────────────────────────────────────────────────────────────
// Compact single-row layout: [#] [Attribute] [Operator] [Match against] [✓] [×]
// Validation result and AQL preview appear below the row, inline and minimal.

const AqlRowEditor = ({ row, index, schemaId, onChange, onRemove, totalRows }) => {
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  const isComplete = row.attribute && row.operator && row.userField;

  const handleChange = (field, value) => {
    setValidationResult(null);
    onChange(index, { ...row, [field]: value });
  };

  const handleValidate = async () => {
    if (!isComplete || !schemaId) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await invoke("validateAql", { row, schemaId });
      setValidationResult(result);
    } catch (err) {
      setValidationResult({ error: err?.message || "Validation failed" });
    } finally {
      setValidating(false);
    }
  };

  // Border color reflects validation state
  const rowXcss = validationResult
    ? validationResult.error ? aqlRowErrorStyle : aqlRowValidStyle
    : aqlRowCardStyle;

  return (
    <Box xcss={rowXcss}>
      <Stack space="space.100">

        {/* ── Compact inline rule row ─────────────────────────────────────── */}
        <Inline space="space.100" alignBlock="center">
          {/* Rule number badge */}
          <Box xcss={sectionLabelStyle}>
            <Text size="small">{index + 1}</Text>
          </Box>

          {/* Attribute path — widest, takes most space */}
          <Box xcss={xcss({ flexGrow: "2", minWidth: "120px" })}>
            <Textfield
              id={`aql-attr-${index}`}
              placeholder="Attribute path, e.g. Owner"
              value={row.attribute}
              onChange={(e) => handleChange("attribute", e.target.value)}
            />
          </Box>

          {/* Operator — compact */}
          <Box xcss={xcss({ flexGrow: "1", minWidth: "90px" })}>
            <Select
              inputId={`aql-op-${index}`}
              options={OPERATOR_OPTIONS}
              value={OPERATOR_OPTIONS.find((o) => o.value === row.operator) || null}
              onChange={(opt) => handleChange("operator", opt?.value || "")}
              placeholder="Op"
            />
          </Box>

          {/* Match against user field */}
          <Box xcss={xcss({ flexGrow: "1", minWidth: "110px" })}>
            <Select
              inputId={`aql-field-${index}`}
              options={USER_FIELD_OPTIONS}
              value={USER_FIELD_OPTIONS.find((o) => o.value === row.userField) || null}
              onChange={(opt) => handleChange("userField", opt?.value || "")}
              placeholder="Match against"
            />
          </Box>

          {/* Validate */}
          <Button
            appearance="subtle"
            spacing="compact"
            isDisabled={!isComplete || !schemaId || validating}
            isLoading={validating}
            onClick={handleValidate}
          >
            {validating ? "…" : "Test"}
          </Button>

          {/* Remove */}
          <Button
            appearance="subtle"
            spacing="compact"
            isDisabled={totalRows === 1}
            onClick={() => onRemove(index)}
          >
            ✕
          </Button>
        </Inline>

        {/* ── Reference traversal — attribute lives on a related object,
             not this one (e.g. "own the child assets referencing my
             asset") ─────────────────────────────────────────────────── */}
        <Inline space="space.150" alignBlock="center">
          <Box xcss={xcss({ width: "16px" })} />
          <Toggle
            id={`aql-viaref-${index}`}
            isChecked={Boolean(row.viaReference)}
            onChange={() => handleChange("viaReference", !row.viaReference)}
          />
          <Text size="small" color="color.text.subtlest">
            Match via a reference on another object
          </Text>
          {row.viaReference && (
            <Box xcss={xcss({ minWidth: "260px" })}>
              <Select
                inputId={`aql-refdir-${index}`}
                options={REFERENCE_DIRECTION_OPTIONS}
                value={REFERENCE_DIRECTION_OPTIONS.find((o) => o.value === (row.referenceDirection || "outbound"))}
                onChange={(opt) => handleChange("referenceDirection", opt?.value || "outbound")}
              />
            </Box>
          )}
        </Inline>

        {/* ── Inline feedback — only shown after validate ─────────────────── */}
        {validationResult && !validationResult.error && (
          <Inline space="space.100" alignBlock="center">
            {validationResult.warning ? (
              <Text size="small" color="color.text.warning">
                ⚠ 0 results — valid syntax but no assets matched your account
              </Text>
            ) : (
              <Text size="small" color="color.text.success">
                ✓ {validationResult.count} object{validationResult.count !== 1 ? "s" : ""} matched
              </Text>
            )}
            {validationResult.aql && (
              <Text size="small" color="color.text.subtlest">· {validationResult.aql}</Text>
            )}
          </Inline>
        )}

        {validationResult?.error && (
          <Text size="small" color="color.text.danger">
            ✕ {validationResult.error}
          </Text>
        )}

      </Stack>
    </Box>
  );
};

// ─── AqlRulesSection ─────────────────────────────────────────────────────────

const EMPTY_ROW = () => ({ attribute: "", operator: "=", userField: "accountId", viaReference: false, referenceDirection: "outbound" });

const AqlRulesSection = ({ schemaId, aqlRows, onChange }) => {
  const rows = aqlRows && aqlRows.length > 0 ? aqlRows : [EMPTY_ROW()];

  const handleRowChange = useCallback((index, updated) => {
    const next = [...rows];
    next[index] = updated;
    onChange(next);
  }, [rows, onChange]);

  const handleRemove = useCallback((index) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, i) => i !== index));
  }, [rows, onChange]);

  const handleAdd = useCallback(() => {
    onChange([...rows, EMPTY_ROW()]);
  }, [rows, onChange]);

  return (
    <Stack space="space.200">

      {/* Section header — single line description */}
      <Inline spread="space-between" alignBlock="center">
        <Stack space="space.050">
          <Label labelFor="">Step 3 — Asset Query Rules</Label>
          <Text size="small" color="color.text.subtlest">
            Each rule runs in parallel. Results are merged. Schema filter is added automatically.
          </Text>
        </Stack>
        <Button appearance="subtle" spacing="compact" onClick={handleAdd}>
          + Add rule
        </Button>
      </Inline>

      {/* Column headers aligned with row inputs */}
      <Box xcss={xcss({ paddingInline: "space.200" })}>
        <Inline space="space.100" alignBlock="center">
          <Box xcss={xcss({ width: "16px" })} />
          <Box xcss={xcss({ flexGrow: "2", minWidth: "120px" })}>
            <Text size="small" color="color.text.subtlest" weight="medium">Attribute path</Text>
          </Box>
          <Box xcss={xcss({ flexGrow: "1", minWidth: "90px" })}>
            <Text size="small" color="color.text.subtlest" weight="medium">Operator</Text>
          </Box>
          <Box xcss={xcss({ flexGrow: "1", minWidth: "110px" })}>
            <Text size="small" color="color.text.subtlest" weight="medium">Match against</Text>
          </Box>
          <Box xcss={xcss({ width: "48px" })} />
          <Box xcss={xcss({ width: "32px" })} />
        </Inline>
      </Box>

      {/* Rule rows */}
      <Stack space="space.100">
        {rows.map((row, i) => (
          <AqlRowEditor
            key={i}
            index={i}
            row={row}
            schemaId={schemaId}
            onChange={handleRowChange}
            onRemove={handleRemove}
            totalRows={rows.length}
          />
        ))}
      </Stack>

    </Stack>
  );
};


const ObjectTypeColumns = ({ objectType, hiddenIds, onToggle, onToggleAll }) => {
  const attrs = objectType.attributes || [];
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  const visibleCount = attrs.filter((a) => !hiddenIds.has(a.attributeId)).length;
  const allVisible = visibleCount === attrs.length;
  const noneVisible = visibleCount === 0;

  // Reset page when filter changes
  const handleFilterChange = (e) => {
    setFilter(e.target.value);
    setPage(0);
  };

  const filteredAttrs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return attrs;
    return attrs.filter((a) => a.attributeName?.toLowerCase().includes(q));
  }, [attrs, filter]);

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

  const cardXcss = expanded ? objectTypeCardAccentStyle : objectTypeCardStyle;

  return (
    <Box xcss={cardXcss}>
      <Stack space="space.150">
        {/* ── Header row — always visible ────────────────────────────────── */}
        <Inline spread="space-between" alignBlock="center">
          <Inline space="space.150" alignBlock="center">
            <Button
              appearance="subtle"
              spacing="compact"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? "▾" : "▸"}
            </Button>
            <Text weight="medium">{objectType.objectTypeName}</Text>
            <Badge appearance={visibleCount > 0 ? "primary" : "removed"}>
              {visibleCount}
            </Badge>
            <Text size="small" color="color.text.subtlest">
              / {attrs.length} visible
            </Text>
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

        {/* ── Expanded attribute list ─────────────────────────────────────── */}
        {expanded && (
          <Stack space="space.150">
            {/* Search filter */}
            {attrs.length > ATTRS_PER_PAGE && (
              <Textfield
                id={`filter-${objectType.objectTypeId}`}
                placeholder={`Search ${attrs.length} attributes…`}
                value={filter}
                onChange={handleFilterChange}
              />
            )}

            {/* Attribute toggles */}
            {filteredAttrs.length === 0 && (
              <Text size="small" color="color.text.subtlest">No attributes match "{filter}"</Text>
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

            {/* Pagination controls */}
            {totalPages > 1 && (
              <Box xcss={paginationBarStyle}>
                <Inline spread="space-between" alignBlock="center">
                  <Text size="small" color="color.text.subtlest">
                    Page {page + 1} of {totalPages} ({filteredAttrs.length} attribute{filteredAttrs.length !== 1 ? "s" : ""})
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
// Wraps all ObjectTypeColumns with a global search + "expand all / collapse all"

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

// ─── ObjectTypeColumnsControlled ──────────────────────────────────────────────
// Version of ObjectTypeColumns that can be controlled by forceExpanded prop
// and inherits an active global search filter to pre-filter attributes.

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

// ─── AttributeField ──────────────────────────────────────────────────────────

const AttributeField = ({ col, value, onChange, isDisabled }) => {
  if (col.attributeType === "status") {
    const statusOpts = col.statusOptions || [];
    if (statusOpts.length > 0) {
      const allOptions = [{ label: "— None —", value: "" }, ...statusOpts];
      const selected = allOptions.find((o) => o.value === value) ||
        { label: value || "— None —", value: value || "" };
      return (
        <Select
          inputId={`field-${col.attributeId}`}
          options={allOptions}
          value={selected}
          onChange={(opt) => onChange(opt?.value ?? "")}
          isDisabled={isDisabled}
          placeholder="Select a status…"
        />
      );
    }
    return (
      <Box xcss={readonlyFieldStyle}>
        <Inline space="space.100" alignBlock="center">
          <Text color="color.text.subtlest">{value || "—"}</Text>
          <Lozenge appearance="default">Status ref</Lozenge>
        </Inline>
      </Box>
    );
  }

  if (col.attributeType === "object") {
    return (
      <Box xcss={readonlyFieldStyle}>
        <Text color="color.text.subtlest">{value || "—"}</Text>
      </Box>
    );
  }

  if (col.attributeType === "select" && col.options?.length > 0) {
    const options = col.options.map((o) => ({ label: o, value: o }));
    const allOptions = [{ label: "— None —", value: "" }, ...options];
    const selected = allOptions.find((o) => o.value === value) || { label: "— None —", value: "" };
    return (
      <Select
        inputId={`field-${col.attributeId}`}
        options={allOptions}
        value={selected}
        onChange={(opt) => onChange(opt?.value ?? "")}
        isDisabled={isDisabled}
        placeholder="Select an option…"
      />
    );
  }

  if (col.attributeType === "date") {
    return (
      <DatePicker
        id={`field-${col.attributeId}`}
        value={value || ""}
        onChange={(date) => onChange(date || "")}
        isDisabled={isDisabled}
        placeholder="YYYY-MM-DD"
      />
    );
  }

  return (
    <Textfield
      id={`field-${col.attributeId}`}
      name={col.attributeId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      isDisabled={isDisabled}
    />
  );
};

// ─── EditAssetModal ───────────────────────────────────────────────────────────

const EditAssetModal = ({ asset, columns, loading, loadError, onClose, onSaved }) => {
  const [formValues, setFormValues] = useState(() => {
    const init = {};
    columns.forEach((col) => {
      if (col.attributeType === "date" || col.attributeType === "status") {
        init[col.attributeId] = asset.rawValues?.[col.attributeId] ?? "";
      } else {
        init[col.attributeId] = asset.visibleValues?.[col.attributeId] ?? "";
      }
    });
    return init;
  });

  // Re-sync form when columns load (after async getAssetEditFields resolves)
  useEffect(() => {
    if (columns.length === 0) return;
    setFormValues((prev) => {
      const next = { ...prev };
      columns.forEach((col) => {
        if (col.attributeId in next) return; // already set
        const useRaw = col.attributeType === "date" || col.attributeType === "status";
        next[col.attributeId] = useRaw
          ? (asset.rawValues?.[col.attributeId] ?? "")
          : (asset.visibleValues?.[col.attributeId] ?? "");
      });
      return next;
    });
  }, [columns]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedFields, setSavedFields] = useState(new Set());

  const editableColumns = useMemo(
    () => columns.filter((col) => {
      if (col.isEditable === false) return false;
      if (col.attributeType === "object") return false;
      if (col.attributeType === "status") return (col.statusOptions?.length ?? 0) > 0;
      return true;
    }),
    [columns]
  );

  const dirtyFields = useMemo(() => {
    const dirty = new Set();
    columns.forEach((col) => {
      if (col.attributeType === "object") return;
      const useRaw = col.attributeType === "date" || col.attributeType === "status";
      const original = useRaw
        ? (asset.rawValues?.[col.attributeId] ?? "")
        : (asset.visibleValues?.[col.attributeId] ?? "");
      if ((formValues[col.attributeId] ?? "") !== original) dirty.add(col.attributeId);
    });
    return dirty;
  }, [formValues, columns, asset]);

  const handleFieldChange = useCallback((attributeId, newValue) => {
    setFormValues((prev) => ({ ...prev, [attributeId]: newValue }));
    setSaveError(null);
  }, []);

  const handleSaveAll = async () => {
    const changedEditable = editableColumns.filter((col) => dirtyFields.has(col.attributeId));
    if (changedEditable.length === 0) { onClose(); return; }

    setSaving(true);
    setSaveError(null);

    try {
      const updates = {};
      const rawUpdates = {};
      for (const col of changedEditable) {
        await invoke("updateAssetAttribute", {
          objectId: asset.id,
          objectTypeId: asset.objectTypeId,
          objectTypeAttributeId: col.attributeId,
          attributeType: col.attributeType,
          value: formValues[col.attributeId],
        });
        const rawId = formValues[col.attributeId];
        if (col.attributeType === "status") {
          const matched = (col.statusOptions || []).find((o) => o.value === rawId);
          updates[col.attributeId] = matched ? matched.label : rawId;
        } else {
          updates[col.attributeId] = rawId;
        }
        rawUpdates[col.attributeId] = rawId;
        setSavedFields((prev) => new Set([...prev, col.attributeId]));
      }
      onSaved(asset.id, updates, rawUpdates);
      onClose();
    } catch (err) {
      setSaveError(err?.message || "One or more fields failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const dirtyEditableCount = editableColumns.filter((c) => dirtyFields.has(c.attributeId)).length;

  return (
    <Modal onClose={onClose} width="medium">
      <ModalHeader>
        <ModalTitle>Edit Asset</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.300">

          {/* Asset identity header */}
          <Box xcss={readonlyFieldStyle}>
            <Inline spread="space-between" alignBlock="center">
              <Stack space="space.025">
                <Box xcss={modalLabelStyle}><Text size="small">Asset Name</Text></Box>
                <Text weight="medium">{asset.label || "—"}</Text>
              </Stack>
              <Inline space="space.100" alignBlock="center">
                <Box xcss={assetKeyStyle}>
                  <Text size="small" color="color.text.brand">{asset.objectKey || "—"}</Text>
                </Box>
                <Lozenge appearance="inprogress">{asset.objectTypeName || "Asset"}</Lozenge>
              </Inline>
            </Inline>
          </Box>

          {/* Loading state — waiting for getAssetEditFields */}
          {loading && (
            <Box xcss={metaRowStyle}>
              <Text size="small" color="color.text.subtlest">Loading all fields…</Text>
            </Box>
          )}

          {/* Load error */}
          {loadError && (
            <Box xcss={errorInlineStyle}>
              <Stack space="space.050">
                <Text size="small" color="color.text.danger" weight="medium">Could not load all fields</Text>
                <Text size="small" color="color.text.danger">{loadError}</Text>
                <Text size="small" color="color.text.subtlest">Only visible columns are shown. You can still edit those.</Text>
              </Stack>
            </Box>
          )}

          {/* No fields at all */}
          {!loading && columns.length === 0 && !loadError && (
            <SectionMessage appearance="info">
              <Text>No configurable fields for this asset type.</Text>
            </SectionMessage>
          )}

          {/* Field list — shown once columns are loaded */}
          {columns.map((col) => {
            const isEditable =
              col.isEditable !== false &&
              col.attributeType !== "object" &&
              (col.attributeType !== "status" || (col.statusOptions?.length ?? 0) > 0);

            const isSaved = savedFields.has(col.attributeId);
            const isDirty = dirtyFields.has(col.attributeId);
            // hiddenInTable: not in original visibleAttributes — came from getAssetEditFields
            const hiddenInTable = col.hiddenInTable === true;

            return (
              <Box key={col.attributeId} xcss={fieldRowStyle}>
                <Stack space="space.100">
                  <Inline spread="space-between" alignBlock="center">
                    <Label labelFor={`field-${col.attributeId}`}>{col.attributeName}</Label>
                    <Inline space="space.075" alignBlock="center">
                      {hiddenInTable && (
                        <Lozenge appearance="default">Hidden in table</Lozenge>
                      )}
                      {col.attributeType === "object" && (
                        <Lozenge appearance="default">Object ref</Lozenge>
                      )}
                      {col.attributeType === "status" && !(col.statusOptions?.length > 0) && (
                        <Lozenge appearance="default">Status ref</Lozenge>
                      )}
                      {!isEditable && col.attributeType !== "object" && col.attributeType !== "status" && (
                        <Lozenge appearance="default">Read only</Lozenge>
                      )}
                      {isEditable && isDirty && !isSaved && (
                        <Lozenge appearance="moved">Edited</Lozenge>
                      )}
                      {isSaved && <Lozenge appearance="success">Saved</Lozenge>}
                    </Inline>
                  </Inline>
                  <AttributeField
                    col={col}
                    value={formValues[col.attributeId] ?? ""}
                    onChange={(newValue) => handleFieldChange(col.attributeId, newValue)}
                    isDisabled={saving || !isEditable || loading}
                  />
                </Stack>
              </Box>
            );
          })}

          {saveError && (
            <Box xcss={errorInlineStyle}>
              <Text color="color.text.danger" size="small">✕ {saveError}</Text>
            </Box>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Inline space="space.150" alignBlock="center">
          {dirtyEditableCount > 0 && (
            <Text size="small" color="color.text.subtlest">
              {dirtyEditableCount} field{dirtyEditableCount !== 1 ? "s" : ""} changed
            </Text>
          )}
          <Button appearance="subtle" onClick={onClose} isDisabled={saving}>Cancel</Button>
          <Button
            appearance="primary"
            onClick={handleSaveAll}
            isDisabled={saving || loading || dirtyEditableCount === 0}
            isLoading={saving}
          >
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </Inline>
      </ModalFooter>
    </Modal>
  );
};

// ─── UserAssetTable ───────────────────────────────────────────────────────────
// Groups assets by object type, shows tabs when multiple types exist.
// Each type table caps at MAX_TABLE_COLS visible columns to prevent overflow.
// Extra attributes still appear in full in the Edit modal.

const MAX_TABLE_COLS = 5; // Name + Key always shown; this caps attribute columns

const AssetTypeTable = ({ assets, allColumns, onEditClick }) => {
  // Pick the first MAX_TABLE_COLS columns that have at least one filled value
  const filledCols = useMemo(() => {
    const candidates = allColumns.filter((col) =>
      assets.some((a) => a.visibleValues?.[col.attributeId])
    );
    return candidates.slice(0, MAX_TABLE_COLS);
  }, [assets, allColumns]);

  const hiddenCount = allColumns.length - filledCols.length;

  const attrWidth = filledCols.length > 0
    ? Math.max(10, Math.floor(60 / filledCols.length))
    : 0;

  const head = {
    cells: [
      { key: "label",     content: "Name", isSortable: true, width: 22 },
      { key: "objectKey", content: "Key",  isSortable: true, width: 10 },
      ...filledCols.map((col) => ({
        key: `col-${col.attributeId}`,
        content: col.attributeName,
        isSortable: true,
        width: attrWidth,
      })),
      { key: "actions", content: "", width: 8 },
    ],
  };

  const rows = assets.map((asset, i) => ({
    key: `row-${asset.id || i}`,
    cells: [
      {
        key: `label-${i}`,
        content: <Text weight="medium">{asset.label || "—"}</Text>,
      },
      {
        key: `okey-${i}`,
        content: (
          <Box xcss={assetKeyStyle}>
            <Text size="small" color="color.text.brand">{asset.objectKey || "—"}</Text>
          </Box>
        ),
      },
      ...filledCols.map((col) => ({
        key: `col-${col.attributeId}-${i}`,
        content: (
          <Text size="small">
            {asset.visibleValues?.[col.attributeId] || "—"}
          </Text>
        ),
      })),
      {
        key: `edit-${i}`,
        content: (
          <Button
            appearance="subtle"
            spacing="compact"
            onClick={() => onEditClick(asset, allColumns)}
          >
            Edit
          </Button>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.150">
      {hiddenCount > 0 && (
        <Box xcss={metaRowStyle}>
          <Text size="small" color="color.text.subtlest">
            Showing {filledCols.length} of {allColumns.length} attributes.{" "}
            {hiddenCount} more visible in Edit modal.
          </Text>
        </Box>
      )}
      <Box xcss={tableWrapStyle}>
        <DynamicTable
          head={head}
          rows={rows}
          rowsPerPage={10}
          defaultPage={1}
          isFixedSize
          caption={`${assets.length} asset${assets.length !== 1 ? "s" : ""}`}
        />
      </Box>
    </Stack>
  );
};

const UserAssetTable = ({ assets, visibleAttributes, onEditClick }) => {
  if (assets.length === 0) {
    return (
      <SectionMessage appearance="info">
        <Text>No assets found for this user.</Text>
      </SectionMessage>
    );
  }

  // Group by object type
  const typeGroups = useMemo(() => {
    const map = {};
    assets.forEach((a) => {
      const key = a.objectTypeName || "Other";
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });
    return map;
  }, [assets]);

  const typeNames = Object.keys(typeGroups);

  const getColsForType = (typeAssets) => {
    const typeId = String(typeAssets[0]?.objectTypeId || "");
    return visibleAttributes.filter(
      (col) => !col.objectTypeId || String(col.objectTypeId) === typeId
    );
  };

  if (typeNames.length === 1) {
    const cols = getColsForType(typeGroups[typeNames[0]]);
    return (
      <AssetTypeTable
        assets={typeGroups[typeNames[0]]}
        allColumns={cols}
        onEditClick={onEditClick}
      />
    );
  }

  return (
    <Tabs id="admin-asset-tabs">
      <TabList>
        <Tab>All ({assets.length})</Tab>
        {typeNames.map((name) => (
          <Tab key={name}>{name} ({typeGroups[name].length})</Tab>
        ))}
      </TabList>

      {/* All tab — name, key, type, edit only (too mixed for attribute cols) */}
      <TabPanel>
        <Box xcss={tableWrapStyle}>
          <DynamicTable
            head={{
              cells: [
                { key: "label",     content: "Name", isSortable: true, width: 30 },
                { key: "objectKey", content: "Key",  isSortable: true, width: 12 },
                { key: "type",      content: "Type", isSortable: true, width: 20 },
                { key: "actions",   content: "",     width: 8 },
              ],
            }}
            rows={assets.map((asset, i) => ({
              key: `all-row-${asset.id || i}`,
              cells: [
                { key: `label-${i}`, content: <Text weight="medium">{asset.label || "—"}</Text> },
                {
                  key: `okey-${i}`,
                  content: (
                    <Box xcss={assetKeyStyle}>
                      <Text size="small" color="color.text.brand">{asset.objectKey || "—"}</Text>
                    </Box>
                  ),
                },
                {
                  key: `type-${i}`,
                  content: <Lozenge appearance="inprogress">{asset.objectTypeName || "—"}</Lozenge>,
                },
                {
                  key: `edit-${i}`,
                  content: (
                    <Button
                      appearance="subtle"
                      spacing="compact"
                      onClick={() => onEditClick(asset, getColsForType([asset]))}
                    >
                      Edit
                    </Button>
                  ),
                },
              ],
            }))}
            rowsPerPage={5}
            defaultPage={1}
            isFixedSize
            caption={`${assets.length} asset${assets.length !== 1 ? "s" : ""}`}
          />
        </Box>
      </TabPanel>

      {/* Per-type tabs with capped columns */}
      {typeNames.map((name) => {
        const typeAssets = typeGroups[name];
        const cols = getColsForType(typeAssets);
        return (
          <TabPanel key={name}>
            <AssetTypeTable
              assets={typeAssets}
              allColumns={cols}
              onEditClick={onEditClick}
            />
          </TabPanel>
        );
      })}
    </Tabs>
  );
};

// ─── UserBrowser ──────────────────────────────────────────────────────────────

const UserBrowser = ({ schemaId }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userAssets, setUserAssets] = useState([]);
  const [visibleAttributes, setVisibleAttributes] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetError, setAssetError] = useState(null);
  const [editingAsset, setEditingAsset] = useState(null);
  const [editColumns, setEditColumns] = useState([]);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      setHasSearched(true);
      try {
        const result = await invoke("searchAssetUsers", { schemaId, query: searchQuery.trim() });
        if (result?.error) {
          setSearchError(result.error);
          setSearchResults([]);
        } else {
          setSearchResults(result?.values || []);
        }
      } catch (err) {
        setSearchError(err?.message || "Search failed");
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, schemaId]);

  const handleSelectUser = useCallback(async (userAsset) => {
    setSelectedUser(userAsset);
    setUserAssets([]);
    setVisibleAttributes([]);
    setAssetError(null);
    setLoadingAssets(true);

    let displayName = userAsset.label || "";
    let accountId = "";
    (userAsset.attributes || []).forEach((attr) => {
      const name = attr.objectTypeAttribute?.name || attr.name || "";
      const val = attr.objectAttributeValues?.[0]?.value || "";
      if (/account.?id/i.test(name)) accountId = val;
    });

    try {
      const result = await invoke("getAssetsForUser", { schemaId, displayName, accountId });
      if (result?.error) {
        setAssetError(result.error);
      } else {
        setUserAssets(result?.values || []);
        setVisibleAttributes(result?.visibleAttributes || []);
      }
    } catch (err) {
      setAssetError(err?.message || "Failed to load assets");
    } finally {
      setLoadingAssets(false);
    }
  }, [schemaId]);

  const handleEditClick = useCallback((asset, columns) => {
    setEditColumns(columns);
    setEditingAsset(asset);
  }, []);

  const handleModalClose = useCallback(() => {
    setEditingAsset(null);
    setEditColumns([]);
  }, []);

  const handleAssetSaved = useCallback((assetId, updates, rawUpdates) => {
    setUserAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        return {
          ...a,
          visibleValues: { ...a.visibleValues, ...updates },
          rawValues: { ...(a.rawValues || {}), ...(rawUpdates || {}) },
        };
      })
    );
  }, []);

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Label labelFor="user-search">Search users by name</Label>
        <Text size="small" color="color.text.subtlest">
          Searches the Users object type in your Assets schema. Type at least 2 characters.
        </Text>
        <Textfield
          id="user-search"
          placeholder="e.g. Victor, Jane…"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSelectedUser(null);
            setUserAssets([]);
          }}
        />
      </Stack>

      {searching && <Text size="small" color="color.text.subtlest">Searching…</Text>}

      {searchError && (
        <Box xcss={errorBannerStyle}>
          <Text color="color.text.danger" size="small">✕ {searchError}</Text>
        </Box>
      )}

      {!searching && hasSearched && searchResults.length === 0 && !searchError && (
        <Box xcss={metaRowStyle}>
          <Text size="small" color="color.text.subtlest">No users found matching "{searchQuery}"</Text>
        </Box>
      )}

      {searchResults.length > 0 && (
        <Stack space="space.100">
          <Box xcss={sectionLabelStyle}>
            <Text size="small">{searchResults.length} user{searchResults.length !== 1 ? "s" : ""} found</Text>
          </Box>
          {searchResults.map((u) => {
            const isSelected = selectedUser?.id === u.id;
            let accountId = "";
            (u.attributes || []).forEach((attr) => {
              const name = attr.objectTypeAttribute?.name || attr.name || "";
              const val = attr.objectAttributeValues?.[0]?.value || "";
              if (/account.?id/i.test(name)) accountId = val;
            });
            return (
              <Box key={u.id} xcss={isSelected ? selectedUserStyle : userResultStyle}>
                <Inline spread="space-between" alignBlock="center">
                  <Stack space="space.025">
                    <Text weight="medium">{u.label || "—"}</Text>
                    {accountId && <Text size="small" color="color.text.subtlest">ID: {accountId}</Text>}
                    <Text size="small" color="color.text.subtlest">Key: {u.objectKey || "—"}</Text>
                  </Stack>
                  <Inline space="space.100" alignBlock="center">
                    {isSelected && <Lozenge appearance="success">Selected</Lozenge>}
                    <Button
                      appearance={isSelected ? "subtle" : "default"}
                      spacing="compact"
                      isDisabled={loadingAssets}
                      onClick={() => handleSelectUser(u)}
                    >
                      {isSelected ? "Reload" : "View assets"}
                    </Button>
                  </Inline>
                </Inline>
              </Box>
            );
          })}
        </Stack>
      )}

      {selectedUser && (
        <Box xcss={dividerStyle}>
          <Stack space="space.200">
            <Inline spread="space-between" alignBlock="center">
              <Stack space="space.050">
                <Box xcss={sectionLabelStyle}><Text size="small">Assets for</Text></Box>
                <Inline space="space.100" alignBlock="center">
                  <Text weight="medium">{selectedUser.label}</Text>
                  {userAssets.length > 0 && (
                    <Badge appearance="primary">
                      {userAssets.length} asset{userAssets.length !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </Inline>
              </Stack>
              <Button
                appearance="subtle"
                spacing="compact"
                onClick={() => { setSelectedUser(null); setUserAssets([]); }}
              >
                Clear
              </Button>
            </Inline>

            {loadingAssets && <Text size="small" color="color.text.subtlest">Loading assets…</Text>}

            {assetError && (
              <Box xcss={errorBannerStyle}>
                <Text color="color.text.danger" size="small">✕ {assetError}</Text>
              </Box>
            )}

            {!loadingAssets && !assetError && (
              <UserAssetTable
                assets={userAssets}
                visibleAttributes={visibleAttributes}
                onEditClick={handleEditClick}
              />
            )}
          </Stack>
        </Box>
      )}

      <ModalTransition>
        {editingAsset && (
          <EditAssetModal
            asset={editingAsset}
            columns={editColumns}
            onClose={handleModalClose}
            onSaved={handleAssetSaved}
          />
        )}
      </ModalTransition>
    </Stack>
  );
};

// ─── SchemaDriftBanner ────────────────────────────────────────────────────────

const SchemaDriftBanner = ({ drift, onRecheck, onCleanup, cleaning }) => {
  if (!drift) return null;

  const {
    ghostObjectTypeIds = [], ghostAttributeIds = {}, staleFlagCount, liveObjectTypes = [],
    unverifiedObjectTypeIds = [],
  } = drift;

  // Show the banner if there's either a confirmed ghost OR a type we
  // couldn't verify this round — a type whose attribute fetch failed
  // (commonly rate-limiting, on schemas with many object types) used to
  // get silently treated as "everything on it was deleted," a false
  // positive that got worse the more object types there were. Now that
  // reconcileConfig excludes unverified types from the ghost count
  // instead of assuming the worst, a schema with only unverified types
  // and zero real ghosts would otherwise show nothing at all here — worth
  // surfacing so the admin knows to hit Re-check rather than assuming
  // everything's clean.
  if (staleFlagCount === 0 && unverifiedObjectTypeIds.length === 0) return null;

  const typeNameFor = (id) =>
    liveObjectTypes.find((t) => t.id === id)?.name || `Object type ID: ${id}`;

  return (
    <Box xcss={warningBannerStyle}>
      <Stack space="space.200">
        <Inline spread="space-between" alignBlock="center">
          <Inline space="space.100" alignBlock="center">
            <Text weight="medium" color="color.text.warning">⚠ Schema drift detected</Text>
            {staleFlagCount > 0 && <Badge appearance="added">{staleFlagCount} STALE ENTRIES</Badge>}
          </Inline>
          <Button appearance="subtle" spacing="compact" onClick={onRecheck}>
            Re-check
          </Button>
        </Inline>

        {staleFlagCount > 0 && (
          <Text size="small" color="color.text.subtlest">
            Your Assets schema has changed since this config was last saved. The following stored entries no longer match the live schema and should be cleaned up.
          </Text>
        )}

        {unverifiedObjectTypeIds.length > 0 && (
          <Text size="small" color="color.text.subtlest">
            Couldn't verify {unverifiedObjectTypeIds.length} object type{unverifiedObjectTypeIds.length !== 1 ? 's' : ''} this time
            {' '}({unverifiedObjectTypeIds.map(typeNameFor).join(', ')}) — likely a transient API error or rate limiting, not an
            actual schema change. Their stored settings were left as-is. Click Re-check to retry.
          </Text>
        )}

        {ghostObjectTypeIds.length > 0 && (
          <Stack space="space.075">
            <Text size="small" weight="medium" color="color.text.warning">
              Deleted object types ({ghostObjectTypeIds.length})
            </Text>
            {ghostObjectTypeIds.map((id) => (
              <Box key={id} xcss={metaRowStyle}>
                <Inline space="space.100" alignBlock="center">
                  <Lozenge appearance="removed">DELETED</Lozenge>
                  <Text size="small">Object type ID: {id} — no longer exists in schema</Text>
                </Inline>
              </Box>
            ))}
          </Stack>
        )}

        {Object.entries(ghostAttributeIds).map(([typeId, ghosts]) => (
          <Stack key={typeId} space="space.075">
            <Text size="small" weight="medium" color="color.text.warning">
              Deleted attributes ({ghosts.length}) in {typeNameFor(typeId)}
            </Text>
            {ghosts.map((g) => (
              <Box key={g.id} xcss={metaRowStyle}>
                <Inline space="space.100" alignBlock="center">
                  <Lozenge appearance="removed">DELETED</Lozenge>
                  <Text size="small">{g.name}</Text>
                </Inline>
              </Box>
            ))}
          </Stack>
        ))}

        <Inline spread="space-between" alignBlock="center">
          <Text size="small" color="color.text.subtlest">
            Cleanup removes ghost entries from stored config. It does not change your Assets schema.
          </Text>
          <Button
            appearance="warning"
            spacing="compact"
            onClick={onCleanup}
            isLoading={cleaning}
            isDisabled={cleaning}
          >
            Clean up stale config
          </Button>
        </Inline>
      </Stack>
    </Box>
  );
};

// ─── Config Page ─────────────────────────────────────────────────────────────

const ConfigPage = () => {
  const [config, setConfig] = useState(null);
  const [schemas, setSchemas] = useState([]);
  const [selectedSchema, setSelectedSchema] = useState(null);
  const [loadingSchemas, setLoadingSchemas] = useState(true);
  const [schemaError, setSchemaError] = useState(null);
  const [objectTypeGroups, setObjectTypeGroups] = useState([]);
  const [loadingAttrs, setLoadingAttrs] = useState(false);
  const [attrError, setAttrError] = useState(null);
  const [hiddenByObjectType, setHiddenByObjectType] = useState({});
  const [aqlRows, setAqlRows] = useState([]);
  const [editMode, setEditMode] = useState("serviceAccount");
  const [allowPortalEdit, setAllowPortalEdit] = useState(false);
  const [maxUserAssetLimit, setMaxUserAssetLimit] = useState(500);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState("config");

  // Drift / reconciliation state
  const [drift, setDrift] = useState(null);
  const [recheckingDrift, setRecheckingDrift] = useState(false);
  const [cleaningDrift, setCleaningDrift] = useState(false);

  const savedSchemaId = config?.schemaId || null;
  const isSchemaChanged =
    config !== null &&
    selectedSchema !== null &&
    String(selectedSchema.value) !== String(config.schemaId || "");

  const canSave = Boolean(selectedSchema) && (isSchemaChanged || isDirty);

  const buildHiddenSets = useCallback((savedMap = {}) =>
    Object.fromEntries(
      Object.entries(savedMap).map(([typeId, ids]) => [
        typeId,
        new Set(Array.isArray(ids) ? ids : []),
      ])
    ), []);

  const loadAttributesForSchema = useCallback(
    async (schemaId, savedHiddenMap = {}) => {
      setLoadingAttrs(true);
      setAttrError(null);
      setObjectTypeGroups([]);
      setHiddenByObjectType({});
      setIsDirty(false);

      try {
        const typesResult = await invoke("getObjectTypes", { schemaId });
        if (typesResult.error) {
          setAttrError(typesResult.error);
          return;
        }
        const objectTypes = typesResult.objectTypes || [];
        const attrResult = await invoke("getObjectTypeAttributes", { objectTypes });
        if (attrResult.error) {
          setAttrError(attrResult.error);
          return;
        }
        setObjectTypeGroups(attrResult.groups || []);
        setHiddenByObjectType(buildHiddenSets(savedHiddenMap));
      } catch (err) {
        setAttrError(err?.message || "Failed to load attributes");
      } finally {
        setLoadingAttrs(false);
      }
    },
    [buildHiddenSets]
  );

  // Initial load
  useEffect(() => {
    const init = async () => {
      try {
        const [schemasData, configData] = await Promise.all([
          invoke("getSchemas"),
          invoke("getConfig"),
        ]);

        const schemaList = Array.isArray(schemasData) ? schemasData : [];
        setSchemas(schemaList);
        setConfig(configData || {});

        const saved = configData?.schemaId
          ? schemaList.find((s) => String(s.id) === String(configData.schemaId)) || null
          : null;

        if (saved) {
          setSelectedSchema({ label: saved.name, value: String(saved.id) });
          setAqlRows(Array.isArray(configData.aqlRows) ? configData.aqlRows : []);
          setEditMode(configData.editMode === "userAccount" ? "userAccount" : "serviceAccount");
          setAllowPortalEdit(Boolean(configData.allowPortalEdit));
          setMaxUserAssetLimit(Number(configData.maxUserAssetLimit) || 500);
          await loadAttributesForSchema(saved.id, configData.hiddenByObjectType || {});
        }
      } catch (err) {
        setSchemaError(err?.message || "Failed to load schemas");
      } finally {
        setLoadingSchemas(false);
      }
    };
    init();
  }, [loadAttributesForSchema]);

  // Run drift check when config loads
  useEffect(() => {
    if (!config?.schemaId) return;
    invoke("reconcileConfig")
      .then((result) => {
        if (result && (result.staleFlagCount > 0 || (result.unverifiedObjectTypeIds || []).length > 0)) setDrift(result);
        else setDrift(null);
      })
      .catch(() => {});
  }, [config?.schemaId]);

  const handleSchemaChange = useCallback(
    async (option) => {
      // Guards against a no-op re-selection of the SAME schema (some
      // Select implementations fire onChange even when the clicked option
      // is already the current value) wiping out every object type's
      // hidden-attribute configuration. Without this check, that no-op
      // re-select reset hiddenByObjectType to {} — invisible in the UI
      // until the user hit Save, at which point saveConfig's full-replace
      // (not a merge — see saveConfig in adminResolvers.js) persisted the
      // empty map, silently erasing every previously-hidden attribute for
      // every object type. This is very likely what "config sometimes
      // loses [settings] after saving" was.
      const isSameSchema = option && selectedSchema && String(option.value) === String(selectedSchema.value);
      setSelectedSchema(option);
      if (isSameSchema) return;

      setIsDirty(true);
      setSaveStatus(null);
      if (option) {
        await loadAttributesForSchema(option.value, {});
      } else {
        setObjectTypeGroups([]);
        setHiddenByObjectType({});
      }
    },
    [loadAttributesForSchema, selectedSchema]
  );

  const handleToggle = useCallback((objectTypeId, attributeId) => {
    setHiddenByObjectType((prev) => {
      const current = new Set(prev[objectTypeId] || []);
      if (current.has(attributeId)) current.delete(attributeId);
      else current.add(attributeId);
      return { ...prev, [objectTypeId]: current };
    });
    setIsDirty(true);
    setSaveStatus(null);
  }, []);

  const handleToggleAll = useCallback((objectTypeId, attrs, makeVisible) => {
    setHiddenByObjectType((prev) => {
      const newSet = makeVisible
        ? new Set()
        : new Set(attrs.map((a) => a.attributeId));
      return { ...prev, [objectTypeId]: newSet };
    });
    setIsDirty(true);
    setSaveStatus(null);
  }, []);

  const handleSave = async () => {
    if (!selectedSchema) return;
    setSaving(true);
    setSaveStatus(null);

    const hiddenMap = Object.fromEntries(
      Object.entries(hiddenByObjectType).map(([typeId, set]) => [
        typeId,
        [...set],
      ])
    );

    const schemaOption = schemas.find((s) => String(s.id) === String(selectedSchema.value));

    try {
      const saved = await invoke("saveConfig", {
        schemaId: String(selectedSchema.value),
        schemaName: schemaOption?.name || selectedSchema.label || "",
        hiddenByObjectType: hiddenMap,
        aqlRows,
        editMode,
        allowPortalEdit,
        maxUserAssetLimit,
      });
      setConfig(saved);
      setIsDirty(false);
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const handleRecheckDrift = async () => {
    setRecheckingDrift(true);
    try {
      const result = await invoke("reconcileConfig");
      if (result && (result.staleFlagCount > 0 || (result.unverifiedObjectTypeIds || []).length > 0)) setDrift(result);
      else setDrift(null);
    } catch (_) {}
    finally { setRecheckingDrift(false); }
  };

  const handleCleanupDrift = async () => {
    if (!drift) return;
    setCleaningDrift(true);
    try {
      const result = await invoke("applyReconciliation", {
        ghostObjectTypeIds: drift.ghostObjectTypeIds,
        ghostAttributeIds: drift.ghostAttributeIds,
      });
      if (result?.success) {
        setConfig(result.config);
        setDrift(null);
        // Reload attribute list to reflect cleaned config
        if (selectedSchema) {
          await loadAttributesForSchema(selectedSchema.value, result.config?.hiddenByObjectType || {});
        }
      }
    } catch (_) {}
    finally { setCleaningDrift(false); }
  };

  const schemaOptions = schemas.map((s) => ({ label: s.name, value: String(s.id) }));

  return (
    <Box xcss={pageStyle}>
      <Stack space="space.400">
        {/* ── Page Header ── */}
        <Box xcss={headerStyle}>
          <Stack space="space.050">
            <Heading as="h2">App Configuration</Heading>
            <Text color="color.text.subtlest" size="small">
              Configure the Assets schema, asset query rules, visible columns, and browse or edit user assets.
            </Text>
          </Stack>
        </Box>

        {/* ── Tab Buttons ── */}
        <Inline space="space.150">
          <Button
            appearance={activeTab === "config" ? "primary" : "subtle"}
            onClick={() => setActiveTab("config")}
          >
            Schema &amp; Columns
          </Button>
          <Button
            appearance={activeTab === "browse" ? "primary" : "subtle"}
            isDisabled={!savedSchemaId}
            onClick={() => setActiveTab("browse")}
          >
            Browse User Assets
          </Button>
        </Inline>

        {/* ── TAB: Config ── */}
        {activeTab === "config" && (
          <Box xcss={cardStyle}>
            <Stack space="space.400">

              {/* Schema drift banner */}
              <SchemaDriftBanner
                drift={drift}
                onRecheck={handleRecheckDrift}
                onCleanup={handleCleanupDrift}
                cleaning={cleaningDrift}
              />

              {/* Currently saved schema pill */}
              {config?.schemaId && !isSchemaChanged && (
                <Box xcss={metaRowStyle}>
                  <Inline spread="space-between" alignBlock="center">
                    <Stack space="space.025">
                      <Box xcss={sectionLabelStyle}><Text size="small">Currently saved</Text></Box>
                      <Text weight="medium">{config.schemaName || `Schema ${config.schemaId}`}</Text>
                      <Inline space="space.150">
                        {config.hiddenByObjectType && (
                          <Text size="small" color="color.text.subtlest">
                            {Object.values(config.hiddenByObjectType).reduce(
                              (acc, ids) => acc + (Array.isArray(ids) ? ids.length : 0),
                              0
                            )} attributes hidden
                          </Text>
                        )}
                        {Array.isArray(config.aqlRows) && config.aqlRows.length > 0 && (
                          <Text size="small" color="color.text.subtlest">
                            {config.aqlRows.length} AQL rules configured
                          </Text>
                        )}
                        <Text size="small" color="color.text.subtlest">
                          Writes via: {config.editMode === "userAccount" ? "user account" : "service account"}
                        </Text>
                      </Inline>
                    </Stack>
                    <Lozenge appearance="success">ACTIVE</Lozenge>
                  </Inline>
                </Box>
              )}

              {/* Step 1: Schema selector */}
              <Stack space="space.150">
                <Stack space="space.075">
                  <Label labelFor="schema-select">Step 1 — Assets Schema</Label>
                  <Text size="small" color="color.text.subtlest">
                    Choose the Assets schema that contains your users' hardware or software assets.
                  </Text>
                </Stack>

                {loadingSchemas && (
                  <Text size="small" color="color.text.subtlest">Loading schemas…</Text>
                )}
                {schemaError && (
                  <Box xcss={errorBannerStyle}>
                    <Text color="color.text.danger" size="small">✕ {schemaError}</Text>
                  </Box>
                )}
                {!loadingSchemas && !schemaError && (
                  <Select
                    inputId="schema-select"
                    options={schemaOptions}
                    value={selectedSchema}
                    onChange={handleSchemaChange}
                    placeholder="Select a schema…"
                  />
                )}

                {isSchemaChanged && (
                  <Box xcss={warningBannerStyle}>
                    <Text size="small" color="color.text.warning">
                      ⚠ You've selected a different schema than the one currently saved. Saving will replace the existing configuration.
                    </Text>
                  </Box>
                )}
              </Stack>

              {/* Step 2: Object types */}
              {selectedSchema && (
                <Box xcss={dividerStyle}>
                  <Stack space="space.150">
                    <Stack space="space.075">
                      <Label labelFor="">Step 2 — Object Types</Label>
                      <Text size="small" color="color.text.subtlest">
                        These are the object types loaded from your selected schema. They are used in steps below.
                      </Text>
                    </Stack>
                    {loadingAttrs && (
                      <Text size="small" color="color.text.subtlest">Loading object types…</Text>
                    )}
                    {!loadingAttrs && objectTypeGroups.length > 0 && (
                      <Inline space="space.100" shouldWrap>
                        {objectTypeGroups.map((g) => (
                          <Lozenge key={g.objectTypeId} appearance="inprogress">
                            {g.objectTypeName}
                          </Lozenge>
                        ))}
                      </Inline>
                    )}
                  </Stack>
                </Box>
              )}

              {/* Step 3: AQL Rules */}
              {selectedSchema && (
                <Box xcss={dividerStyle}>
                  <AqlRulesSection
                    schemaId={selectedSchema?.value}
                    aqlRows={aqlRows}
                    onChange={(rows) => {
                      setAqlRows(rows);
                      setIsDirty(true);
                      setSaveStatus(null);
                    }}
                  />
                </Box>
              )}

              {/* Step 4: Edit Permissions */}
              {selectedSchema && (
                <Box xcss={dividerStyle}>
                  <Stack space="space.200">
                    <Stack space="space.075">
                      <Label labelFor="">Step 4 — Edit Permissions</Label>
                      <Text size="small" color="color.text.subtlest">
                        Control who can edit assets and which account the writes are recorded under in the Assets audit log.
                      </Text>
                    </Stack>

                    {/* Write account (audit log identity) */}
                    <Box xcss={objectTypeCardStyle}>
                      <Stack space="space.150">
                        <Text weight="medium">Write account (audit log identity)</Text>
                        <Stack space="space.100">
                          <Select
                            inputId="edit-mode-select"
                            options={[
                              { label: "Service account — writes appear as the app (recommended)", value: "serviceAccount" },
                              { label: "User account — writes appear as the individual agent", value: "userAccount" },
                            ]}
                            value={
                              editMode === "userAccount"
                                ? { label: "User account — writes appear as the individual agent", value: "userAccount" }
                                : { label: "Service account — writes appear as the app (recommended)", value: "serviceAccount" }
                            }
                            onChange={(opt) => {
                              setEditMode(opt?.value || "serviceAccount");
                              setIsDirty(true);
                              setSaveStatus(null);
                            }}
                          />
                          {editMode === "serviceAccount" && (
                            <Box xcss={aqlHintStyle}>
                              <Stack space="space.050">
                                <Text size="small" weight="medium">Service account mode</Text>
                                <Text size="small" color="color.text.subtlest">
                                  All asset edits are written via the app identity. The Assets audit log will show the app name rather than any individual user.
                                  An ownership check still runs before every write — users can only edit assets confirmed to be theirs by the AQL rules above.
                                </Text>
                              </Stack>
                            </Box>
                          )}
                          {editMode === "userAccount" && (
                            <Box xcss={aqlHintStyle}>
                              <Stack space="space.050">
                                <Text size="small" weight="medium">User account mode</Text>
                                <Text size="small" color="color.text.subtlest">
                                  Edits are written using the individual agent's own Jira account. Their name appears in the Assets audit log.
                                  This mode is not available to portal customers — they always use the service account path if editing is enabled for them.
                                </Text>
                              </Stack>
                            </Box>
                          )}
                        </Stack>
                      </Stack>
                    </Box>

                    {/* Portal customer editing toggle */}
                    <Box xcss={objectTypeCardStyle}>
                      <Stack space="space.150">
                        <Inline spread="space-between" alignBlock="center">
                          <Stack space="space.050">
                            <Text weight="medium">Allow portal customers to edit their own assets</Text>
                            <Text size="small" color="color.text.subtlest">
                              When enabled, portal customers (unlicensed JSM users) can edit assets assigned to them using the
                              same <Text size="small" weight="medium">asApp()</Text> execution context as licensed users.
                              Writes always use the service account regardless of the write account setting above.
                              An ownership check is enforced — customers can only edit assets matched by your AQL rules.
                            </Text>
                          </Stack>
                          <Toggle
                            id="allow-portal-edit-toggle"
                            isChecked={allowPortalEdit}
                            onChange={() => {
                              setAllowPortalEdit((prev) => !prev);
                              setIsDirty(true);
                              setSaveStatus(null);
                            }}
                          />
                        </Inline>
                        {allowPortalEdit && (
                          <Box xcss={savedBannerStyle}>
                            <Text size="small" color="color.text.success">
                              ✓ Portal customers can edit. Both licensed agents (service account mode) and unlicensed customers use <Text size="small" weight="medium">asApp()</Text> for writes — the same ownership-verified update workflow applies to both.
                            </Text>
                          </Box>
                        )}
                        {!allowPortalEdit && (
                          <Box xcss={metaRowStyle}>
                            <Text size="small" color="color.text.subtlest">
                              Portal customers can view their assets but not edit them.
                            </Text>
                          </Box>
                        )}
                      </Stack>
                    </Box>
                  </Stack>
                </Box>
                
              )}
              {selectedSchema && (
  <Box xcss={dividerStyle}>
    <Stack space="space.200">
      <Stack space="space.075">
        <Label labelFor="max-asset-limit">Step 4.5 — Asset Limits</Label>
        <Text size="small" color="color.text.subtlest">
          Caps how many of a user's merged assets (across all AQL rules combined, after
          de-duplication) this app will load and display per user.
        </Text>
      </Stack>

      <Box xcss={objectTypeCardStyle}>
        <Stack space="space.150">
          <Inline space="space.150" alignBlock="center">
            <Box xcss={xcss({ width: "140px" })}>
              <Textfield
                id="max-asset-limit"
                type="number"
                min={1}
                max={5000}
                value={String(maxUserAssetLimit)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setMaxUserAssetLimit(Number.isFinite(n) && n > 0 ? n : 500);
                  setIsDirty(true);
                  setSaveStatus(null);
                }}
              />
            </Box>
            <Text size="small" color="color.text.subtlest">
              objects per user (default 500, maximum 5000)
            </Text>
          </Inline>

          <Box xcss={aqlHintStyle}>
            <Stack space="space.050">
              <Text size="small" weight="medium">
                Why this exists, and a separate platform limit to know about
              </Text>
              <Text size="small" color="color.text.subtlest">
                This setting is enforced by this app, after merging results from all your AQL
                rules above and removing duplicates. Separately, the Jira Assets platform itself
                caps any single AQL query at 1,000 matching objects, regardless of this setting —
                if one rule alone could match more than 1,000 assets, splitting ownership across
                multiple narrower rules (e.g. by object type) lets each rule get its own
                1,000-object budget from the platform before this app's limit is applied on top.
              </Text>
            </Stack>
          </Box>

          {/* If we know the saved config's actual measured count and it
              hit the limit last time, surface that here so the admin
              isn't guessing whether 500 is enough. This relies on
              wasLimited/preLimitCount being returned by getUserAssets and
              surfaced somewhere reachable to this page — wire this up if/
              when you have a "test as user" or stats view; omit for now
              if you don't have that data available here. */}
        </Stack>
      </Box>
    </Stack>
  </Box>
)}


              {/* Step 5: Column visibility — REDESIGNED */}
              {selectedSchema && (
                <Box xcss={dividerStyle}>
                  <ColumnVisibilitySection
                    objectTypeGroups={objectTypeGroups}
                    hiddenByObjectType={hiddenByObjectType}
                    onToggle={handleToggle}
                    onToggleAll={handleToggleAll}
                    loadingAttrs={loadingAttrs}
                    attrError={attrError}
                  />
                </Box>
              )}

              {/* Save bar */}
              <Box xcss={dividerStyle}>
                <Inline spread="space-between" alignBlock="center">
                  <Box>
                    {saveStatus === "saved" && (
                      <Box xcss={savedBannerStyle}>
                        <Text color="color.text.success" size="small">✓ Configuration saved</Text>
                      </Box>
                    )}
                    {saveStatus === "error" && (
                      <Box xcss={errorBannerStyle}>
                        <Text color="color.text.danger" size="small">✕ Save failed — check resolver logs</Text>
                      </Box>
                    )}
                  </Box>
                  <Inline space="space.150" alignBlock="center">
                    {(isSchemaChanged || isDirty) && (
                      <Text size="small" color="color.text.subtlest">Unsaved changes</Text>
                    )}
                    <Button
                      appearance="primary"
                      isDisabled={!canSave}
                      isLoading={saving}
                      onClick={handleSave}
                    >
                      {saving ? "Saving…" : "Save Configuration"}
                    </Button>
                  </Inline>
                </Inline>
              </Box>

            </Stack>
          </Box>
        )}

        {/* ── TAB: Browse User Assets ── */}
        {activeTab === "browse" && savedSchemaId && (
          <Box xcss={cardStyle}>
            <Stack space="space.300">
              <Stack space="space.100">
                <Heading as="h3">Browse User Assets</Heading>
                <Text size="small" color="color.text.subtlest">
                  Search for a user from the Assets Users object type, view their assigned assets, and edit them directly.
                </Text>
              </Stack>
              <Box xcss={dividerStyle}>
                <UserBrowser schemaId={savedSchemaId} />
              </Box>
            </Stack>
          </Box>
        )}

      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <ConfigPage />
  </React.StrictMode>
);
