/**
 * InternMatch monochrome design tokens.
 * Pure black + grayscale + pure white. No chromatic colors.
 * Semantic state is encoded via intensity/contrast, not hue.
 */
export const COLORS = {
  bg: "#000000",
  bgElev: "#0A0A0A",
  card: "#0F0F0F",
  cardElev: "#171717",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.16)",
  text: "#FAFAFA",
  textMuted: "#A3A3A3",
  textDim: "#525252",
  accent: "#FFFFFF",
  // Monochrome state encoding (intensity-based)
  state: {
    success: "#A3A3A3", // verified — neutral light gray
    warning: "#D4D4D4", // change — brighter gray
    critical: "#FFFFFF", // contradiction — full white = max attention
  },
} as const;
