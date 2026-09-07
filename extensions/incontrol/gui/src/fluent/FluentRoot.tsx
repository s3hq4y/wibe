/**
 * Mounts Fluent's theming context around the webview app.
 *
 * The theme is rebuilt when the editor theme changes: VS Code rewrites the
 * `--vscode-*` properties on <html>/<body> without reloading the webview, so a
 * MutationObserver on both attributes is enough to stay in sync.
 */
import { FluentProvider } from "@fluentui/react-components";
import "./fluent.css";
import type { Theme } from "@fluentui/react-components";
import * as React from "react";
import { buildFluentTheme } from "./theme";

export function useFluentTheme(): Theme {
  const [theme, setTheme] = React.useState<Theme>(() => buildFluentTheme());

  React.useEffect(() => {
    let frame = 0;
    const recompute = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTheme(buildFluentTheme()));
    };
    const observer = new MutationObserver(recompute);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    window.addEventListener("incontrol:theme-change", recompute);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("incontrol:theme-change", recompute);
    };
  }, []);

  return theme;
}

export function FluentRoot({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const theme = useFluentTheme();
  return (
    <FluentProvider
      theme={theme}
      className="flex min-h-0 w-full flex-1 flex-col"
      style={{ fontFamily: theme.fontFamilyBase }}
    >
      {children}
    </FluentProvider>
  );
}

export default FluentRoot;
