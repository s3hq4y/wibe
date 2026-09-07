#!/usr/bin/env node
/**
 * @file Rebrand the flattened Continue copy into the standalone "incontrol" extension.
 *
 * Why a codemod instead of hand edits: the identity is referenced from ~80 files
 * (command ids, config keys, context keys, view ids, menu `when` clauses) and this
 * has to be re-applied mechanically every time the folder is re-synced from upstream.
 *
 * What it renames
 *   extension id          Continue.continue            -> incontrol.incontrol
 *   package name          continue                     -> incontrol
 *   settings namespace    continue.<prop>              -> incontrol.<prop>   (+ EXTENSION_NAME)
 *   commands/views/menus  continue.<id>                -> incontrol.<id>
 *   view ids              continueGUIView/…ConsoleView/continueSubMenu/continueConsole
 *                                                       -> incontrolGUIView/…
 *   workspace settings    "continue" key               -> "incontrol"
 *   global config dir     ~/.continue                  -> ~/.incontrol   (one-time migration copy)
 *   global rc file        .continuerc.json             -> .incontrolrc.json  (legacy still read)
 *   upstream links        repository/bugs/homepage/qna/GITHUB_LINK/DISCUSSIONS_LINK
 *
 * What it deliberately does NOT rename
 *   - Project-local `.continue/` folders and `.continueignore`: these are shared
 *     conventions (JetBrains too) living inside users' repos, and the extension
 *     now reads both. Only the *global* directory under home moves.
 *   - Internal TypeScript identifiers/types from core's public API (ContinueConfig,
 *     ContinueRcJson, ContinueGUIWebviewViewProvider, ...) - cosmetic, high churn.
 *   - The vendored `models/all-MiniLM-L6-v2` assets and `continue_tutorial.py`.
 *
 * Usage: node scripts/rename-identity.js [--dry-run] [--revert]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--dry-run");

const NEW_NAME = "incontrol";
const NEW_PUBLISHER = "incontrol";
const NEW_EXT_ID = `${NEW_PUBLISHER}.${NEW_NAME}`;
const REPO_URL = "https://github.com/s3hq4y/incontrol";

const counts = new Map();
const touched = new Set();

function bump(label, n = 1) {
  counts.set(label, (counts.get(label) || 0) + n);
}

/** Text replacement that records per-rule counts. `to` may be a string or fn. */
function replaceAll(text, label, pairs) {
  let out = text;
  for (const [re, to] of pairs) {
    out = out.replace(re, (...args) => {
      bump(label);
      return typeof to === "function" ? to(...args) : to;
    });
  }
  return out;
}

function writeFileIfChanged(rel, before, after) {
  if (before === after) return;
  touched.add(rel);
  if (!DRY) {
    const eol = before.includes("\r\n") ? "\r\n" : "\n";
    fs.writeFileSync(path.join(ROOT, rel), eol === "\r\n" ? after.replace(/\n/g, "\r\n") : after);
  }
}

function* filesUnder(dir, test) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (["node_modules", "dist", "out", "build", "bin", ".git", "coverage", ".portal"].includes(e.name)) continue;
      yield* filesUnder(rel, test);
    } else if (test.test(e.name)) {
      yield rel;
    }
  }
}

