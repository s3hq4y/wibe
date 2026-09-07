const fs = require("fs");
const path = require("path");

const guiDir = path.resolve(__dirname, "..", "gui");
const builtAssets = path.join(guiDir, "dist", "assets");
const extensionAssets = path.join(guiDir, "assets");

if (!fs.existsSync(builtAssets)) {
  throw new Error("GUI build output is missing: " + builtAssets);
}

fs.rmSync(extensionAssets, { recursive: true, force: true });

// Copy the built webview assets but drop source maps: they are ~24MB of
// dev-only artifacts. .vscodeignore already keeps *.map out of the VSIX, so
// this only prevents them from cluttering the working tree / build folder.
const SKIP_EXTENSIONS = new Set([".map"]);

function copyDirFiltered(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirFiltered(s, d);
    } else if (!SKIP_EXTENSIONS.has(path.extname(entry.name))) {
      fs.copyFileSync(s, d);
    }
  }
}

copyDirFiltered(builtAssets, extensionAssets);
console.log("Copied GUI assets to " + extensionAssets + " (source maps excluded)");
