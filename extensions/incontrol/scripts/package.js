const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const version = JSON.parse(
  fs.readFileSync("./package.json", { encoding: "utf-8" }),
).version;

const args = process.argv.slice(2);
let target;

if (args[0] === "--target") {
  target = args[1];
}

if (!fs.existsSync("build")) {
  fs.mkdirSync("build");
}

const isPreRelease = args.includes("--pre-release");

// Generate timestamp in YYYYMMDD-HHMMSS format
const now = new Date();
const timestamp =
  now.getFullYear() +
  String(now.getMonth() + 1).padStart(2, "0") +
  String(now.getDate()).padStart(2, "0") +
  "-" +
  String(now.getHours()).padStart(2, "0") +
  String(now.getMinutes()).padStart(2, "0") +
  String(now.getSeconds()).padStart(2, "0");

const targetSuffix = target ? `-${target}` : "";
const outputFileName = `incontrol${targetSuffix}-${version}-${timestamp}.vsix`;
const outputPath = `./build/${outputFileName}`;

let command = isPreRelease
  ? `npx @vscode/vsce package --out ${outputPath} --pre-release --no-dependencies`
  : `npx @vscode/vsce package --out ${outputPath} --no-dependencies`;

if (target) {
  command += ` --target ${target}`;
}

exec(command, (error) => {
  if (error) {
    throw error;
  }
  console.log(`vsce package completed - extension created at ${outputPath}`);

  // The build/ folder accumulates one multi-MB VSIX per package run.
  // Keep only the freshly built one (plus the esbuild meta/stats artifacts)
  // so old packages do not pile up on disk.
  try {
    const vsixFiles = fs
      .readdirSync("build")
      .filter((f) => f.endsWith(".vsix"))
      .map((f) => ({ f, mtime: fs.statSync(path.join("build", f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const { f } of vsixFiles.slice(1)) {
      fs.rmSync(path.join("build", f), { force: true });
      console.log(`Removed old VSIX package: build/${f}`);
    }
  } catch (e) {
    console.warn("Could not clean old VSIX packages:", e.message);
  }
});
