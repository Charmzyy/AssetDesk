import { xcss } from "@forge/react";

// ─── Shared styles for the Configure page's sections ──────────────────────────
// Extracted from ConfigurePage.jsx when it was split into configure/ —
// only styles used by TWO OR MORE of the section modules live here; a
// style with a single consumer stays in that consumer's file.

export const errorBannerStyle = xcss({
  backgroundColor: "color.background.danger",
  borderRadius: "border.radius.100",
  padding: "space.150",
  paddingInline: "space.200",
});

export const warningBannerStyle = xcss({
  backgroundColor: "color.background.warning",
  borderRadius: "border.radius.100",
  padding: "space.150",
  paddingInline: "space.200",
});

export const metaRowStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  padding: "space.200",
});

export const sectionLabelStyle = xcss({
  color: "color.text.subtlest",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
});

export const dividerStyle = xcss({
  borderTopWidth: "border.width",
  borderTopStyle: "solid",
  borderTopColor: "color.border",
  paddingTop: "space.300",
});

export const objectTypeCardStyle = xcss({
  backgroundColor: "color.background.neutral",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  padding: "space.200",
});

export const objectTypeCardAccentStyle = xcss({
  backgroundColor: "color.background.selected",
  borderRadius: "border.radius.100",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border.selected",
  padding: "space.200",
});

export const assetKeyStyle = xcss({
  backgroundColor: "color.background.brand.subtlest",
  borderRadius: "border.radius.100",
  padding: "space.050",
  paddingInline: "space.100",
});

export const aqlHintStyle = xcss({
  backgroundColor: "color.background.brand.subtlest",
  borderRadius: "border.radius.100",
  padding: "space.150",
  paddingInline: "space.200",
});
