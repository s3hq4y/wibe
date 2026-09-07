const fs = require("fs");
const path = require("path");

const incontrolDir = path.join(__dirname, "..");

// Embeds the build time into the extension (imported by src/extension.ts).
function writeBuildTimestamp() {
  fs.writeFileSync(
    path.join(incontrolDir, "src/.buildTimestamp.ts"),
    `export default "${new Date().toISOString()}";\n`,
  );
}

/**
 * core/ is bundled from the root node_modules (node_modules/core -> ./core;
 * npm hoists core's dependencies to the root). Running "npm install" inside
 * core/ creates a second, complete dependency tree there; esbuild then resolves
 * core's imports from core/node_modules first and bundles every package the
 * two trees share (zod, the AWS/Bedrock SDK, yaml, ws, ...) twice - about
 * 2.5 MB of dead weight in extension.js. npm only writes the hidden lockfile
 * node_modules/.package-lock.json at the directory an install was run in, so
 * its presence under core/ is the exact signature of that mistake (packages
 * that npm nests under core/node_modules to resolve version conflicts do not
 * create it).
 */
function assertNoStandaloneCoreInstall() {
  const coreModules = path.join(incontrolDir, "core", "node_modules");
  const hiddenLock = path.join(coreModules, ".package-lock.json");
  if (
    fs.existsSync(hiddenLock) &&
    process.env.ALLOW_CORE_NODE_MODULES !== "true"
  ) {
    throw new Error(
      `${hiddenLock} exists: "npm install" was run inside core/. Dependencies ` +
        `must be installed only at the extension root, otherwise every shared ` +
        `package is bundled twice. Delete ${coreModules} and rebuild ` +
        `(ALLOW_CORE_NODE_MODULES=true overrides this check).`,
    );
  }
}

module.exports = {
  incontrolDir,
  writeBuildTimestamp,
  assertNoStandaloneCoreInstall,
};
