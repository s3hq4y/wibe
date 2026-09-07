import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

/**
 * Locate a ripgrep binary without shipping one in the VSIX.
 *
 * VS Code itself bundles ripgrep (its own search box uses it), so the extension
 * host can reuse that copy. Depending on the VS Code version the package is
 * either `@vscode/ripgrep-universal` (1.10x+, one `bin/<os>-<arch>/rg` per
 * platform) or the older `@vscode/ripgrep` (`bin/rg`). As a last resort a `rg`
 * found on PATH is used. The result is cached for the lifetime of the
 * extension host.
 */

let cached: string | null | undefined;

export class RipgrepNotFoundError extends Error {
  constructor() {
    super(
      "ripgrep was not found. incontrol reuses the copy that ships with VS Code " +
        "(resources/app/node_modules/@vscode/ripgrep-universal) or an `rg` on PATH; " +
        "neither is available in this environment, so @search is unavailable.",
    );
    this.name = "RipgrepNotFoundError";
  }
}

function candidatePaths(): string[] {
  const exe = process.platform === "win32" ? "rg.exe" : "rg";
  const nodeModules = path.join(vscode.env.appRoot, "node_modules");
  const arch = process.arch;
  const candidates = [
    // VS Code >= ~1.104 (universal package, one folder per platform)
    path.join(
      nodeModules,
      "@vscode",
      "ripgrep-universal",
      "bin",
      `${process.platform}-${arch}`,
      exe,
    ),
    // Older VS Code builds
    path.join(nodeModules, "@vscode", "ripgrep", "bin", exe),
    // Same two locations when node_modules is packed into an asar archive
    path.join(
      vscode.env.appRoot,
      "node_modules.asar.unpacked",
      "@vscode",
      "ripgrep-universal",
      "bin",
      `${process.platform}-${arch}`,
      exe,
    ),
    path.join(
      vscode.env.appRoot,
      "node_modules.asar.unpacked",
      "@vscode",
      "ripgrep",
      "bin",
      exe,
    ),
  ];

  // A user-installed ripgrep on PATH
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (dir) {
      candidates.push(path.join(dir, exe));
    }
  }
  return candidates;
}

function isExecutableFile(p: string): boolean {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform !== "win32") {
      fs.accessSync(p, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/** Returns the resolved ripgrep path, or `null` when none is available. */
export function findRipgrep(): string | null {
  if (cached !== undefined) {
    return cached;
  }
  cached = candidatePaths().find(isExecutableFile) ?? null;
  if (cached) {
    console.log(`[incontrol] using ripgrep at ${cached}`);
  } else {
    console.warn(
      "[incontrol] no ripgrep binary found; @search will be unavailable",
    );
  }
  return cached;
}

/** Like {@link findRipgrep} but throws a {@link RipgrepNotFoundError}. */
export function requireRipgrep(): string {
  const rg = findRipgrep();
  if (!rg) {
    throw new RipgrepNotFoundError();
  }
  return rg;
}
