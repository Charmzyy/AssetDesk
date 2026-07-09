import React, { useState, useMemo, useCallback } from 'react';
import {
  Text,
  Inline,
  Stack,
  Box,
  SectionMessage,
  Button,
  Lozenge,
  Textfield,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
  Label,
  Select,
  DatePicker,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { assetKeyStyle } from './shared';

// ─── Styles ───────────────────────────────────────────────────────────────────

const fieldRowStyle = xcss({
  paddingBottom: 'space.200',
  borderBottomWidth: 'border.width',
  borderBottomStyle: 'solid',
  borderBottomColor: 'color.border',
});

const readonlyFieldStyle = xcss({
  backgroundColor: 'color.background.neutral',
  borderRadius: 'border.radius.100',
  padding: 'space.150',
});

const modalLabelStyle = xcss({
  color: 'color.text.subtlest',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
});

const errorInlineStyle = xcss({
  backgroundColor: 'color.background.danger',
  borderRadius: 'border.radius.100',
  padding: 'space.100',
  paddingInline: 'space.150',
});

// ─── AttributeField ───────────────────────────────────────────────────────────
// Type-appropriate input for one attribute inside the edit modal: status →
// Select of status options (read-only pill if options couldn't be
// resolved), object refs → read-only, select → Select, date → DatePicker,
// everything else → Textfield.

const AttributeField = ({ col, value, onChange, isDisabled }) => {
  if (col.attributeType === 'status') {
    const statusOpts = col.statusOptions || [];
    if (statusOpts.length > 0) {
      const allOptions = [{ label: '— None —', value: '' }, ...statusOpts];
      const selected =
        allOptions.find((o) => o.value === value) ||
        { label: value || '— None —', value: value || '' };
      return (
        <Select
          inputId={`field-${col.attributeId}`}
          options={allOptions}
          value={selected}
          onChange={(opt) => onChange(opt?.value ?? '')}
          isDisabled={isDisabled}
          placeholder="Select a status…"
        />
      );
    }
    return (
      <Box xcss={readonlyFieldStyle}>
        <Inline space="space.100" alignBlock="center">
          <Text color="color.text.subtlest">{value || '—'}</Text>
          <Lozenge appearance="default">Status ref</Lozenge>
        </Inline>
      </Box>
    );
  }

  if (col.attributeType === 'object') {
    return (
      <Box xcss={readonlyFieldStyle}>
        <Text color="color.text.subtlest">{value || '—'}</Text>
      </Box>
    );
  }

  if (col.attributeType === 'select' && col.options?.length > 0) {
    const options = col.options.map((o) => ({ label: o, value: o }));
    const allOptions = [{ label: '— None —', value: '' }, ...options];
    const selected =
      allOptions.find((o) => o.value === value) || { label: '— None —', value: '' };
    return (
      <Select
        inputId={`field-${col.attributeId}`}
        options={allOptions}
        value={selected}
        onChange={(opt) => onChange(opt?.value ?? '')}
        isDisabled={isDisabled}
        placeholder="Select an option…"
      />
    );
  }

  if (col.attributeType === 'date') {
    return (
      <DatePicker
        id={`field-${col.attributeId}`}
        value={value || ''}
        onChange={(date) => onChange(date || '')}
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
// Fullscreen modal editing every editable attribute of one asset. Saves
// each changed field via its own updateAssetAttribute call (the resolver
// re-verifies ownership server-side per call), marks fields Saved as they
// land, and reports the updates back through onSaved so the table reflects
// the edit without a refetch.

const EditAssetModal = ({ asset, columns, onClose, onSaved }) => {
  const [formValues, setFormValues] = useState(() => {
    const init = {};
    columns.forEach((col) => {
      if (col.attributeType === 'date' || col.attributeType === 'status') {
        init[col.attributeId] = asset.rawValues?.[col.attributeId] ?? '';
      } else {
        init[col.attributeId] = asset.visibleValues?.[col.attributeId] ?? '';
      }
    });
    return init;
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedFields, setSavedFields] = useState(new Set());

  const editableColumns = useMemo(
    () =>
      columns.filter((col) => {
        if (col.isEditable === false) return false;
        if (col.attributeType === 'object') return false;
        if (col.attributeType === 'status') return (col.statusOptions?.length ?? 0) > 0;
        return true;
      }),
    [columns]
  );

  const dirtyFields = useMemo(() => {
    const dirty = new Set();
    columns.forEach((col) => {
      if (col.attributeType === 'object') return;
      const useRaw = col.attributeType === 'date' || col.attributeType === 'status';
      const original = useRaw
        ? (asset.rawValues?.[col.attributeId] ?? '')
        : (asset.visibleValues?.[col.attributeId] ?? '');
      if (formValues[col.attributeId] !== original) dirty.add(col.attributeId);
    });
    return dirty;
  }, [formValues, columns, asset]);

  const handleFieldChange = useCallback((attributeId, newValue) => {
    setFormValues((prev) => ({ ...prev, [attributeId]: newValue }));
    setSaveError(null);
  }, []);

  const handleSaveAll = async () => {
    const changedEditableColumns = editableColumns.filter((col) =>
      dirtyFields.has(col.attributeId)
    );
    if (changedEditableColumns.length === 0) { onClose(); return; }

    setSaving(true);
    setSaveError(null);

    try {
      const updates = {};
      const rawUpdates = {};
      for (const col of changedEditableColumns) {
        await invoke('updateAssetAttribute', {
          objectId: asset.id,
          objectTypeId: asset.objectTypeId,
          objectTypeAttributeId: col.attributeId,
          attributeType: col.attributeType,
          value: formValues[col.attributeId],
        });
        const rawId = formValues[col.attributeId];
        if (col.attributeType === 'status') {
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
      setSaveError(err?.message || 'One or more fields failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const dirtyEditableCount = editableColumns.filter((c) =>
    dirtyFields.has(c.attributeId)
  ).length;

  return (
    <Modal onClose={onClose} width="fullscreen">
      <ModalHeader>
        <ModalTitle>Edit Asset</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.300">
          <Box xcss={readonlyFieldStyle}>
            <Inline spread="space-between" alignBlock="center">
              <Stack space="space.025">
                <Box xcss={modalLabelStyle}>
                  <Text size="small">Asset Name</Text>
                </Box>
                <Text weight="medium">{asset.label || '—'}</Text>
              </Stack>
              <Inline space="space.100" alignBlock="center">
                <Box xcss={assetKeyStyle}>
                  <Text size="small" color="color.text.brand">{asset.objectKey || '—'}</Text>
                </Box>
                <Lozenge appearance="inprogress">{asset.objectTypeName || 'Asset'}</Lozenge>
              </Inline>
            </Inline>
          </Box>

          {columns.length === 0 && (
            <SectionMessage appearance="info">
              <Text>No configurable fields for this asset type.</Text>
            </SectionMessage>
          )}

          {columns.map((col) => {
            const isEditable =
              col.isEditable !== false &&
              (() => {
                if (col.attributeType === 'object') return false;
                if (col.attributeType === 'status') return (col.statusOptions?.length ?? 0) > 0;
                return true;
              })();
            const isSaved = savedFields.has(col.attributeId);
            const isDirty = dirtyFields.has(col.attributeId);
            return (
              <Box key={col.attributeId} xcss={fieldRowStyle}>
                <Stack space="space.100">
                  <Inline spread="space-between" alignBlock="center">
                    <Label labelFor={`field-${col.attributeId}`}>
                      {col.attributeName}
                    </Label>
                    <Inline space="space.075" alignBlock="center">
                      {col.attributeType === 'object' && (
                        <Lozenge appearance="default">Object ref</Lozenge>
                      )}
                      {col.attributeType === 'status' && !(col.statusOptions?.length > 0) && (
                        <Lozenge appearance="default">Status ref</Lozenge>
                      )}
                      {!isEditable &&
                        col.attributeType !== 'object' &&
                        col.attributeType !== 'status' && (
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
                    value={formValues[col.attributeId]}
                    onChange={(newValue) => handleFieldChange(col.attributeId, newValue)}
                    isDisabled={saving || !isEditable}
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
              {dirtyEditableCount} field{dirtyEditableCount !== 1 ? 's' : ''} changed
            </Text>
          )}
          <Button appearance="subtle" onClick={onClose} isDisabled={saving}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            onClick={handleSaveAll}
            isDisabled={saving || dirtyEditableCount === 0}
            isLoading={saving}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </Inline>
      </ModalFooter>
    </Modal>
  );
};

export default EditAssetModal;
