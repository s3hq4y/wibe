/**
 * @file prepackage for the "flattened" standalone layout of this folder.
 *
 * The upstream `scripts/prepackage.js` assumes the Continue monorepo layout:
 *   <repo>/extensions/vscode   <- this folder
 *   <repo>/core, <repo>/gui, <repo>/packages
 * That assumption breaks here (`chdir .../extensions/vscode: ENOENT`), because
 * this copy is self-contained: `core/`, `gui/` and `packages/` live *inside* the
 * extension root, and core's runtime dependencies are hoisted into this
 * folder's own `node_modules`.
 *
 * This script performs the same preparation steps with paths that match that
 * layout, and additionally downloads the prebuilt sqlite3 native binding that
 * the packaged extension needs but that is not committed.
 *
 * Usage:
 *   node scripts/prepackage-standalone.js [--target win32-x64]
 *
 * Env overrides:
 *   SKIP_GUI_BUILD=true   never run the vite build, only sync gui/dist
 *   SKIP_DOWNLOADS=true   do not fetch the sqlite3 prebuilt binding
 *   SKIP_VALIDATE=true    skip the final "all files present" check
 *
 * Note: LanceDB, the local embedding model, the @docs crawler stack, the
 * textmate-syntaxes bundle and the bundled ripgrep binary are no longer part
 * of the extension (@search reuses the ripgrep that ships with VS Code).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ncp = require("ncp").ncp;
const { rimrafSync } = require("rimraf");

const {
  validateFilesPresent,
  execCmdSync,
  autodetectPlatformAndArch,
} = require("./shared-util");
const {
  assertNoStandaloneCoreInstall,
  writeBuildTimestamp,
} = require("./utils");

const vscodeDir = path.resolve(__dirname, "..");
process.chdir(vscodeDir);

const exists = (p) => fs.existsSync(p);

function firstExisting(candidates, what) {
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Could not locate ${what}. Looked in:\n- ${candidates
      .filter(Boolean)
      .join("\n- ")}`,
  );
}

// core/ and gui/ are vendored in this layout; keep the monorepo fallbacks so
// the script still works if it is ever moved back.
const coreDir = firstExisting(
  [
    path.join(vscodeDir, "core"),
    path.join(vscodeDir, "..", "..", "core"),
  ],
  "the core/ directory",
);
const guiDir = path.join(vscodeDir, "gui");
const guiDist = path.join(guiDir, "dist");

// Native/prebuilt dependencies are normally resolved from core's node_modules
// in the monorepo; here they are hoisted to the extension's node_modules.
const moduleDirs = [
  path.join(vscodeDir, "node_modules"),
  path.join(coreDir, "node_modules"),
].filter(exists);

function modulePath(name) {
  for (const dir of moduleDirs) {
    const candidate = path.join(dir, name);
    if (exists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Cannot find "${name}" in ${moduleDirs.join(" or ")}. Run "npm install" first.`,
  );
}

// ---- target detection (same rules as the monorepo script) ------------------
let target;
const targetFlagIndex = process.argv.indexOf("--target");
if (targetFlagIndex !== -1) {
  target = process.argv[targetFlagIndex + 1];
}
if (!target) {
  const envTarget =
    process.env.CONTINUE_VSCODE_TARGET ||
    process.env.CONTINUE_BUILD_TARGET ||
    process.env.VSCODE_TARGET;
  if (envTarget && typeof envTarget === "string") {
    target = envTarget.trim();
  }
}

let os;
let arch;
if (target) {
  [os, arch] = target.split("-");
} else {
  [os, arch] = autodetectPlatformAndArch();
}
if (os === "alpine") {
  os = "linux";
}
if (arch === "armhf") {
  arch = "arm64";
}
target = `${os}-${arch}`;

const isWinTarget = target.startsWith("win");
const isLinuxTarget = target.startsWith("linux");
const isMacTarget = target.startsWith("darwin");

console.log(`[info] Extension dir: ${vscodeDir}`);
console.log(`[info] core dir:      ${coreDir}`);
console.log(`[info] Using target:  ${target}`);

// ---- helpers --------------------------------------------------------------
function copyDir(src, dest, label) {
  if (!exists(src)) {
    throw new Error(
      `Missing ${label || src} - cannot package. Expected it at ${src}`,
    );
  }
  fs.mkdirSync(dest, { recursive: true });
  return new Promise((resolve, reject) => {
    ncp(src, dest, { dereference: true }, (error) => {
      if (error) {
        reject(new Error(`Error copying ${src} -> ${dest}: ${error}`));
        return;
      }
      console.log(`[info] Copied ${label || path.relative(vscodeDir, dest)}`);
      resolve();
    });
  });
}

function copyFile(src, dest) {
  if (!exists(src)) {
    throw new Error(`Missing ${src} - cannot package`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[info] Copied ${path.basename(dest)}`);
}

function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log(`[info] Downloading ${url}`);
  execSync(`curl -fsSL -L -o "${dest}" "${url}"`, { stdio: "inherit" });
}

/**
 * Make sure node_modules/sqlite3 has a native build for this platform, and
 * return the sqlite3 package directory.
 */
