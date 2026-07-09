import React from 'react';
import { Text, Inline, Stack, Box, Lozenge, xcss } from '@forge/react';

// ─── DiagnosticsPanel ─────────────────────────────────────────────────────────
// Shown only when a customer/unlicensed user sees zero assets.
// Gives admins/developers a clear explanation of what's wrong — the
// structured result of the diagnoseCaller resolver (identity resolved?
// workspace reachable? schema reachable? object count?).

const diagBoxStyle = xcss({
  backgroundColor: 'color.background.warning',
  borderRadius: 'border.radius.100',
  padding: 'space.150',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border.warning',
});

const DiagnosticsPanel = ({ diagnosis }) => {
  if (!diagnosis) return null;
  return (
    <Box xcss={diagBoxStyle}>
      <Stack space="space.100">
        <Text weight="medium" color="color.text.warning">
          ⚠ No assets found — diagnostic information
        </Text>
        <Stack space="space.050">
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Account type:</Text>
            <Text size="small">{diagnosis.accountType ?? '—'}</Text>
          </Inline>
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Account ID:</Text>
            <Text size="small">{diagnosis.accountId ?? '—'}</Text>
          </Inline>
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Display name resolved:</Text>
            <Text size="small">{diagnosis.displayName || '(empty — name-based AQL skipped)'}</Text>
          </Inline>
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Workspace reachable:</Text>
            <Lozenge appearance={diagnosis.workspaceReachable ? 'success' : 'removed'}>
              {diagnosis.workspaceReachable ? 'Yes' : 'No'}
            </Lozenge>
          </Inline>
          <Inline space="space.100">
            <Text size="small" color="color.text.subtlest">Schema accessible:</Text>
            <Lozenge appearance={diagnosis.schemaReachable ? 'success' : 'removed'}>
              {diagnosis.schemaReachable ? `Yes (${diagnosis.schemaObjectCount} objects)` : 'No'}
            </Lozenge>
          </Inline>
        </Stack>
        {diagnosis.errors?.length > 0 && (
          <Stack space="space.050">
            {diagnosis.errors.map((e, i) => (
              <Text key={i} size="small" color="color.text.danger">• {e}</Text>
            ))}
          </Stack>
        )}
        {diagnosis.schemaReachable && diagnosis.schemaObjectCount > 0 && (
          <Text size="small" color="color.text.subtlest">
            The schema is reachable and has objects. Your user is not matched by any AQL candidate.
            Check that an Owner attribute on your assets references a Users object whose Name (or Account ID) matches: "{diagnosis.displayName || diagnosis.accountId}".
          </Text>
        )}
      </Stack>
    </Box>
  );
};

export default DiagnosticsPanel;