const ID_RULES = [
  // extension id and ids derived from it - must run before the generic prefix rule
  [/\bdev\.continue\.continue\b/g, `dev.${NEW_PUBLISHER}.${NEW_NAME}`],
  [/\bextension-output-Continue\.continue\b/g, `extension-output-${NEW_EXT_ID}`],
  [/\b(?:Continue|continue)\.continue\b(?![A-Za-z])/g, NEW_EXT_ID],
  // quoted id literals: "continue.foo" / 'continue.foo' / `continue.foo`
  [/(['"`])continue\.(?=[A-Za-z])/g, (m, q) => `${q}${NEW_NAME}.`],
  // `when` clauses: config.continue.foo, onView:continueGUIView
  [/\bconfig\.continue\.(?=[A-Za-z])/g, `config.${NEW_NAME}.`],
  [/\bonView:continue(?=[A-Za-z])/g, `onView:${NEW_NAME}`],
  // view / container / submenu ids
  [/\bcontinueGUIView\b/g, `${NEW_NAME}GUIView`],
  [/\bcontinueConsoleView\b/g, `${NEW_NAME}ConsoleView`],
  [/\bcontinueSubMenu\b/g, `${NEW_NAME}SubMenu`],
  [/\bcontinueConsole\b/g, `${NEW_NAME}Console`],
];

/** Rules for the string-literal scan of source files. */
function renameIdsInSource(rel) {
  const before = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const after = replaceAll(before, `ids:${rel.split("/")[0]}`, ID_RULES);
  writeFileIfChanged(rel, before, after);
}

// ---------------------------------------------------------------------------
// 1. package.json (JSON-aware: identity + generated rc schema filename)
// ---------------------------------------------------------------------------
/**
 * Rewrite the manifest through the parsed JSON: a text-level regex cannot tell
 * `"publisher": "Continue"` from prose, and identity fields must not be lost.
 * Formatting is normalised to 2-space JSON, which is what npm/`vsce` produce.
 */
const VALUE_RULES = [
  // ids and id-shaped strings: "continue.acceptDiff" -> "incontrol.acceptDiff"
  [/^continue\.(?=[A-Za-z])/g, `${NEW_NAME}.`],
  [/\b(?:Continue|continue)\.continue\b(?![A-Za-z])/g, NEW_EXT_ID],
  [/\bdev\.continue\.continue\b/g, `dev.${NEW_PUBLISHER}.${NEW_NAME}`],
  [/\bextension-output-Continue\.continue\b/g, `extension-output-${NEW_EXT_ID}`],
  [/\bconfig\.continue\.(?=[A-Za-z])/g, `config.${NEW_NAME}.`],
  [/\bonView:continue(?=[A-Za-z])/g, `onView:${NEW_NAME}`],
  [/\bcontinueGUIView\b/g, `${NEW_NAME}GUIView`],
  [/\bcontinueConsoleView\b/g, `${NEW_NAME}ConsoleView`],
  [/\bcontinueSubMenu\b/g, `${NEW_NAME}SubMenu`],
  [/\bcontinueConsole\b/g, `${NEW_NAME}Console`],
];

function mapManifestValue(value, key) {
  let out = replaceAll(value, "package.json:ids", VALUE_RULES);
  if (key === "when") {
    out = out.replace(/\bcontinue\.(?=[A-Za-z])/g, `${NEW_NAME}.`);
  }
  if (key === "fileMatch") {
    out = out
      .replace(/\.continue\*/g, `.${NEW_NAME}*`)
      .replace(/\.continuerc\.json/g, `.${NEW_NAME}rc.json`);
  }
  if (key === "url") {
    out = out.replace("continue_rc_schema.json", `${NEW_NAME}_rc_schema.json`);
  }
  if (["title", "name", "label", "category", "group"].includes(key)) {
    if (out === "Continue") out = NEW_NAME;
    else if (out === "Continue Console") out = `${NEW_NAME} Console`;
  }
  return out;
}

function mapManifestKeys(obj, parentKey) {
  if (typeof obj === "string") return mapManifestValue(obj, parentKey);
  if (Array.isArray(obj)) return obj.map((item) => mapManifestKeys(item, parentKey));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      let nextKey = key;
      if (parentKey === "views" && key === "continue") nextKey = NEW_NAME;
      else if (parentKey === "views" && key === "continueConsole") nextKey = `${NEW_NAME}Console`;
      else if (parentKey === "properties" && key.startsWith("continue.")) {
        nextKey = `${NEW_NAME}.${key.slice("continue.".length)}`;
      } else if (parentKey === "menus" || parentKey === "submenus") {
        nextKey = replaceAll(key, "package.json:ids", VALUE_RULES);
      } else if (parentKey === "filenames") {
        nextKey = key.replace(".continuerc.json", `.${NEW_NAME}rc.json`);
      }
      out[nextKey] = mapManifestKeys(value, key);
    }
    return out;
  }
  return obj;
}

function rewritePackageJson() {
  const rel = "package.json";
  const before = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const pkg = JSON.parse(before);

  pkg.name = NEW_NAME;
  pkg.publisher = NEW_PUBLISHER;
  pkg.displayName = NEW_NAME;
  pkg.description =
    "Local AI agent for VS Code - chat, agent, inline edit and autocomplete against your own models and config.";
  pkg.author = { name: NEW_NAME };
  pkg.repository = { type: "git", url: REPO_URL };
  pkg.bugs = { url: `${REPO_URL}/issues` };
  pkg.homepage = REPO_URL;
  delete pkg.qna;
  delete pkg.badges;
  pkg.categories = ["AI", "Chat", "Programming Languages", "Snippets"];
  pkg.keywords = ["ai", "agent", "chat", "autocomplete", "edit", "mcp"];
  pkg.contributes = mapManifestKeys(pkg.contributes, "contributes");
  pkg.activationEvents = mapManifestKeys(pkg.activationEvents, "activationEvents");
  // The e2e harness installs the locally built vsix by name and opts into a
  // throwaway config dir through the (renamed) environment variable.
  for (const [key, value] of Object.entries(pkg.scripts ?? {})) {
    if (typeof value !== "string") continue;
    const next = value
      .replace(/\.\/e2e\/vsix\/continue\.vsix/g, `./e2e/vsix/${NEW_NAME}.vsix`)
      .replace(/\bCONTINUE_GLOBAL_DIR=/g, "INCONTROL_GLOBAL_DIR=");
    if (next !== value) {
      pkg.scripts[key] = next;
      bump("package.json:scripts");
    }
  }
  // Privacy policy of this fork: no upstream hub, so the (already deprecated)
  // editor setting defaults to off and says so.
  const telemetryProp =
    pkg.contributes?.configuration?.properties?.[`${NEW_NAME}.telemetryEnabled`];
  if (telemetryProp) {
    telemetryProp.default = false;
    telemetryProp.markdownDescription =
      `Anonymous usage data is not sent anywhere by this build - there is no upstream hub to receive it. Leave this off unless you run your own ${NEW_NAME} Hub and point \`serverSettings.telemetryUri\` at it.`;
    bump("package.json:telemetry-default-off");
  }

  bump("package.json:identity");

  // Self-checks: the manifest must be internally consistent on its own.
  const problems = [];
  if (pkg.contributes.views[NEW_NAME] === undefined) {
    problems.push(`contributes.views.${NEW_NAME} missing`);
  }
  const settings = Object.keys(pkg.contributes.configuration.properties);
  for (const key of settings) {
    if (!key.startsWith(`${NEW_NAME}.`)) problems.push(`setting not renamed: ${key}`);
  }
  const commandIds = pkg.contributes.commands.map((c) => c.command);
  for (const id of commandIds) {
    if (!id.startsWith(`${NEW_NAME}.`)) problems.push(`command not renamed: ${id}`);
  }
  for (const [scope, entries] of Object.entries(pkg.contributes.menus)) {
    for (const entry of entries) {
      if (entry.command && commandIds.includes(entry.command)) continue;
      if (entry.submenu && pkg.contributes.menus[entry.submenu]) continue;
      if (entry.command || entry.submenu) {
        problems.push(`menu ${scope} references unknown item ${entry.submenu || entry.command}`);
      }
    }
  }
  const viewIds = Object.values(pkg.contributes.views)
    .flat()
    .map((v) => v.id);
  const json = JSON.stringify(pkg, null, 2) + "\n";
  const whenRefs = [...json.matchAll(/"(?:view|activeWebviewPanelId) == ([^"]+)"/g)].map((m) => m[1]);
  for (const ref of whenRefs) {
    if (!viewIds.includes(ref)) problems.push(`when-clause references unknown view ${ref}`);
  }
  // Upstream docs links are deliberately kept: they still describe this exact
  // config file format, and nothing here talks to continuedev any more.
  const ALLOWED_DOCS_HOSTS = ["docs.continue.dev", "hub.continue.dev", "continue.dev"];
  for (const hit of json.match(/[^"\s]*continue\.[A-Za-z]+/g) || []) {
    if (!ALLOWED_DOCS_HOSTS.some((a) => hit.includes(a))) {
      problems.push(`stale upstream id in manifest: ${hit}`);
    }
  }
  if (problems.length && !DRY) {
    throw new Error(`package.json rewrite incomplete:\n  ${problems.join("\n  ")}`);
  }
  if (problems.length) {
    console.warn(`[dry-run] ${problems.length} manifest problems:\n  ${problems.join("\n  ")}`);
  }
  writeFileIfChanged(rel, before, json);
}

const UPSTREAM_GLOBAL_DIR_BLOCK = "const CONTINUE_GLOBAL_DIR = (() => {\n  const configPath = process.env.CONTINUE_GLOBAL_DIR;\n  if (configPath) {\n    // Convert relative path to absolute paths based on current working directory\n    return path.isAbsolute(configPath)\n      ? configPath\n      : path.resolve(process.cwd(), configPath);\n  }\n  return path.join(os.homedir(), \".continue\");\n})();";
const NEW_GLOBAL_DIR_BLOCK = "export const GLOBAL_DIR_NAME = \".incontrol\";\n/** Directory used by Continue before this fork was rebranded; only read for migration. */\nconst LEGACY_GLOBAL_DIR_NAME = \".continue\";\n\n/**\n * Continue kept everything under `~/.continue`, including multi-gigabyte\n * codebase indexes. On first start of the rebranded extension only the small,\n * hand-edited configuration files are copied into `~/.incontrol` - indexes and\n * installed dependencies are deliberately left behind and rebuilt on demand.\n * Nothing in the new location is ever overwritten, and `~/.continue` is kept\n * untouched so the previous editor keeps working.\n */\nconst MIGRATED_DIRS = [\"prompts\", \"rules\"];\nconst MAX_MIGRATED_FILE_BYTES = 4 * 1024 * 1024;\n\nfunction migrateLegacyGlobalDir(targetDir: string): void {\n  try {\n    const legacyDir = path.join(os.homedir(), LEGACY_GLOBAL_DIR_NAME);\n    if (!fs.existsSync(legacyDir)) {\n      return;\n    }\n    let migrated = 0;\n    for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {\n      const from = path.join(legacyDir, entry.name);\n      const to = path.join(targetDir, entry.name);\n      if (entry.isDirectory() && MIGRATED_DIRS.includes(entry.name)) {\n        if (!fs.existsSync(to)) {\n          fs.cpSync(from, to, { recursive: true });\n          migrated++;\n        }\n      } else if (entry.isFile()) {\n        if (fs.existsSync(to)) {\n          continue;\n        }\n        if (fs.statSync(from).size > MAX_MIGRATED_FILE_BYTES) {\n          continue;\n        }\n        fs.mkdirSync(targetDir, { recursive: true });\n        fs.copyFileSync(from, to);\n        migrated++;\n      }\n    }\n    if (migrated > 0) {\n      console.log(\n        `[incontrol] Copied ${migrated} file(s) from ${legacyDir} to ${targetDir}`,\n      );\n    }\n  } catch (error) {\n    console.warn(\n      `[incontrol] Could not migrate the legacy config directory: ${error}`,\n    );\n  }\n}\n\nconst CONTINUE_GLOBAL_DIR = (() => {\n  const configPath =\n    process.env.INCONTROL_GLOBAL_DIR || process.env.CONTINUE_GLOBAL_DIR;\n  if (configPath) {\n    // Convert relative path to absolute paths based on current working directory\n    return path.isAbsolute(configPath)\n      ? configPath\n      : path.resolve(process.cwd(), configPath);\n  }\n  const target = path.join(os.homedir(), GLOBAL_DIR_NAME);\n  migrateLegacyGlobalDir(target);\n  return target;\n})();";

// ---------------------------------------------------------------------------
// 2. targeted patches: single-point constants, global dir, watchers
// ---------------------------------------------------------------------------
function patch(rel, label, pairs, { expect = 1 } = {}) {
  const before = fs.readFileSync(path.join(ROOT, rel), "utf8");
  let after = before;
  for (const [from, to] of pairs) {
    if (typeof from === "string") {
      if (!after.includes(from)) {
        // Re-running after the change was already applied must be a no-op.
        if (after.includes(to)) continue;
        throw new Error(`${label}: expected pattern not found in ${rel}: ${from.slice(0, 80)}`);
      }
      after = after.split(from).join(to);
    } else {
      const n = (after.match(from) || []).length;
      if (n < expect) {
        if (typeof to === "string" && after.includes(to)) continue;
        throw new Error(`${label}: expected >=${expect} matches of ${from} in ${rel}, got ${n}`);
      }
      after = after.replace(from, to);
    }
  }
  bump(label);
  writeFileIfChanged(rel, before, after);
}

/**
 * `core/util/paths.ts` is where the global config directory is decided. Replaces
 * the upstream block wholesale so this stays re-appliable after a re-sync.
 * Migration only copies the small, hand-written config files: `~/.continue`
 * also holds multi-GB indexes, which must not be copied synchronously.
 */
function patchGlobalDir() {
  const rel = "core/util/paths.ts";
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  if (!text.includes(UPSTREAM_GLOBAL_DIR_BLOCK)) {
    if (text.includes(NEW_GLOBAL_DIR_BLOCK)) return; // already applied
    throw new Error(
      "globalDir: neither the upstream nor the rebranded CONTINUE_GLOBAL_DIR block is present - re-port by hand",
    );
  }
  writeFileIfChanged(
    rel,
    text,
    text.replace(UPSTREAM_GLOBAL_DIR_BLOCK, NEW_GLOBAL_DIR_BLOCK),
  );
  patch(rel, "globalDir", [
    [
      '  const continuercPath = path.join(getContinueGlobalPath(), ".continuerc.json");',
      `  const continuercPath = path.join(getContinueGlobalPath(), ".incontrolrc.json");
  // Read a pre-rebrand .continuerc.json if that is what the user has.
  const legacyRcPath = path.join(getContinueGlobalPath(), ".continuerc.json");
  if (!fs.existsSync(continuercPath) && fs.existsSync(legacyRcPath)) {
    return legacyRcPath;
  }`,
    ],
    ['name: "continue-config",', `name: "incontrol-config",`],
    [`description: "My Continue Configuration",`, `description: "My incontrol Configuration",`],
  ]);
}

function targetedPatches() {
  // core's single point for the settings namespace + upstream issue/discussion links
  patch("core/util/constants.ts", "constants", [
    ['export const EXTENSION_NAME = "continue";', `export const EXTENSION_NAME = "${NEW_NAME}";`],
    [
      'export const GITHUB_LINK =\n  "https://github.com/continuedev/continue/issues/new/choose";',
      `export const GITHUB_LINK = "${REPO_URL}/issues";`,
    ],
    [
      'export const DISCUSSIONS_LINK =\n  "https://github.com/continuedev/continue/discussions";',
      `export const DISCUSSIONS_LINK = "${REPO_URL}/issues";`,
    ],
  ]);

  // workspace settings key (read from .vscode/settings.json)
  patch("src/util/workspaceConfig.ts", "workspaceKey", [
    ['export const CONTINUE_WORKSPACE_KEY = "continue";', `export const CONTINUE_WORKSPACE_KEY = "${NEW_NAME}";`],
  ]);

  // global config directory + env var + rc filename + one-time migration
  patchGlobalDir();



  // watchers/ predicates must recognise BOTH the new global dir and legacy/workspace .continue
  patch("core/config/loadLocalAssistants.ts", "watchers", [
    [
      '  return (\n    uri.endsWith(".continuerc.json") ||',
      '  return (\n    uri.endsWith(".incontrolrc.json") ||\n    uri.endsWith(".continuerc.json") ||',
    ],
    [
      '    (uri.includes(".continue") &&\n      (uri.endsWith(".yaml") ||\n        uri.endsWith(".yml") ||\n        uri.endsWith(".json"))',
      '    ((uri.includes(".continue") || uri.includes(".incontrol")) &&\n      (uri.endsWith(".yaml") ||\n        uri.endsWith(".yml") ||\n        uri.endsWith(".json"))',
    ],
    [
      "      uri.includes(`.continue/${blockType}`),",
      "      uri.includes(`.continue/${blockType}`) ||\n        uri.includes(`.incontrol/${blockType}`),",
    ],
    [
      "    normalizedUri.includes(`/.continue/agents/`) ||\n    normalizedUri.includes(`/.continue/assistants/`) ||\n    normalizedUri.includes(`/.continue/configs/`)",
      "    [\"agents\", \"assistants\", \"configs\"].some(\n      (sub) =>\n        normalizedUri.includes(`/.continue/${sub}/`) ||\n        normalizedUri.includes(`/.incontrol/${sub}/`),\n    )",
    ],
  ]);

  patch("core/config/json/loadRcConfigs.ts", "watchers", [
    [
      '              entry[0].endsWith(".continuerc.json"),',
      '              entry[0].endsWith(".incontrolrc.json") ||\n                entry[0].endsWith(".continuerc.json"),',
    ],
  ]);

  patch("core/llm/rules/getSystemMessageWithRules.ts", "watchers", [
    [
      '  return !rule.sourceFile || rule.sourceFile.includes(".continue/"); // sourceFile path is absolute - hence we need to check for it in between',
      '  // sourceFile path is absolute - hence we need to check for the dir name in between.\n  // Both the rebranded global dir (~/.incontrol) and the project convention (.continue) count.\n  return (\n    !rule.sourceFile ||\n    rule.sourceFile.includes(".continue/") ||\n    rule.sourceFile.includes(".incontrol/")\n  );',
    ],
  ]);

  // courtesy esbuild lookup used the literal ~/.continue path
  patch("core/config/load.ts", "esbuildLookup", [
    [
      '      const userEsbuild = path.join(\n        os.homedir(),\n        ".continue",\n        "node_modules",\n        "esbuild",\n      );',
      '      const userEsbuild = path.join(\n        os.homedir(),\n        ".incontrol",\n        "node_modules",\n        "esbuild",\n      );',
    ],
    [
      '  const installCmd = "npm i esbuild@x.x.x --prefix ~/.continue";',
      '  const installCmd = "npm i esbuild@x.x.x --prefix ~/.incontrol";',
    ],
  ]);

  // src CodeLens providers gate on config-path substrings: accept both dir names
  patch("src/lang-server/codeLens/providers/ConfigJsonConverterCodeLensProvider.ts", "codelens", [
    [
      '!document.uri.fsPath.includes(".continue") ||',
      '!/\\.(continue|incontrol)/.test(document.uri.fsPath) ||',
    ],
  ]);
  patch("src/lang-server/codeLens/providers/DownloadYamlExtensionCodeLensProvider.ts", "codelens", [
    [
      'if (!document.uri.fsPath.includes(".continue")) {',
      'if (!/\\.(continue|incontrol)/.test(document.uri.fsPath)) {',
    ],
  ]);
}

// ---------------------------------------------------------------------------
// 3. prepackage + build scripts must use the new generated schema name
// ---------------------------------------------------------------------------
function patchBuildScripts() {
  patch("scripts/prepackage-standalone.js", "prepackage", [
    [/"continue_rc_schema.json"/g, `"${NEW_NAME}_rc_schema.json"`],
    ["continue_rc_schema.json", `${NEW_NAME}_rc_schema.json`],
  ]);
  // The e2e harness (e2e/) has been removed from this fork.
}

// ---------------------------------------------------------------------------
// 4. GUI copy - only the standalone brand word inside user-visible strings
// ---------------------------------------------------------------------------
/**
 * Verbatim "Continue" occurrences that are the verb (Resume generation,
 * "Continue your response", "Continue Anyway", error page) are deliberately
 * left alone; comments, identifiers and upstream docs links are too.
 */
function brandGui() {
  patch("media/move-chat-panel-right.md", "gui-copy", [
    "![Move Continue to right sidebar]",
    "![Move incontrol to right sidebar]",
  ]);
  patch("gui/src/components/dialogs/FeedbackDialog.tsx", "gui-copy", [
    ["<span>Help us improve Continue</span>", `<span>Help us improve ${NEW_NAME}</span>`],
    ["We're always working to make Continue better", `We're always working to make ${NEW_NAME} better`],
  ]);
  patch("gui/src/pages/config/features/indexing/IndexingProgress.tsx", "gui-copy", [
    ["'Continue: Force Codebase Re-Indexing'", `'${NEW_NAME}: Force Codebase Re-Indexing'`],
  ]);
  for (const rel of [
    "gui/src/pages/config/features/keyboard/KeyboardShortcuts.tsx",
    "gui/src/pages/config/sections/HelpSection.tsx",
  ]) {
    patch(rel, "gui-copy", [[/Close Continue Sidebar/g, `Close ${NEW_NAME} Sidebar`]], {
      expect: 4,
    });
  }
  patch("gui/src/pages/config/sections/HelpSection.tsx", "gui-copy", [
    ['description="Learn how to configure and use Continue"', `description="Learn how to configure and use ${NEW_NAME}"`],
  ]);
  patch("gui/src/pages/config/sections/UserSettingsSection.tsx", "gui-copy", [
    ['description=" Continue will not attempt', `description=" ${NEW_NAME} will not attempt`],
  ]);
  patch("gui/src/pages/gui/ToolCallDiv/MCPAppRenderer.tsx", "gui-copy", [
    ['{ name: "Continue", version: "1.0.0" }', `{ name: "${NEW_NAME}", version: "1.0.0" }`],
    ['"[Continue] Failed to connect bridge', `"[${NEW_NAME}] Failed to connect bridge`],
  ]);
  patch("gui/src/pages/gui/ToolCallDiv/ToolCallStatusMessage.tsx", "gui-copy", [
    ["{`Continue ${intro} ${message}`}", "{`" + NEW_NAME + " ${intro} ${message}`}"],
  ]);
}

// ---------------------------------------------------------------------------
function main() {
  rewritePackageJson();
  targetedPatches();
  patchBuildScripts();
  brandGui();

  const dirs = ["src"];
  for (const dir of dirs) {
    for (const rel of filesUnder(dir, /\.(ts|tsx|js|cjs)$/)) renameIdsInSource(rel);
  }
  // core files that carry vscode-facing ids (config prop names in docs, etc.)
  for (const rel of filesUnder("core", /\.(ts|tsx)$/)) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (/["'`]continue\.[A-Za-z]/.test(text)) renameIdsInSource(rel);
  }

  const summary = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${DRY ? "[dry-run] " : ""}files touched: ${touched.size}`);
  for (const [label, n] of summary) console.log(`  ${String(n).padStart(5)}  ${label}`);

  // residual check
  const residual = [];
  for (const dir of ["src", "package.json"]) {
    const abs = path.join(ROOT, dir);
    const list = fs.statSync(abs).isDirectory() ? [...filesUnder(dir, /\.(ts|tsx|json)$/)] : ["package.json"];
    for (const rel of list) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      for (const line of text.split(/\r?\n/)) {
        if (/["'`]continue\.[A-Za-z]/.test(line) || /Continue\.continue/.test(line)) {
          residual.push(`${rel}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
  }
  console.log(`\nresidual upstream ids: ${residual.length}`);
  residual.slice(0, 20).forEach((r) => console.log("  " + r));
}

main();
