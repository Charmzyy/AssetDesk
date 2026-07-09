import React from "react";
import { Box, Stack, Inline, Text, Button, Badge, Lozenge } from "@forge/react";
import { warningBannerStyle, metaRowStyle } from "./styles";

// ─── SchemaDriftBanner ────────────────────────────────────────────────────────
// Surfaces the result of the reconcileConfig resolver: stored
// hidden-attribute config that no longer matches the live schema
// (deleted object types / attributes), plus types that couldn't be
// verified this round.

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

export default SchemaDriftBanner;
