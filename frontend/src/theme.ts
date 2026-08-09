import type { GlobalThemeOverrides } from "naive-ui";

const fontFamily =
  '"DM Sans", "Segoe UI", system-ui, -apple-system, sans-serif';
const fontFamilyMono = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

const shared = {
  common: {
    fontFamily,
    fontFamilyMono,
    borderRadius: "10px",
    borderRadiusSmall: "8px",
  },
} satisfies GlobalThemeOverrides;

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
