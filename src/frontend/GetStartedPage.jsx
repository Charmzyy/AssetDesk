import React, { useState } from "react";
import ForgeReconciler, {
  Box,
  Stack,
  Inline,
  Text,
  Heading,
  Lozenge,
  Button,
  Badge,
  xcss,
  Image,
} from "@forge/react";

import Asset_1 from "../resources/config.png";
import Config_2 from "../resources/config_2.png";
import Config_3 from "../resources/config_3.png";
import Config_4 from "../resources/config_4.png";
// ─── Styles ──────────────────────────────────────────────────────────────────

const pageStyle = xcss({
  padding: "space.400",
  maxWidth: "800px",
});

const heroStyle = xcss({
  backgroundColor: "color.background.brand.subtlest",
  borderRadius: "border.radius.200",
  padding: "space.500",
  marginBottom: "space.400",
});

const stepCardStyle = xcss({
  backgroundColor: "color.background.input",
  borderRadius: "border.radius.200",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  padding: "space.400",
});

const stepCardDoneStyle = xcss({
  backgroundColor: "color.background.success",
  borderRadius: "border.radius.200",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border.success",
  padding: "space.400",
});

const stepNumberStyle = xcss({
  backgroundColor: "color.background.brand.bold",
  borderRadius: "border.radius.circle",
  width: "28px",
  height: "28px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: "0",
});

const stepNumberDoneStyle = xcss({
  backgroundColor: "color.background.success.bold",
  borderRadius: "border.radius.circle",
  width: "28px",
  height: "28px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: "0",
});

const screenshotBoxStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "dashed",
  borderColor: "color.border",
  padding: "space.400",
  marginTop: "space.200",
  minHeight: "120px",
});

const screenshotPlaceholderStyle = xcss({
  backgroundColor: "color.background.neutral.hovered",
  borderRadius: "border.radius.100",
  padding: "space.300",
  textAlign: "center",
});

const calloutStyle = xcss({
  backgroundColor: "color.background.warning.subtlest",
  borderRadius: "border.radius.100",
  borderLeftWidth: "border.width.outline",
  borderLeftStyle: "solid",
  borderLeftColor: "color.border.warning",
  padding: "space.200",
  paddingLeft: "space.300",
  marginTop: "space.150",
});

const tipStyle = xcss({
  backgroundColor: "color.background.information",
  borderRadius: "border.radius.100",
  padding: "space.200",
  marginTop: "space.150",
});

const dividerStyle = xcss({
  borderTopWidth: "border.width",
  borderTopStyle: "solid",
  borderTopColor: "color.border",
  paddingTop: "space.300",
  marginTop: "space.300",
});

const subStepStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  padding: "space.200",
  paddingLeft: "space.300",
  borderLeftWidth: "border.width.outline",
  borderLeftStyle: "solid",
  borderLeftColor: "color.border.brand",
});

const progressBarBgStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.circle",
  height: "6px",
  overflow: "hidden",
  marginTop: "space.100",
});

const sectionLabelStyle = xcss({
  color: "color.text.subtlest",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
});

// ─── ScreenshotSlot ───────────────────────────────────────────────────────────
// A placeholder that shows where an admin should paste a screenshot.
// In production you'd replace this with an actual <Image> component or
// a static hosted image URL.

const ScreenshotSlot = ({ label, hint }) => (
  <Box xcss={screenshotBoxStyle}>
    <Box xcss={screenshotPlaceholderStyle}>
      <Stack space="space.100" alignInline="center">
        <Text size="small" color="color.text.subtlest" weight="medium">
          📸 {label}
        </Text>
        {hint && (
          <Text size="small" color="color.text.subtlest">{hint}</Text>
        )}
      </Stack>
    </Box>
  </Box>
);

// ─── StepCard ────────────────────────────────────────────────────────────────

