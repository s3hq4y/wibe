import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Minimal host-side localization layer.
 *
 * `vscode.l10n` would be the canonical choice, but it needs `@types/vscode`
 * >= 1.73 and would force `engines.vscode` up, narrowing where this extension
 * can be installed. So the dictionary ships next to the extension and is keyed
 * by the English source text: a miss returns the source string, so an
 * incomplete translation degrades to English instead of to a blank or a
 * `[[key]]`.
 */
let dict: Record<string, string> | null = null;
let attempted = false;

export function initHostI18n(extensionPath: string): void {
  if (attempted) {
    return;
  }
  attempted = true;
  const lang = (vscode.env.language || "").toLowerCase();
  if (!lang.startsWith("zh")) {
    return;
  }
  try {
    const file = path.join(extensionPath, "l10n", "zh-cn.json");
    if (fs.existsSync(file)) {
      dict = JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) {
    console.warn("[incontrol] could not load the l10n bundle:", e);
  }
}

/** Localized text for `english`, with `{0}`/`{1}`... substituted from `args`. */
export function t(english: string, ...args: Array<string | number>): string {
  let out = (dict && dict[english]) || english;
  args.forEach((arg, i) => {
    out = out.split(`{${i}}`).join(String(arg));
  });
  return out;
}