async function ensureSqlite3Build() {
  const sqlite3Dir = modulePath("sqlite3");
  const binding = path.join(sqlite3Dir, "build", "Release", "node_sqlite3.node");
  if (exists(binding)) {
    console.log("[info] sqlite3 native binding already present");
    return sqlite3Dir;
  }
  if (process.env.SKIP_DOWNLOADS === "true") {
    throw new Error(
      `sqlite3 native binding is missing at ${binding} and SKIP_DOWNLOADS=true`,
    );
  }
  console.log("[info] Downloading the pre-built sqlite3 binary");
  // node-sqlite3 publishes napi-v6 builds for 5.1.7; napi-v3 is kept as a
  // fallback for the targets where that is what was published.
  const urls = [
    `https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v6-${target}.tar.gz`,
    `https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v3-${target}.tar.gz`,
  ];
  if (target === "win32-arm64") {
    // no prebuilt upstream for win32-arm64
    urls.unshift(
      "https://continue-server-binaries.s3.us-west-1.amazonaws.com/win32-arm64/node_sqlite3.tar.gz",
    );
  }
  const archive = path.join(sqlite3Dir, "build.tar.gz");
  let downloaded = false;
  for (const url of urls) {
    try {
      download(url, archive);
      downloaded = true;
      break;
    } catch (e) {
      console.warn(`[warn] Could not download ${url}: ${e.message}`);
    }
  }
  if (!downloaded) {
    throw new Error("Failed to download a pre-built sqlite3 binary");
  }
  execSync(`tar -xzf build.tar.gz`, { stdio: "inherit", cwd: sqlite3Dir });
  fs.unlinkSync(archive);
  if (exists(path.join(sqlite3Dir, "build.tar.gz"))) {
    fs.rmSync(path.join(sqlite3Dir, "build.tar.gz"), { force: true });
  }
  if (!exists(binding)) {
    throw new Error(
      `sqlite3 extraction did not produce ${binding}. Contents: ${fs
        .readdirSync(path.join(sqlite3Dir, "build"))
        .join(", ")}`,
    );
  }
  return sqlite3Dir;
}

function writeIncontrolRcSchema() {
  // Mirrors copyConfigSchema() from scripts/generate-copy-config.js, minus the
  // JetBrains copies (there is no extensions/intellij in this layout).
  const schema = JSON.parse(
    fs.readFileSync(path.join(vscodeDir, "config_schema.json"), "utf8"),
  );
  schema.$defs.SerializedIncontrolConfig.properties.mergeBehavior = {
    type: "string",
    enum: ["merge", "overwrite"],
    default: "merge",
    title: "Merge behavior",
    markdownDescription:
      "If set to 'merge', .incontrolrc.json will be applied on top of config.json (arrays and objects are merged). If set to 'overwrite', then every top-level property of .incontrolrc.json will overwrite that property from config.json.",
  };
  fs.writeFileSync(
    path.join(vscodeDir, "incontrol_rc_schema.json"),
    JSON.stringify(schema, null, 2),
  );
  console.log("[info] Wrote incontrol_rc_schema.json");
}

