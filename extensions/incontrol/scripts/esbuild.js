const fs = require("fs");
const path = require("path");

const {
  assertNoStandaloneCoreInstall,
  writeBuildTimestamp,
} = require("./utils");

const esbuild = require("esbuild");

const flags = process.argv.slice(2);

// Production builds (--minify, used by vscode:prepublish) externalize the
// ~670KB llama tokenizer vocabulary: it is shipped verbatim as
// out/llamaTokenizer.mjs anyway (copied there by prepackage-standalone.js for
// the worker pool), and prepackage also builds a CJS version
// (out/llamaTokenizer.cjs) the bundle requires instead, so the vocabulary is
// not bundled a second time. Watch/dev builds keep it inlined (no populated
// out/ folder needed) for a smoother debugger experience.
const isProdBuild = flags.includes("--minify");

const esbuildConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  // sqlite3 is aliased to @vscode/sqlite3, a native module. Native addons
  // cannot be bundled: keep them external so they resolve at runtime from
  // node_modules, where the prebuilt vscode-sqlite3.node lives.
  external: isProdBuild
    ? ["vscode", "esbuild", "./xhr-sync-worker.js", "./llamaTokenizer.cjs", "sqlite3", "@vscode/sqlite3"]
    : ["vscode", "esbuild", "./xhr-sync-worker.js", "sqlite3", "@vscode/sqlite3"],
  format: "cjs",
  platform: "node",
  sourcemap: flags.includes("--sourcemap"),
  minify: flags.includes("--minify"),
  loader: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ".node": "file",
  },

  // To allow import.meta.path for transformers.js
  // https://github.com/evanw/esbuild/issues/1492#issuecomment-893144483
  inject: ["./scripts/importMetaUrl.js"],
  define: { "import.meta.url": "importMetaUrl" },
  supported: { "dynamic-import": false },
  metafile: true,
  plugins: [
    // Redirect the main-thread tokenizer import to the external CJS build in
    // production builds (the worker pool keeps importing ./llamaTokenizer.mjs
    // directly; it runs out of out/ where both files live).
    {
      name: "external-llama-tokenizer",
      setup(build) {
        if (!isProdBuild) {
          return;
        }
        build.onResolve({ filter: /llamaTokenizer\.js$/ }, (args) => {
          if (args.kind === "import-statement") {
            return { path: "./llamaTokenizer.cjs", external: true };
          }
          return undefined;
        });
      },
    },
    {
      name: "on-end-plugin",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            console.error("Build failed with errors:", result.errors);
            throw new Error(result.errors);
          } else {
            try {
              fs.mkdirSync("./build", { recursive: true });
              fs.writeFileSync(
                "./build/meta.json",
                JSON.stringify(result.metafile, null, 2),
              );
            } catch (e) {
              console.error("Failed to write esbuild meta file", e);
            }
            // esbuild's ".node" file-loader emits win-ca's BOTH crypt32-ia32
            // and crypt32-x64 bindings into out/. The ia32 binding can never
            // load in a win32-x64 (or non-Windows) extension host, so drop it
            // to keep the VSIX small.
            try {
              for (const outFile of fs.readdirSync("./out")) {
                if (/^crypt32-ia32.*\.node$/.test(outFile)) {
                  fs.rmSync(path.join("./out", outFile), { force: true });
                  console.log(
                    `Removed non-target native binary: out/${outFile}`,
                  );
                }
              }
            } catch (e) {
              console.error("Failed to clean ia32 native binary", e);
            }
            console.log("VS Code Extension esbuild complete"); // used verbatim in vscode tasks to detect completion
          }
        });
      },
    },
  ],
};

void (async () => {
  // A stray core/node_modules would silently double the bundle; fail early.
  assertNoStandaloneCoreInstall();
  // Create .buildTimestamp.js before starting the first build
  writeBuildTimestamp();
  // Bundles the extension into one file
  if (flags.includes("--watch")) {
    const ctx = await esbuild.context(esbuildConfig);
    await ctx.watch();
  } else if (flags.includes("--notify")) {
    const inFile = esbuildConfig.entryPoints[0];
    const outFile = esbuildConfig.outfile;

    // The watcher automatically notices changes to source files
    // so the only thing it needs to be notified about is if the
    // output file gets removed.
    if (fs.existsSync(outFile)) {
      console.log("VS Code Extension esbuild up to date");
      return;
    }

    fs.watchFile(outFile, (current, previous) => {
      if (current.size > 0) {
        console.log("VS Code Extension esbuild rebuild complete");
        fs.unwatchFile(outFile);
        process.exit(0);
      }
    });

    console.log("Triggering VS Code Extension esbuild rebuild...");
    writeBuildTimestamp();
  } else {
    await esbuild.build(esbuildConfig);
  }
})();
