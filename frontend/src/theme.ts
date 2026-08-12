import type { GlobalThemeOverrides } from "naive-ui";

const fontFamily =
  '"DM Sans", "Segoe UI", system-ui, -apple-system, sans-serif';
const fontFamilyMono = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

const shared = {
  common: {
    fontFamily,
    fontFamilyMono,
    borderRadius: "10px",
    borderRadiusSmall: "8px",
  },
} satisfies GlobalThemeOverrides;

export type PresetAccentId = "forest" | "ocean" | "amber" | "coral" | "slate";
export type AccentId = PresetAccentId | "custom";

export type AccentTone = { primary: string; hover: string; pressed: string };

export type AccentPalette = {
  id: PresetAccentId;
  labelKey: string;
  light: AccentTone;
  dark: AccentTone;
};

export const ACCENTS: AccentPalette[] = [
  {
    id: "forest",
    labelKey: "profile.accentForest",
    light: { primary: "#0b6e4f", hover: "#0d8660", pressed: "#095a41" },
    dark: { primary: "#3ecf9a", hover: "#56d9a8", pressed: "#2bb884" },
  },
  {
    id: "ocean",
    labelKey: "profile.accentOcean",
    light: { primary: "#1d6fbf", hover: "#2480d6", pressed: "#155a9c" },
    dark: { primary: "#5aa8ff", hover: "#7bbcff", pressed: "#3d8ef0" },
  },
  {
    id: "amber",
    labelKey: "profile.accentAmber",
    light: { primary: "#a06a08", hover: "#b87a0c", pressed: "#855706" },
    dark: { primary: "#e0b44a", hover: "#ecc56a", pressed: "#c99a2e" },
  },
  {
    id: "coral",
    labelKey: "profile.accentCoral",
    light: { primary: "#c24a3b", hover: "#d45544", pressed: "#a33c30" },
    dark: { primary: "#f07178", hover: "#f58a90", pressed: "#e0555d" },
  },
  {
    id: "slate",
    labelKey: "profile.accentSlate",
    light: { primary: "#3d4f5c", hover: "#4d6272", pressed: "#31404b" },
    dark: { primary: "#9aabb8", hover: "#b7c3cd", pressed: "#8796a3" },
  },
];

const DEFAULT_CUSTOM = "#5aa8ff";

export function isPresetAccentId(id: string | null | undefined): id is PresetAccentId {
  return ACCENTS.some((a) => a.id === id);
}

export function normalizeAccentId(id: string | null | undefined): AccentId {
  if (id === "custom") return "custom";
  if (isPresetAccentId(id)) return id;
  return "forest";
}

export function getAccent(id: AccentId | string | null | undefined): AccentPalette {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]!;
}

