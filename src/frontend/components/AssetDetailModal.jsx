import React from 'react';
import {
  Text,
  Inline,
  Stack,
  Box,
  Button,
  Lozenge,
  SectionMessage,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
  xcss,
} from '@forge/react';
import { assetKeyStyle } from './shared';

// ─── AssetDetailModal ─────────────────────────────────────────────────────────
// Read-only, full-width view of EVERY attribute of one asset, stacked
// vertically as label/value pairs.
//
// Why this exists: the tables cap how many attribute columns they render
// (PRIMARY_COLUMN_LIMIT in AssetTables.jsx) because the portal footer's
// width is fixed by Jira's own page layout — this module renders `native`
// (no iframe), so we can neither widen the table nor scroll it
// horizontally without blowing out the host page (see the tableWrapStyle
// comment in AssetTables.jsx). Squeezing 10+ columns into that width made
// every cell unreadable. So the grid shows only the first few columns at a
// readable width, and THIS modal is where the complete attribute set
// lives — it scales to any number of attributes because vertical space is
// unlimited, whereas horizontal space never will be.
//
// Deliberately dumb: no fetching (everything needed is already on the
// asset row the table handed us), no editing (that's EditAssetModal's
// job — the footer Edit button hands off to it when the caller may edit).

// ─── Styles ───────────────────────────────────────────────────────────────────
// Visually matched to EditAssetModal's field rows so View and Edit feel
// like two modes of the same surface.

const fieldRowStyle = xcss({
  paddingBottom: 'space.150',
  borderBottomWidth: 'border.width',
  borderBottomStyle: 'solid',
  borderBottomColor: 'color.border',
});

const headerCardStyle = xcss({
  backgroundColor: 'color.background.neutral',
  borderRadius: 'border.radius.100',
  padding: 'space.150',
});

const fieldLabelStyle = xcss({
  color: 'color.text.subtlest',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
});

const AssetDetailModal = ({ asset, columns, canEdit, onEdit, onClose }) => (
  <Modal onClose={onClose} width="large">
    <ModalHeader>
      <ModalTitle>Asset Details</ModalTitle>
    </ModalHeader>
    <ModalBody>
      <Stack space="space.200">
        {/* Identity card — same shape as EditAssetModal's header block. */}
        <Box xcss={headerCardStyle}>
          <Inline spread="space-between" alignBlock="center">
            <Stack space="space.025">
              <Box xcss={fieldLabelStyle}>
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
            <Text>No visible fields for this asset type.</Text>
          </SectionMessage>
        )}

        {/* One row per visible attribute — the FULL set, not just the
            columns the table had room for. Values come from visibleValues
            (the same human-readable strings the table cells render), so
            what the user sees here always agrees with the grid. */}
        {columns.map((col) => (
          <Box key={col.attributeId} xcss={fieldRowStyle}>
            <Stack space="space.050">
              <Box xcss={fieldLabelStyle}>
                <Text size="small">{col.attributeName}</Text>
              </Box>
              <Text>{asset.visibleValues?.[col.attributeId] || '—'}</Text>
            </Stack>
          </Box>
        ))}
      </Stack>
    </ModalBody>
    <ModalFooter>
      <Inline space="space.150" alignBlock="center">
        {canEdit && (
          <Button appearance="default" onClick={onEdit}>
            Edit asset
          </Button>
        )}
        <Button appearance="primary" onClick={onClose}>
          Close
        </Button>
      </Inline>
    </ModalFooter>
  </Modal>
);

export default AssetDetailModal;