function generateConfigYamlSchema() {
  const configYamlDir = path.join(vscodeDir, "packages", "config-yaml");
  const generator = path.join(configYamlDir, "dist", "scripts", "generateJsonSchema.js");
  const out = path.join(vscodeDir, "config-yaml-schema.json");
  if (!exists(generator)) {
    console.warn(
      `[warn] packages/config-yaml is not built (${path.relative(
        vscodeDir,
        generator,
      )} missing) - skipping config-yaml-schema.json. Run "npm --prefix packages/config-yaml run build" to generate it.`,
    );
    if (!exists(out)) {
      fs.writeFileSync(out, JSON.stringify({ $schema: "http://json-schema.org/draft-07/schema#" }, null, 2));
    }
    return;
  }
  execSync(`node "${generator}"`, { stdio: "inherit", cwd: configYamlDir });
  copyFile(
    path.join(configYamlDir, "schema", "config-yaml-schema.json"),
    out,
  );
}

async function syncGui() {
  const builtIndex = path.join(guiDist, "assets", "index.js");
  const builtCss = path.join(guiDist, "assets", "index.css");
  if (!exists(builtIndex) || !exists(builtCss)) {
    if (process.env.SKIP_GUI_BUILD === "true") {
      throw new Error(
        "gui/dist is missing the built assets and SKIP_GUI_BUILD=true was set",
      );
    }
    console.log("[info] gui/dist missing - running the gui build");
    execSync(`npm --prefix "${guiDir}" run build`, {
      stdio: "inherit",
      cwd: vscodeDir,
    });
  }
  if (!exists(builtIndex) || !exists(builtCss)) {
    throw new Error("gui build did not produce dist/assets/index.js|index.css");
  }

  // The webview is loaded from <extension>/gui/assets/index.{js,css} (see
  // src/IncontrolGUIWebviewViewProvider.ts) with <extension>/gui as the
  // webview root, so mirror everything else the built app expects at its
  // root: assets, then the public/ extras (fonts).
  await copyDir(path.join(guiDist, "assets"), path.join(guiDir, "assets"), "gui/assets");
  for (const dir of ["fonts"]) {
    const src = exists(path.join(guiDist, dir))
      ? path.join(guiDist, dir)
      : path.join(guiDir, "public", dir);
    if (exists(src)) {
      await copyDir(src, path.join(guiDir, dir), `gui/${dir}`);
    }
  }
  // Stale copy from earlier builds: the textmate-syntaxes bundle is no longer
  // shipped (nothing in the webview or the extension ever loaded it).
  rimrafSync(path.join(guiDir, "textmate-syntaxes"));
}

async function optimizeTreeSitterWasms() {
  const wasmDir = path.join(vscodeDir, "out", "tree-sitter-wasms");
  if (!exists(wasmDir)) {
    return;
  }
  let wasmOptBin;
  try {
    // binaryen (devDependency) ships wasm-opt as a cross-platform Node script
    // (emscripten JS with the wasm embedded). Locate it via its package.json
    // (the JS API itself is ESM with top-level await, so it is not require-able)
    // and invoke it through the current node executable.
    const { execFileSync } = require("child_process");
    const binScript = path.join(
      path.dirname(require.resolve("binaryen/package.json")),
      "bin",
      "wasm-opt",
    );
    if (!fs.existsSync(binScript)) {
      throw new Error(`wasm-opt script not found at ${binScript}`);
    }
    execFileSync(process.execPath, [binScript, "--version"], {
      stdio: "ignore",
    });
    wasmOptBin = binScript;
  } catch {
    console.log(
      "[info] binaryen/wasm-opt not available - skipping tree-sitter wasm optimization",
    );
    return;
  }
  for (const f of fs.readdirSync(wasmDir)) {
    if (!f.endsWith(".wasm")) {
      continue;
    }
    const target = path.join(wasmDir, f);
    const tmp = `${target}.opt.wasm`;
    try {
      const before = fs.statSync(target).size;
      const { execFileSync } = require("child_process");
      execFileSync(process.execPath, [wasmOptBin, "-Oz", target, "-o", tmp], {
        stdio: "inherit",
      });
      const after = fs.statSync(tmp).size;
      if (after > 0 && after < before) {
        fs.rmSync(target, { force: true });
        fs.renameSync(tmp, target);
        console.log(
          `[info] wasm-opt ${f}: ${(before / 1e6).toFixed(2)}MB -> ${(after / 1e6).toFixed(2)}MB`,
        );
      } else {
        fs.rmSync(tmp, { force: true });
      }
    } catch (e) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {}
      console.warn(`[warn] wasm-opt failed for ${f}: ${e.message}`);
    }
  }
}