export function normalizeHexColor(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_CUSTOM;
  let v = raw.trim();
  if (!v.startsWith("#")) v = `#${v}`;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1]!;
    const g = v[2]!;
    const b = v[3]!;
    v = `#${r}${r}${g}${g}${b}${b}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) return DEFAULT_CUSTOM;
  return v.toLowerCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHexColor(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Mix toward white (amount 0–1) or black (negative). */
function mixToward(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  if (amount >= 0) {
    return rgbToHex(
      r + (255 - r) * amount,
      g + (255 - g) * amount,
      b + (255 - b) * amount,
    );
  }
  const t = -amount;
  return rgbToHex(r * (1 - t), g * (1 - t), b * (1 - t));
}

/** Relative luminance for picking readable mark text. */
export function isLightColor(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.55;
}

export function toneFromCustom(hex: string, isDark: boolean): AccentTone {
  const primary = normalizeHexColor(hex);
  if (isDark) {
    // Prefer a slightly lifted primary in dark UI so accents stay vivid.
    const base = mixToward(primary, 0.12);
    return {
      primary: base,
      hover: mixToward(base, 0.18),
      pressed: mixToward(base, -0.12),
    };
  }
  return {
    primary,
    hover: mixToward(primary, 0.14),
    pressed: mixToward(primary, -0.16),
  };
}

export function resolveAccentTone(
  accentId: AccentId,
  isDark: boolean,
  customHex?: string | null,
): AccentTone {
  if (accentId === "custom") {
    return toneFromCustom(customHex ?? DEFAULT_CUSTOM, isDark);
  }
  const accent = getAccent(accentId);
  return isDark ? accent.dark : accent.light;
}

/** Apply accent CSS variables used by custom UI (chips, marks, etc.). */
export function applyAccentCssVars(
  accentId: AccentId,
  isDark: boolean,
  customHex?: string | null,
): void {
  const tone = resolveAccentTone(accentId, isDark, customHex);
  const root = document.documentElement;
  root.dataset.accent = accentId;
  root.style.setProperty("--app-accent", tone.primary);
  root.style.setProperty("--app-accent-hover", tone.hover);
  root.style.setProperty("--app-accent-pressed", tone.pressed);
  root.style.setProperty(
    "--app-chip-active-bg",
    `color-mix(in srgb, ${tone.primary} ${isDark ? "18%" : "14%"}, transparent)`,
  );
  root.style.setProperty(
    "--app-chip-active-border",
    `color-mix(in srgb, ${tone.primary} ${isDark ? "55%" : "45%"}, transparent)`,
  );
  root.style.setProperty("--app-chip-active-text", tone.primary);
  root.style.setProperty(
    "--app-brand-fg",
    isLightColor(tone.primary) ? "#0f161c" : "#ffffff",
  );
}

function withAccent(
  base: GlobalThemeOverrides,
  tone: AccentTone,
): GlobalThemeOverrides {
  return {
    ...base,
    common: {
      ...base.common,
      primaryColor: tone.primary,
      primaryColorHover: tone.hover,
      primaryColorPressed: tone.pressed,
      primaryColorSuppl: tone.primary,
      successColor: tone.primary,
    },
  };
}

export const lightThemeOverrides: GlobalThemeOverrides = {
  ...shared,
  common: {
    ...shared.common,
    primaryColor: "#0b6e4f",
    primaryColorHover: "#0d8660",
    primaryColorPressed: "#095a41",
    primaryColorSuppl: "#12805c",
    infoColor: "#2f6fed",
    successColor: "#0b6e4f",
    warningColor: "#b8860b",
    errorColor: "#c23b3b",
    bodyColor: "#eef2f5",
    cardColor: "#ffffff",
    modalColor: "#ffffff",
    popoverColor: "#ffffff",
    tableColor: "#ffffff",
    inputColor: "#ffffff",
    actionColor: "#f3f6f8",
    textColorBase: "#14212b",
    textColor1: "#14212b",
    textColor2: "#3d4f5c",
    textColor3: "#5b6b77",
    borderColor: "#d5dde5",
    dividerColor: "#e2e8ee",
  },
  Layout: {
    color: "transparent",
    siderColor: "rgba(255,255,255,0.82)",
    headerColor: "rgba(245,248,251,0.88)",
  },
  Card: {
    borderRadius: "12px",
  },
  Button: {
    fontWeight: "500",
  },
};

export const darkThemeOverrides: GlobalThemeOverrides = {
  ...shared,
  common: {
    ...shared.common,
    primaryColor: "#3ecf9a",
    primaryColorHover: "#56d9a8",
    primaryColorPressed: "#2bb884",
    primaryColorSuppl: "#3ecf9a",
    infoColor: "#6aa1ff",
    successColor: "#3ecf9a",
    warningColor: "#e0b44a",
    errorColor: "#f07178",
    bodyColor: "#0f161c",
    cardColor: "#171f27",
    modalColor: "#1b242d",
    popoverColor: "#1b242d",
    tableColor: "#171f27",
    inputColor: "#121920",
    actionColor: "#1e2831",
    textColorBase: "#e8eef3",
    textColor1: "#e8eef3",
    textColor2: "#b7c3cd",
    textColor3: "#8796a3",
    borderColor: "#2a3641",
    dividerColor: "#24303a",
  },
  Layout: {
    color: "transparent",
    siderColor: "rgba(18, 25, 32, 0.92)",
    headerColor: "rgba(15, 22, 28, 0.9)",
  },
  Card: {
    borderRadius: "12px",
  },
  Button: {
    fontWeight: "500",
  },
};

export function buildThemeOverrides(
  isDark: boolean,
  accentId: AccentId,
  customHex?: string | null,
): GlobalThemeOverrides {
  const base = isDark ? darkThemeOverrides : lightThemeOverrides;
  return withAccent(base, resolveAccentTone(accentId, isDark, customHex));
}

export const DEFAULT_CUSTOM_ACCENT = DEFAULT_CUSTOM;
