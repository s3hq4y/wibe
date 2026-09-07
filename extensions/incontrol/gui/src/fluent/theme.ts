/**
 * Fluent theme derived from the VS Code color theme.
 *
 * The webview gets the active theme as `--vscode-*` custom properties, so we
 * read the ones that matter and lay them over Fluent's token names. Fluent
 * controls then follow the editor instead of showing Fluent's own palette.
 */
import type { Theme } from "@fluentui/react-components";
import { webDarkTheme, webLightTheme } from "@fluentui/react-components";

const varOf = (name: string, fallback = ""): string => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

function parseColor(value: string): [number, number, number] | null {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  const rgb = value.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const parts = rgb[1]
      .split(/[\s,\/]+/)
      .map(Number)
      .filter((n) => !isNaN(n));
    if (parts.length >= 3) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

function luminance(value: string): number | null {
  const rgb = parseColor(value);
  if (!rgb) {
    return null;
  }
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Mix two colors by weight, used to derive the "raised" surfaces Fluent wants. */
function mix(value: string, other: string, weight: number): string {
  const a = parseColor(value);
  const b = parseColor(other);
  if (!a || !b) {
    return value;
  }
  const c = a.map((x, i) => Math.round(x * (1 - weight) + b[i] * weight));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

export function isDarkFluentTheme(): boolean {
  const lum = luminance(
    varOf("--vscode-sideBar-background") || varOf("--vscode-editor-background")
  );
  if (lum !== null) {
    return lum < 0.4;
  }
  if (typeof document !== "undefined") {
    const cls = `${document.documentElement.className} ${
      document.body?.className ?? ""
    }`;
    if (/vscode-light|vscode-high-contrast-light/.test(cls)) {
      return false;
    }
  }
  return true;
}

export function buildFluentTheme(): Theme {
  const dark = isDarkFluentTheme();
  const base: Theme = dark ? webDarkTheme : webLightTheme;

  const editorBg =
    varOf("--vscode-editor-background") || (dark ? "#1e1e1e" : "#ffffff");
  const sideBarBg = varOf("--vscode-sideBar-background") || editorBg;
  const inputBg = varOf("--vscode-input-background") || editorBg;
  const fg =
    varOf("--vscode-editor-foreground") || (dark ? "#cccccc" : "#333333");
  const border = varOf("--vscode-panel-border") || mix(fg, editorBg, 0.75);
  const buttonBg =
    varOf("--vscode-button-background") || (dark ? "#0e639c" : "#0078d4");
  const buttonHover =
    varOf("--vscode-button-hoverBackground") || mix(buttonBg, fg, 0.15);
  const buttonFg = varOf("--vscode-button-foreground") || "#ffffff";
  const listHover =
    varOf("--vscode-list-hoverBackground") || mix(fg, sideBarBg, 0.9);
  const link = varOf("--vscode-textLink-foreground") || buttonBg;

  const fontFamily =
    '"Segoe UI Variable Text", "Segoe UI", ' +
    (varOf("--vscode-font-family") || "system-ui") +
    ", sans-serif";
  const monoFamily =
    '"Cascadia Mono", ' +
    (varOf("--vscode-editor-font-family") || "monospace") +
    ", monospace";

  return {
    ...base,
    colorNeutralBackground1: sideBarBg,
    colorNeutralBackground1Hover: listHover,
    colorNeutralBackground2: editorBg,
    colorNeutralBackground3: inputBg,
    colorNeutralBackgroundAlpha2: dark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.06)",
    colorNeutralForeground1: fg,
    colorNeutralForeground2: mix(fg, sideBarBg, 0.25),
    colorNeutralForeground3: mix(fg, sideBarBg, 0.45),
    colorNeutralForeground4: mix(fg, sideBarBg, 0.6),
    colorNeutralForegroundDisabled: mix(fg, sideBarBg, 0.7),
    colorNeutralForegroundOnBrand: buttonFg,
    colorNeutralStroke1: border,
    colorNeutralStroke2: mix(border, sideBarBg, 0.5),
    colorNeutralStroke1Hover: fg,
    colorNeutralStrokeAccessible: mix(fg, sideBarBg, 0.35),
    colorNeutralStrokeDisabled: mix(border, sideBarBg, 0.5),
    colorStrokeFocus1: sideBarBg,
    colorStrokeFocus2: varOf("--vscode-focusBorder") || link,
    colorBrandBackground: buttonBg,
    colorBrandBackgroundHover: buttonHover,
    colorBrandBackgroundPressed: mix(buttonBg, fg, 0.25),
    colorBrandForeground1: link,
    colorBrandForeground2: mix(link, sideBarBg, 0.2),
    colorCompoundBrandForeground1: link,
    colorCompoundBrandBackground: buttonBg,
    colorCompoundBrandBackgroundHover: buttonHover,
    colorNeutralForegroundInverted: sideBarBg,
    colorPaletteRedForeground1: varOf("--vscode-errorForeground") || "#d13438",
    colorStatusSuccessBackground1: mix(
      varOf("--vscode-testing-iconPassed") || "#107c10",
      sideBarBg,
      0.85
    ),
    fontFamilyBase: fontFamily,
    fontFamilyMonospace: monoFamily,
    /* 全直角。真 Fluent 组件读的是这套 JS 令牌，非 Fluent 代码读 fluent.css 里
     * 的 --fluent-radius，两边都归零才不会一半圆一半尖。
     * 2XLarge..6XLarge 是浮层/对话框用的，一并归零；
     * Circular 留给确实需要圆形的东西（当前没有）。 */
    borderRadiusNone: "0px",
    borderRadiusSmall: "0px",
    borderRadiusMedium: "0px",
    borderRadiusLarge: "0px",
    borderRadiusXLarge: "0px",
    borderRadius2XLarge: "0px",
    borderRadius3XLarge: "0px",
    borderRadius4XLarge: "0px",
    borderRadius5XLarge: "0px",
    borderRadius6XLarge: "0px",
  } as Theme;
}
