import React, { useState, useEffect, useCallback } from "react";
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
  Textfield,
  xcss,
} from "@forge/react";
import { invoke } from "@forge/bridge";

import {
  errorBannerStyle,
  warningBannerStyle,
  metaRowStyle,
  sectionLabelStyle,
  dividerStyle,
  objectTypeCardStyle,
  aqlHintStyle,
} from "./configure/styles";
import AqlRulesSection from "./configure/AqlRulesSection";
import ColumnVisibilitySection from "./configure/ColumnVisibilitySection";
import SchemaDriftBanner from "./configure/SchemaDriftBanner";
import UserBrowser from "./configure/UserBrowser";

// ─── Admin Configure page entry point ─────────────────────────────────────────
// This file is the manifest's `main-configure-page` resource (see resources
// in manifest.yml — renaming it means updating the manifest). It holds the
// ConfigPage component: config load/save state, schema selection, drift
// reconciliation wiring, and the step-by-step layout. The section UIs live
// under ./configure/ — extracted when this file passed 2,400 lines; styles
// shared by two or more sections are in ./configure/styles.js.

// ─── Styles (ConfigPage-only) ─────────────────────────────────────────────────

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
                      </Stack>
                    </Box>
                  </Stack>
                </Box>
              )}

              {/* Step 5: Column visibility */}
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
