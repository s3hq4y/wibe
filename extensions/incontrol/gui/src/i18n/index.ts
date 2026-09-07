// Webview-side localization. The English source text is the key, so an
// untranslated string falls back to English instead of a raw key.
import { zh } from "./zh";

const lang = (
  typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "en"
).toLowerCase();

const dict: Record<string, string> = lang.startsWith("zh") ? zh : {};

export function localized(): boolean {
  return Object.keys(dict).length > 0;
}

/** Text for `english`, with `{0}`/`{1}` placeholders filled from `args`. */
export function t(english: string, ...args: Array<string | number>): string {
  let out = dict[english] || english;
  args.forEach((arg, i) => {
    out = out.split(`{${i}}`).join(String(arg));
  });
  return out;
}
