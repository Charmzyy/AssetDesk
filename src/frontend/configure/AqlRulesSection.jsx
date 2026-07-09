import React, { useState, useCallback } from "react";
import {
  Box,
  Stack,
  Inline,
  Text,
  Button,
  Select,
  Label,
  Toggle,
  Textfield,
  xcss,
} from "@forge/react";
import { invoke } from "@forge/bridge";
import { sectionLabelStyle } from "./styles";

// ─── AQL ownership-rule editor (Step 3) ────────────────────────────────────────
// Each rule row becomes one full AQL ownership candidate server-side (see
// buildAqlFromRow in resolvers/shared.js). Rules run in parallel and their
// results are merged, de-duplicated by asset id.

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

export default AqlRulesSection;