const StepCard = ({ number, title, done, onToggleDone, children }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <Box xcss={done ? stepCardDoneStyle : stepCardStyle}>
      <Stack space="space.250">

        {/* Step header */}
        <Inline spread="space-between" alignBlock="center">
          <Inline space="space.200" alignBlock="center">
            <Box xcss={done ? stepNumberDoneStyle : stepNumberStyle}>
              <Text
                size="small"
                weight="bold"
                color={done ? "color.text.inverse" : "color.text.inverse"}
              >
                {done ? "✓" : String(number)}
              </Text>
            </Box>
            <Heading as="h4">{title}</Heading>
            {done && <Lozenge appearance="success">Done</Lozenge>}
          </Inline>
          <Inline space="space.100" alignBlock="center">
            <Button
              appearance="subtle"
              spacing="compact"
              onClick={() => onToggleDone(number)}
            >
              {done ? "Mark incomplete" : "Mark done"}
            </Button>
            <Button
              appearance="subtle"
              spacing="compact"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "▾ Hide" : "▸ Show"}
            </Button>
          </Inline>
        </Inline>

        {/* Step body */}
        {expanded && children}

      </Stack>
    </Box>
  );
};

// ─── GetStartedPage ───────────────────────────────────────────────────────────

const TOTAL_STEPS = 5;