void (async () => {
  assertNoStandaloneCoreInstall();
  const startTime = Date.now();
  console.log(
    `[info] Packaging extension for target ${target} - started at ${new Date().toISOString()}`,
  );

  writeBuildTimestamp();

  // Clean slate for the folders we populate
  rimrafSync(path.join(vscodeDir, "bin"));
  rimrafSync(path.join(vscodeDir, "out"));
  fs.mkdirSync(path.join(vscodeDir, "out", "node_modules"), { recursive: true });

  await syncGui();

  // tree-sitter wasm queries + runtime
  await copyDir(
    path.join(modulePath("tree-sitter-wasms"), "out"),
    path.join(vscodeDir, "out", "tree-sitter-wasms"),
    "out/tree-sitter-wasms",
  );

  // tree-sitter-wasms ships 36 grammars. core/util/treeSitter.ts can only load
  // a grammar whose name comes out of its `supportedLanguages` table (the wasm
  // path is built as `tree-sitter-${supportedLanguages[ext]}.wasm`), and that
  // table is deliberately limited to the mainstream languages. Everything else is
  // dropped here: the first group has no `LanguageName` entry at all / a broken
  // parser, the second group was removed from `supportedLanguages` because the
  // grammars were cold and large (~1.3MB of compressed VSIX). Keep both lists in
  // sync with `supportedLanguages`.
  const DROPPED_TREE_SITTER_WASMS = [
    // no LanguageName entry / broken parser
    "dart",
    "julia",
    "kotlin",
    "objc",
    "scala",
    "swift",
    "tlaplus",
    "vue",
    "yaml",
    "zig",
    // removed from supportedLanguages (cold, large)
    "c_sharp",
    "elisp",
    "elixir",
    "ocaml",
    "ql",
    "rescript",
    "ruby",
    "solidity",
    "systemrdl",
  ];
  for (const lang of DROPPED_TREE_SITTER_WASMS) {
    fs.rmSync(
      path.join(
        vscodeDir,
        "out",
        "tree-sitter-wasms",
        `tree-sitter-${lang}.wasm`,
      ),
      { force: true },
    );
  }
  copyFile(
    firstExisting(
      [
        path.join(coreDir, "vendor", "tree-sitter.wasm"),
        path.join(modulePath("web-tree-sitter"), "tree-sitter.wasm"),
      ],
      "tree-sitter.wasm",
    ),
    path.join(vscodeDir, "out", "tree-sitter.wasm"),
  );


  // tokenizer workers + ollama helper script, loaded from out/ at runtime
  for (const f of [
    path.join("llm", "llamaTokenizerWorkerPool.mjs"),
    path.join("llm", "llamaTokenizer.mjs"),
    path.join("llm", "tiktokenWorkerPool.mjs"),
    path.join("util", "start_ollama.sh"),
  ]) {
    copyFile(path.join(coreDir, f), path.join(vscodeDir, "out", path.basename(f)));
  }

  // Build the CJS tokenizer used by the production bundle (esbuild
  // externalizes the tokenizer there and requires ./llamaTokenizer.cjs).
  // require() cannot load the .mjs vocabulary on the extension host's
  // Node 18/20, so transpile the self-contained ESM file with the same
  // esbuild that builds the extension. The worker pool script
  // (llamaTokenizerWorkerPool.mjs) keeps importing the .mjs directly.
  try {
    const esbuild = require("esbuild");
    await esbuild.build({
      entryPoints: [path.join(vscodeDir, "out", "llamaTokenizer.mjs")],
      outfile: path.join(vscodeDir, "out", "llamaTokenizer.cjs"),
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node18",
      minify: false,
      legalComments: "none",
      // `export default llamaTokenizer` compiles to a CJS namespace of
      // { __esModule, default: <instance> }. The production bundle requires
      // this file as a real CommonJS module and, with Node interop, treats the
      // whole `module.exports` as the default export - so `.encode()` would be
      // looked up on the namespace object and throw
      // "X.default.encode is not a function". Reassign the CommonJS export to
      // the tokenizer instance so require('./llamaTokenizer.cjs').encode works.
      footer: {
        js: "module.exports = module.exports.default;",
      },
    });
    console.log("[info] Built out/llamaTokenizer.cjs from llamaTokenizer.mjs");
  } catch (e) {
    console.error("[error] Failed to build out/llamaTokenizer.cjs", e);
    throw e;
  }

  // Optimize the tree-sitter wasm grammars (best-effort, skips gracefully when
  // binaryen is unavailable).
  await optimizeTreeSitterWasms();

  // sqlite3 native binding: extension code resolves it relative to out/
  const sqlite3Dir = await ensureSqlite3Build();
  // sqlite3/lib/sqlite3-binding.js does `require('bindings')('node_sqlite3.node')`.
  // `bindings` walks a fixed list of candidate paths under the module root (which
  // is `out/` here) and stops at the first hit:
  //   1. out/build/            (missing)
  //   2. out/build/Debug/      (missing)
  //   3. out/build/Release/  <-- this is what actually loads
  //   ...
  //   7. out/Release/
  // So out/build/Release is always the one that wins; a second copy at out/Release
  // used to be made defensively but is dead weight worth ~0.96MB compressed.
  await copyDir(
    path.join(sqlite3Dir, "build"),
    path.join(vscodeDir, "out", "build"),
    "out/build (sqlite3)",
  );

  // node_modules that the bundled extension.js requires at runtime.
  // (ripgrep is intentionally not here: @search reuses VS Code's own binary.)
  // workerpool is the only npm package required at runtime outside the
  // esbuild bundle: the llamaTokenizer worker script does
  // `import workerpool from "workerpool"`, which resolves via Node from
  // out/node_modules/workerpool. Its package "main" is src/index.js (CommonJS,
  // zero runtime dependencies - the worker script is embedded in
  // src/generated/embeddedWorker.js), so the dist/ bundles, type declarations,
  // source maps and docs are dead weight (~0.5MB). Copy only what is loaded.
  const workerpoolSrc = path.join(vscodeDir, "node_modules", "workerpool");
  if (!exists(workerpoolSrc)) {
    throw new Error(
      `node_modules/workerpool is missing. Run "npm install" in ${vscodeDir} before packaging.`,
    );
  }
  const workerpoolDest = path.join(vscodeDir, "out", "node_modules", "workerpool");
  await copyDir(
    path.join(workerpoolSrc, "src"),
    path.join(workerpoolDest, "src"),
    "out/node_modules/workerpool/src",
  );
  copyFile(
    path.join(workerpoolSrc, "package.json"),
    path.join(workerpoolDest, "package.json"),
  );

  // jsdom worker
  copyFile(
    path.join(modulePath("jsdom"), "lib", "jsdom", "living", "xhr", "xhr-sync-worker.js"),
    path.join(vscodeDir, "out", "xhr-sync-worker.js"),
  );

  // Note: .scm tag-query files for dropped grammars (c_sharp, elisp, elixir,
  // ocaml, ql, ruby, ...) are excluded from the VSIX via .vscodeignore rather
  // than deleted here, so the source tree stays intact.

  // JSON schema contributions referenced from package.json
  writeIncontrolRcSchema();
  try {
    generateConfigYamlSchema();
  } catch (e) {
    console.warn("[warn] Failed to generate config-yaml-schema.json", e.message);
    if (!exists(path.join(vscodeDir, "config-yaml-schema.json"))) {
      fs.writeFileSync(
        path.join(vscodeDir, "config-yaml-schema.json"),
        JSON.stringify({ $schema: "http://json-schema.org/draft-07/schema#" }, null, 2),
      );
    }
  }

  if (process.env.SKIP_VALIDATE === "true") {
    console.log("[info] Skipping file validation (SKIP_VALIDATE=true)");
  } else {
    validateFilesPresent([
      // sidebar webview
      "gui/assets/index.js",
      "gui/assets/index.css",

      // docs + config schemas
      "config_schema.json",
      "incontrol_rc_schema.json",
      "config-yaml-schema.json",

      // out/ runtime files
      "out/tree-sitter.wasm",
      "out/xhr-sync-worker.js",
      "out/build/Release/node_sqlite3.node",

      // out/node_modules
    ]);
  }

  console.log(
    `[timer] Prepackage completed in ${Date.now() - startTime}ms - finished at ${new Date().toISOString()}`,
  );
})().catch((error) => {
  console.error("[error] prepackage failed:", error);
  process.exit(1);
});
