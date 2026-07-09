import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box,
  Stack,
  Inline,
  Text,
  Lozenge,
  Button,
  Select,
  Label,
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
import {
  errorBannerStyle,
  metaRowStyle,
  sectionLabelStyle,
  dividerStyle,
  assetKeyStyle,
} from "./styles";

// ─── Browse User Assets (admin preview tab) ────────────────────────────────────
// The admin-facing "what would user X see?" flow: search the schema's Users
// object type, load that user's assets via the same ownership pipeline the
// portal uses (getAssetsForUser — with hidden attributes IGNORED so the
// admin sees everything), and edit assets inline. This module's
// AttributeField/EditAssetModal are the ADMIN variants — near-twins of the
// portal footer's (components/EditAssetModal.jsx) but with async
// field-loading states and "Hidden in table" lozenges the portal version
// doesn't need. Kept separate deliberately: the two evolve independently.

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
  // Group by object type. Called ahead of the empty-state early return —
  // hooks can't follow a conditional return (rules-of-hooks; this was a
  // latent violation in the pre-split ConfigurePage.jsx that eslint only
  // flagged once the component moved into its own file).
  const typeGroups = useMemo(() => {
    const map = {};
    assets.forEach((a) => {
      const key = a.objectTypeName || "Other";
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });
    return map;
  }, [assets]);

  if (assets.length === 0) {
    return (
      <SectionMessage appearance="info">
        <Text>No assets found for this user.</Text>
      </SectionMessage>
    );
  }

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

export default UserBrowser;