const GetStartedPage = () => {
  const [doneSteps, setDoneSteps] = useState(new Set());

  const toggleDone = (stepNumber) => {
    setDoneSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepNumber)) next.delete(stepNumber);
      else next.add(stepNumber);
      return next;
    });
  };

  const doneCount = doneSteps.size;
  const progressPct = Math.round((doneCount / TOTAL_STEPS) * 100);
  const allDone = doneCount === TOTAL_STEPS;

  return (
    <Box xcss={pageStyle}>
      <Stack space="space.400">

        {/* ── Hero ── */}
        <Box xcss={heroStyle}>
          <Stack space="space.200">
            <Inline space="space.150" alignBlock="center">
              <Heading as="h2">Get started with AssetDesk</Heading>
              {allDone && <Lozenge appearance="success">Setup complete 🎉</Lozenge>}
            </Inline>
            <Text color="color.text.subtlest">
              Follow these five steps to connect your Jira Assets schema, define query rules,
              control what customers see, and go live in your JSM portal.
            </Text>

            {/* Progress bar */}
            <Stack space="space.050">
              <Inline spread="space-between">
                <Text size="small" color="color.text.subtlest">
                  {doneCount} of {TOTAL_STEPS} steps completed
                </Text>
                <Text size="small" color="color.text.subtlest">{progressPct}%</Text>
              </Inline>
              <Box xcss={progressBarBgStyle}>
                <Box
                  xcss={xcss({
                    backgroundColor: allDone
                      ? "color.background.success.bold"
                      : "color.background.brand.bold",
                    height: "6px",
                    borderRadius: "border.radius.circle",
                    width: `${progressPct}%`,
                    transition: "width 0.3s ease",
                  })}
                />
              </Box>
            </Stack>

            <Inline space="space.150" shouldWrap>
              <Text size="small" color="color.text.subtlest">
                ⏱ Estimated setup time: <Text size="small" weight="medium">10 – 20 minutes</Text>
              </Text>
              <Text size="small" color="color.text.subtlest">
                🔑 Requires: <Text size="small" weight="medium">Jira Admin + JSM Admin</Text>
              </Text>
            </Inline>
          </Stack>
        </Box>

        {/* ── Prerequisites ── */}
        <Box xcss={stepCardStyle}>
          <Stack space="space.200">
            <Inline space="space.150" alignBlock="center">
              <Box xcss={sectionLabelStyle}><Text size="small">Before you begin</Text></Box>
            </Inline>
            <Inline space="space.300" shouldWrap>
              {[
                { check: "Jira Assets module is enabled on your site" },
                { check: "At least one Assets schema exists with object types" },
                { check: "Assets have an attribute linking to the user who owns them (e.g. Owner, Assigned To)" },
                { check: "Portal customers are set up in your JSM project" },
              ].map((item, i) => (
                <Inline key={i} space="space.100" alignBlock="center">
                  <Text size="small" color="color.text.success">✓</Text>
                  <Text size="small">{item.check}</Text>
                </Inline>
              ))}
            </Inline>
          </Stack>
        </Box>

        {/* ── Step 1: Choose your Assets schema ── */}
        <StepCard
          number={1}
          title="Choose your Assets schema"
          done={doneSteps.has(1)}
          onToggleDone={toggleDone}
        >
          <Stack space="space.200">
            <Text>
              The schema is the top-level container in Jira Assets. AssetDesk needs to know which
              schema holds your hardware, software, or other assets.
            </Text>

            <Stack space="space.100">
              {[
                { step: "1", text: "Go to the Configure tab in the AssetDesk admin page." },
                { step: "2", text: "Under Step 1 — Assets Schema, open the dropdown." },
                { step: "3", text: "Select the schema that contains your users' assets." },
                { step: "4", text: "The object types inside that schema load automatically in Step 2." },
              ].map((s) => (
                <Box key={s.step} xcss={subStepStyle}>
                  <Inline space="space.150" alignBlock="center">
                    <Badge appearance="primary">{s.step}</Badge>
                    <Text size="small">{s.text}</Text>
                  </Inline>
                </Box>
              ))}
            </Stack>

            <Image
     src={Asset_1}
     alt="Configure tab → Step 1 showing the schema picker with a schema selected"
   />
            <Box xcss={tipStyle}>
              <Text size="small">
                💡 <Text size="small" weight="medium">Tip:</Text> If your schema doesn't appear,
                check that your Jira admin account has View access to the schema in Assets settings.
              </Text>
            </Box>
          </Stack>
        </StepCard>

        {/* ── Step 2: Define Asset Query Rules (AQL) ── */}
        <StepCard
          number={2}
          title="Define asset query rules (AQL)"
          done={doneSteps.has(2)}
          onToggleDone={toggleDone}
        >
          <Stack space="space.200">
            <Text>
              Query rules tell the app how to find assets that belong to the current user.
              Each rule is a pattern like: <Text weight="medium">"Owner attribute equals the user's Account ID"</Text>.
              Multiple rules run in parallel — useful if assets can be assigned via different attributes.
            </Text>

            <Stack space="space.100">
              {[
                { step: "1", text: "Under Step 3, type the attribute path that links assets to users — e.g. Owner or \"Assigned To\".\"Account ID\"." },
                { step: "2", text: "Choose an operator. Use = (equals) for account IDs and exact names." },
                { step: "3", text: "Choose what to match against. Account ID is the most reliable option and works for both portal customers and licensed agents." },
                { step: "4", text: "Click Test to validate the rule runs for your own account and returns your assets." },
                { step: "5", text: "Click + Add rule if assets can be owned via multiple attributes (e.g. Owner and In Charge)." },
              ].map((s) => (
                <Box key={s.step} xcss={subStepStyle}>
                  <Inline space="space.150" alignBlock="center">
                    <Badge appearance="primary">{s.step}</Badge>
                    <Text size="small">{s.text}</Text>
                  </Inline>
                </Box>
              ))}
            </Stack>

            
            <Image
              src={Config_2}
              alt="Step 3 showing 2–3 compact rule rows, one with a green validation result"
            />

            <Box xcss={calloutStyle}>
              <Stack space="space.075">
                <Text size="small" weight="medium">⚠ Portal customers and Account ID</Text>
                <Text size="small">
                  Portal customers (unlicensed JSM users) cannot use the <Text size="small" weight="medium">currentUser()</Text> AQL function.
                  Always add a rule using <Text size="small" weight="medium">Account ID</Text> to ensure they see their assets.
                  Using Display Name as a fallback is fine but less reliable if names aren't unique.
                </Text>
              </Stack>
            </Box>
          </Stack>
        </StepCard>

        {/* ── Step 3: Configure edit permissions ── */}
        <StepCard
          number={3}
          title="Configure edit permissions"
          done={doneSteps.has(3)}
          onToggleDone={toggleDone}
        >
          <Stack space="space.200">
            <Text>
              Control who can edit assets and which identity appears in the Assets audit log.
            </Text>

            <Stack space="space.150">
              <Box xcss={subStepStyle}>
                <Stack space="space.075">
                  <Text size="small" weight="medium">Write account (audit log identity)</Text>
                  <Text size="small">
                    <Text size="small" weight="medium">Service account (recommended):</Text> All writes appear as the app in the audit log.
                    Both licensed agents and portal customers use this path.
                  </Text>
                  <Text size="small">
                    <Text size="small" weight="medium">User account:</Text> Writes appear as the individual agent's name.
                    Not available for portal customers — they always fall back to service account.
                  </Text>
                </Stack>
              </Box>

              <Box xcss={subStepStyle}>
                <Stack space="space.075">
                  <Text size="small" weight="medium">Allow portal customers to edit</Text>
                  <Text size="small">
                    Toggle <Text size="small" weight="medium">Allow portal customers to edit their own assets</Text> on
                    to enable editing for unlicensed JSM users. Customers can only edit assets
                    that match your AQL rules — ownership is verified before every write.
                  </Text>
                  <Text size="small" color="color.text.subtlest">
                    When this is off, customers see their assets in read-only mode.
                  </Text>
                </Stack>
              </Box>
            </Stack>

            
            <Image
              src={Config_3}
              alt="Step 4 showing 2–3 compact rule rows, one with a green validation result"
            />

            <Box xcss={tipStyle}>
              <Text size="small">
                💡 The ownership check is always enforced regardless of settings — a user can only
                edit assets that are matched by your AQL rules, even if they craft a rogue request.
              </Text>
            </Box>
          </Stack>
        </StepCard>

        {/* ── Step 4: Hide sensitive columns ── */}
        <StepCard
          number={4}
          title="Choose visible columns for customers"
          done={doneSteps.has(4)}
          onToggleDone={toggleDone}
        >
          <Stack space="space.200">
            <Text>
              Step 5 in the Configure tab lets you control which attributes appear in the
              portal table. Hidden attributes are not shown in the table — but they can still
              be edited in the Edit modal (if they have a value). This keeps the table clean
              without restricting what users can update.
            </Text>

            <Stack space="space.100">
              {[
                { step: "1", text: "Expand an object type by clicking its header row." },
                { step: "2", text: "Toggle individual attributes on or off. The badge shows how many are visible." },
                { step: "3", text: "Use Show all / Hide all for quick bulk changes." },
                { step: "4", text: "Use the search box to find a specific attribute by name." },
                { step: "5", text: "Attributes are paginated (8 per page) — use Prev / Next if a type has many." },
                { step: "6", text: "Use the global search at the top to filter across all object types at once." },
              ].map((s) => (
                <Box key={s.step} xcss={subStepStyle}>
                  <Inline space="space.150" alignBlock="center">
                    <Badge appearance="primary">{s.step}</Badge>
                    <Text size="small">{s.text}</Text>
                  </Inline>
                </Box>
              ))}
            </Stack>

            <Image
              src={Config_4}
              alt="Step 4 showing 2–3 compact rule rows, one with a green validation result"
            />

            <Inline space="space.200" shouldWrap>
              <Box xcss={tipStyle} xcss={xcss({ flex: "1" })}>
                <Text size="small">
                  💡 <Text size="small" weight="medium">Hidden ≠ locked:</Text> Hiding a column only removes it from
                  the table view. Users opening the Edit modal will still see any attribute that has a value, even
                  hidden ones, so they can make changes to all their data.
                </Text>
              </Box>
              <Box xcss={calloutStyle} xcss={xcss({ flex: "1" })}>
                <Text size="small">
                  ⚠ Built-in fields (Name, Key, Created, Updated) are always visible and cannot be hidden.
                </Text>
              </Box>
            </Inline>
          </Stack>
        </StepCard>

        {/* ── Step 5: Save and verify ── */}
        <StepCard
          number={5}
          title="Save configuration and verify"
          done={doneSteps.has(5)}
          onToggleDone={toggleDone}
        >
          <Stack space="space.200">
            <Text>
              Save your configuration and use the Browse User Assets tab to verify that
              customers can see and edit their assets correctly.
            </Text>

            <Stack space="space.100">
              {[
                { step: "1", text: "Click Save Configuration at the bottom of the Configure tab." },
                { step: "2", text: "Switch to the Browse User Assets tab." },
                { step: "3", text: "Search for a customer by name." },
                { step: "4", text: "Click View assets to see their asset list as the admin would see it." },
                { step: "5", text: "Open an asset with Edit and confirm all fields load correctly, including hidden-in-table attributes." },
                { step: "6", text: "Open the JSM portal as a customer or use a test account to verify the end-to-end flow." },
              ].map((s) => (
                <Box key={s.step} xcss={subStepStyle}>
                  <Inline space="space.150" alignBlock="center">
                    <Badge appearance="primary">{s.step}</Badge>
                    <Text size="small">{s.text}</Text>
                  </Inline>
                </Box>
              ))}
            </Stack>

           

            <Box xcss={tipStyle}>
              <Stack space="space.075">
                <Text size="small" weight="medium">💡 Troubleshooting: customer sees 0 assets</Text>
                <Text size="small">
                  If a portal customer sees no assets, a diagnostic panel appears with their account details,
                  whether the schema is reachable, and which AQL candidates were tried.
                  The most common fix is adding an Account ID-based rule (Step 2).
                </Text>
              </Stack>
            </Box>

            <Box xcss={calloutStyle}>
              <Stack space="space.075">
                <Text size="small" weight="medium">⚠ Schema drift</Text>
                <Text size="small">
                  If you delete object types or attributes from your Assets schema after saving,
                  a Schema drift detected banner will appear in the Configure tab. Click Re-check,
                  then Clean up stale config to remove the ghost entries. This does not affect your
                  live schema — it only cleans up stale references in AssetDesk's saved configuration.
                </Text>
              </Stack>
            </Box>
          </Stack>
        </StepCard>

        {/* ── All done ── */}
        {allDone && (
          <Box xcss={heroStyle}>
            <Stack space="space.200" alignInline="center">
              <Text size="large" weight="bold" color="color.text.brand">
                🎉 You're all set!
              </Text>
              <Text color="color.text.subtlest">
                AssetDesk is configured. Portal customers matching your AQL rules will see their assets
                the next time they open the JSM portal.
              </Text>
            </Stack>
          </Box>
        )}

        {/* ── Quick reference ── */}
        <Box xcss={dividerStyle}>
          <Stack space="space.200">
            <Box xcss={sectionLabelStyle}><Text size="small">Quick reference</Text></Box>
            <Inline space="space.200" shouldWrap>
              {[
                { label: "Schema drift", detail: "Schema tab → drift banner → Re-check → Clean up" },
                { label: "Add a new rule", detail: "Configure → Step 3 → + Add rule" },
                { label: "Allow customer editing", detail: "Configure → Step 4 → toggle on" },
                { label: "Hide a column", detail: "Configure → Step 5 → expand type → toggle off" },
                { label: "Browse user assets", detail: "Admin page → Browse User Assets tab" },
                { label: "Test AQL rule", detail: "Step 3 → fill in rule → click Test" },
              ].map((item, i) => (
                <Box key={i} xcss={subStepStyle} xcss={xcss({ minWidth: "220px", flex: "1" })}>
                  <Stack space="space.025">
                    <Text size="small" weight="medium">{item.label}</Text>
                    <Text size="small" color="color.text.subtlest">{item.detail}</Text>
                  </Stack>
                </Box>
              ))}
            </Inline>
          </Stack>
        </Box>

      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <GetStartedPage />
  </React.StrictMode>
);
