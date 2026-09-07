import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as URI from "uri-js";
import * as YAML from "yaml";

import { ConfigYaml, DevEventName } from "@incontrol/config-yaml";
import * as JSONC from "comment-json";
import dotenv from "dotenv";

import { IdeType, SerializedIncontrolConfig } from "../";
import { defaultConfig } from "../config/default";
import Types from "../config/types";

dotenv.config();

export function setConfigFilePermissions(filePath: string): void {
  try {
    if (os.platform() !== "win32") {
      fs.chmodSync(filePath, 0o600);
    }
  } catch (error) {
    console.warn(`Failed to set permissions on ${filePath}:`, error);
  }
}

export const GLOBAL_DIR_NAME = ".incontrol";
/** Directory used by Continue before this fork was rebranded; only read for migration. */
const LEGACY_GLOBAL_DIR_NAME = ".continue";

/**
 * Workspace-level configuration folder (rules/, prompts/, agents/,
 * mcpServers/, skills/, ...). Was ".continue" before the rebrand; legacy
 * ".continue" folders inside workspaces are still accepted by the path
 * predicates for compatibility, but everything new is created here.
 */
export const WORKSPACE_CONFIG_DIR_NAME = ".incontrol";
/** Pre-rebrand workspace config folder, still accepted by the predicates. */
export const LEGACY_WORKSPACE_CONFIG_DIR_NAME = ".continue";

/**
 * Upstream Continue kept everything under `~/.continue`, including multi-gigabyte
 * codebase indexes. On first start of the rebranded extension only the small,
 * hand-edited configuration files are copied into `~/.incontrol` - indexes and
 * installed dependencies are deliberately left behind and rebuilt on demand.
 * Nothing in the new location is ever overwritten, and `~/.continue` is kept
 * untouched so the previous editor keeps working.
 */
const MIGRATED_DIRS = ["prompts", "rules"];
const MAX_MIGRATED_FILE_BYTES = 4 * 1024 * 1024;

function migrateLegacyGlobalDir(targetDir: string): void {
  try {
    const legacyDir = path.join(os.homedir(), LEGACY_GLOBAL_DIR_NAME);
    if (!fs.existsSync(legacyDir)) {
      return;
    }
    let migrated = 0;
    for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
      const from = path.join(legacyDir, entry.name);
      const to = path.join(targetDir, entry.name);
      if (entry.isDirectory() && MIGRATED_DIRS.includes(entry.name)) {
        if (!fs.existsSync(to)) {
          fs.cpSync(from, to, { recursive: true });
          migrated++;
        }
      } else if (entry.isFile()) {
        if (fs.existsSync(to)) {
          continue;
        }
        if (fs.statSync(from).size > MAX_MIGRATED_FILE_BYTES) {
          continue;
        }
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(from, to);
        migrated++;
      }
    }
    if (migrated > 0) {
      console.log(
        `[incontrol] Copied ${migrated} file(s) from ${legacyDir} to ${targetDir}`,
      );
    }
  } catch (error) {
    console.warn(
      `[incontrol] Could not migrate the legacy config directory: ${error}`,
    );
  }
}

const INCONTROL_GLOBAL_DIR = (() => {
  const configPath =
    process.env.INCONTROL_GLOBAL_DIR || process.env.CONTINUE_GLOBAL_DIR;
  if (configPath) {
    // Convert relative path to absolute paths based on current working directory
    return path.isAbsolute(configPath)
      ? configPath
      : path.resolve(process.cwd(), configPath);
  }
  const target = path.join(os.homedir(), GLOBAL_DIR_NAME);
  migrateLegacyGlobalDir(target);
  return target;
})();

// export const DEFAULT_CONFIG_TS_CONTENTS = `import { Config } from "./types"\n\nexport function modifyConfig(config: Config): Config {
//   return config;
// }`;

export const DEFAULT_CONFIG_TS_CONTENTS = `export function modifyConfig(config: Config): Config {
  return config;
}`;

export function getChromiumPath(): string {
  return path.join(getIncontrolUtilsPath(), ".chromium-browser-snapshots");
}

export function getIncontrolUtilsPath(): string {
  const utilsPath = path.join(getIncontrolGlobalPath(), ".utils");
  if (!fs.existsSync(utilsPath)) {
    fs.mkdirSync(utilsPath);
  }
  return utilsPath;
}

export function getGlobalIncontrolIgnorePath(): string {
  const incontrolIgnorePath = path.join(
    getIncontrolGlobalPath(),
    ".incontrolignore",
  );
  if (!fs.existsSync(incontrolIgnorePath)) {
    fs.writeFileSync(incontrolIgnorePath, "");
  }
  return incontrolIgnorePath;
}

export function getIncontrolGlobalPath(): string {
  const incontrolPath = INCONTROL_GLOBAL_DIR;
  if (!fs.existsSync(incontrolPath)) {
    fs.mkdirSync(incontrolPath);
  }
  return incontrolPath;
}

export function getSessionsFolderPath(): string {
  const sessionsPath = path.join(getIncontrolGlobalPath(), "sessions");
  if (!fs.existsSync(sessionsPath)) {
    fs.mkdirSync(sessionsPath);
  }
  return sessionsPath;
}

export function getIndexFolderPath(): string {
  const indexPath = path.join(getIncontrolGlobalPath(), "index");
  if (!fs.existsSync(indexPath)) {
    fs.mkdirSync(indexPath);
  }
  return indexPath;
}

export function getGlobalContextFilePath(): string {
  return path.join(getIndexFolderPath(), "globalContext.json");
}

export function getSharedConfigFilePath(): string {
  return path.join(getIncontrolGlobalPath(), "sharedConfig.json");
}

export function getSessionFilePath(sessionId: string): string {
  return path.join(getSessionsFolderPath(), `${sessionId}.json`);
}

export function getSessionsListPath(): string {
  const filepath = path.join(getSessionsFolderPath(), "sessions.json");
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, JSON.stringify([]));
  }
  return filepath;
}

export function getConfigJsonPath(): string {
  const p = path.join(getIncontrolGlobalPath(), "config.json");
  return p;
}

export function getConfigYamlPath(ideType?: IdeType): string {
  const p = path.join(getIncontrolGlobalPath(), "config.yaml");
  const exists = fs.existsSync(p);
  const isEmpty = exists && fs.readFileSync(p, "utf8").trim() === "";
  const needsCreation = !exists && !fs.existsSync(getConfigJsonPath());

  if (needsCreation || isEmpty) {
    fs.writeFileSync(p, YAML.stringify(defaultConfig));
    setConfigFilePermissions(p);
  }
  return p;
}

export function getPrimaryConfigFilePath(): string {
  const configYamlPath = getConfigYamlPath();
  if (fs.existsSync(configYamlPath)) {
    return configYamlPath;
  }
  return getConfigJsonPath();
}

export function getConfigTsPath(): string {
  const p = path.join(getIncontrolGlobalPath(), "config.ts");
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, DEFAULT_CONFIG_TS_CONTENTS);
  }

  const typesPath = path.join(getIncontrolGlobalPath(), "types");
  if (!fs.existsSync(typesPath)) {
    fs.mkdirSync(typesPath);
  }
  const corePath = path.join(typesPath, "core");
  if (!fs.existsSync(corePath)) {
    fs.mkdirSync(corePath);
  }
  const packageJsonPath = path.join(getIncontrolGlobalPath(), "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: "incontrol-config",
        version: "1.0.0",
        description: "My incontrol Configuration",
        main: "config.js",
      }),
    );
  }

  fs.writeFileSync(path.join(corePath, "index.d.ts"), Types);
  return p;
}

export function getConfigJsPath(): string {
  // Do not create automatically
  return path.join(getIncontrolGlobalPath(), "out", "config.js");
}

export function getTsConfigPath(): string {
  const tsConfigPath = path.join(getIncontrolGlobalPath(), "tsconfig.json");
  if (!fs.existsSync(tsConfigPath)) {
    fs.writeFileSync(
      tsConfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            useDefineForClassFields: true,
            lib: ["DOM", "DOM.Iterable", "ESNext"],
            allowJs: true,
            skipLibCheck: true,
            esModuleInterop: false,
            allowSyntheticDefaultImports: true,
            strict: true,
            forceConsistentCasingInFileNames: true,
            module: "System",
            moduleResolution: "Node",
            noEmit: false,
            noEmitOnError: false,
            outFile: "./out/config.js",
            typeRoots: ["./node_modules/@types", "./types"],
          },
          include: ["./config.ts"],
        },
        null,
        2,
      ),
    );
  }
  return tsConfigPath;
}

export function getIncontrolRcPath(): string {
  // Disable indexing of the config folder to prevent infinite loops
  const incontrolRcPath = path.join(getIncontrolGlobalPath(), ".incontrolrc.json");
  // Read a pre-rebrand .continuerc.json if that is what the user has.
  const legacyRcPath = path.join(getIncontrolGlobalPath(), ".continuerc.json");
  if (!fs.existsSync(incontrolRcPath) && fs.existsSync(legacyRcPath)) {
    return legacyRcPath;
  }
  if (!fs.existsSync(incontrolRcPath)) {
    fs.writeFileSync(
      incontrolRcPath,
      JSON.stringify(
        {
          disableIndexing: true,
        },
        null,
        2,
      ),
    );
  }
  return incontrolRcPath;
}

function getDevDataPath(): string {
  const sPath = path.join(getIncontrolGlobalPath(), "dev_data");
  if (!fs.existsSync(sPath)) {
    fs.mkdirSync(sPath);
  }
  return sPath;
}

export function getDevDataSqlitePath(): string {
  return path.join(getDevDataPath(), "devdata.sqlite");
}

export function getDevDataFilePath(
  eventName: DevEventName,
  schema: string,
): string {
  const versionPath = path.join(getDevDataPath(), schema);
  if (!fs.existsSync(versionPath)) {
    fs.mkdirSync(versionPath);
  }
  return path.join(versionPath, `${String(eventName)}.jsonl`);
}

function editConfigJson(
  callback: (config: SerializedIncontrolConfig) => SerializedIncontrolConfig,
): void {
  const config = fs.readFileSync(getConfigJsonPath(), "utf8");
  let configJson = JSONC.parse(config);
  // Check if it's an object
  if (typeof configJson === "object" && configJson !== null) {
    configJson = callback(configJson as any) as any;
    fs.writeFileSync(getConfigJsonPath(), JSONC.stringify(configJson, null, 2));
  } else {
    console.warn("config.json is not a valid object");
  }
}

function editConfigYaml(callback: (config: ConfigYaml) => ConfigYaml): void {
  const configPath = getConfigYamlPath();
  const config = fs.readFileSync(configPath, "utf8");
  let configYaml = YAML.parse(config);
  // Check if it's an object
  if (typeof configYaml === "object" && configYaml !== null) {
    configYaml = callback(configYaml as any) as any;
    fs.writeFileSync(configPath, YAML.stringify(configYaml));
    setConfigFilePermissions(configPath);
  } else {
    console.warn("config.yaml is not a valid object");
  }
}

export function editConfigFile(
  configJsonCallback: (
    config: SerializedIncontrolConfig,
  ) => SerializedIncontrolConfig,
  configYamlCallback: (config: ConfigYaml) => ConfigYaml,
): void {
  if (fs.existsSync(getConfigYamlPath())) {
    editConfigYaml(configYamlCallback);
  } else if (fs.existsSync(getConfigJsonPath())) {
    editConfigJson(configJsonCallback);
  }
}

function getMigrationsFolderPath(): string {
  const migrationsPath = path.join(getIncontrolGlobalPath(), ".migrations");
  if (!fs.existsSync(migrationsPath)) {
    fs.mkdirSync(migrationsPath);
  }
  return migrationsPath;
}

export async function migrate(
  id: string,
  callback: () => void | Promise<void>,
  onAlreadyComplete?: () => void,
) {
  if (process.env.NODE_ENV === "test") {
    return await Promise.resolve(callback());
  }

  const migrationsPath = getMigrationsFolderPath();
  const migrationPath = path.join(migrationsPath, id);

  if (!fs.existsSync(migrationPath)) {
    try {
      console.log(`Running migration: ${id}`);

      fs.writeFileSync(migrationPath, "");
      await Promise.resolve(callback());
    } catch (e) {
      console.warn(`Migration ${id} failed`, e);
    }
  } else if (onAlreadyComplete) {
    onAlreadyComplete();
  }
}

export function getTabAutocompleteCacheSqlitePath(): string {
  return path.join(getIndexFolderPath(), "autocompleteCache.sqlite");
}

export function getRemoteConfigsFolderPath(): string {
  const dir = path.join(getIncontrolGlobalPath(), ".configs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  return dir;
}

export function getPathToRemoteConfig(remoteConfigServerUrl: string): string {
  let url: URL | undefined = undefined;
  try {
    url =
      typeof remoteConfigServerUrl !== "string" || remoteConfigServerUrl === ""
        ? undefined
        : new URL(remoteConfigServerUrl);
  } catch (e) {}
  const dir = path.join(getRemoteConfigsFolderPath(), url?.hostname ?? "None");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  return dir;
}

export function getConfigJsonPathForRemote(
  remoteConfigServerUrl: string,
): string {
  return path.join(getPathToRemoteConfig(remoteConfigServerUrl), "config.json");
}

export function getConfigJsPathForRemote(
  remoteConfigServerUrl: string,
): string {
  return path.join(getPathToRemoteConfig(remoteConfigServerUrl), "config.js");
}

export function getIncontrolDotEnv(): { [key: string]: string } {
  const filepath = path.join(getIncontrolGlobalPath(), ".env");
  if (fs.existsSync(filepath)) {
    return dotenv.parse(fs.readFileSync(filepath));
  }
  return {};
}

export function getLogsDirPath(): string {
  const logsPath = path.join(getIncontrolGlobalPath(), "logs");
  if (!fs.existsSync(logsPath)) {
    fs.mkdirSync(logsPath);
  }
  return logsPath;
}

export function getCoreLogsPath(): string {
  return path.join(getLogsDirPath(), "core.log");
}

export function getPromptLogsPath(): string {
  return path.join(getLogsDirPath(), "prompt.log");
}

export function getGlobalFolderWithName(name: string): string {
  return path.join(getIncontrolGlobalPath(), name);
}

export function getGlobalPromptsPath(): string {
  return getGlobalFolderWithName("prompts");
}

export function readAllGlobalPromptFiles(
  folderPath: string = getGlobalPromptsPath(),
): { path: string; content: string }[] {
  if (!fs.existsSync(folderPath)) {
    return [];
  }
  const files = fs.readdirSync(folderPath);
  const promptFiles: { path: string; content: string }[] = [];
  files.forEach((file) => {
    const filepath = path.join(folderPath, file);
    const stats = fs.statSync(filepath);

    if (stats.isDirectory()) {
      const nestedPromptFiles = readAllGlobalPromptFiles(filepath);
      promptFiles.push(...nestedPromptFiles);
    } else if (file.endsWith(".prompt")) {
      const content = fs.readFileSync(filepath, "utf8");
      promptFiles.push({ path: filepath, content });
    }
  });

  return promptFiles;
}

export function getRepoMapFilePath(): string {
  return path.join(getIncontrolUtilsPath(), "repo_map.txt");
}

export function getEsbuildBinaryPath(): string {
  return path.join(getIncontrolUtilsPath(), "esbuild");
}

export function migrateV1DevDataFiles() {
  const devDataPath = getDevDataPath();
  function moveToV1FolderIfExists(
    oldFileName: string,
    newFileName: DevEventName,
  ) {
    const oldFilePath = path.join(devDataPath, `${oldFileName}.jsonl`);
    if (fs.existsSync(oldFilePath)) {
      const newFilePath = getDevDataFilePath(newFileName, "0.1.0");
      if (!fs.existsSync(newFilePath)) {
        fs.copyFileSync(oldFilePath, newFilePath);
        fs.unlinkSync(oldFilePath);
      }
    }
  }
  moveToV1FolderIfExists("tokens_generated", "tokensGenerated");
  moveToV1FolderIfExists("chat", "chatFeedback");
  moveToV1FolderIfExists("quickEdit", "quickEdit");
  moveToV1FolderIfExists("autocomplete", "autocomplete");
}

export function getLocalEnvironmentDotFilePath(): string {
  return path.join(getIncontrolGlobalPath(), ".local");
}

export function getStagingEnvironmentDotFilePath(): string {
  return path.join(getIncontrolGlobalPath(), ".staging");
}

export function getDiffsDirectoryPath(): string {
  const diffsPath = path.join(getIncontrolGlobalPath(), ".diffs"); // .replace(/^C:/, "c:"); ??
  if (!fs.existsSync(diffsPath)) {
    fs.mkdirSync(diffsPath, {
      recursive: true,
    });
  }
  return diffsPath;
}

export const isFileWithinFolder = (
  fileUri: string,
  folderPath: string,
): boolean => {
  try {
    if (!fileUri || !folderPath) {
      return false;
    }

    const fileUriParsed = URI.parse(fileUri);
    const fileScheme = fileUriParsed.scheme || "file";
    let filePath = fileUriParsed.path || "";
    filePath = decodeURIComponent(filePath);

    let folderWithScheme = folderPath;
    if (!folderPath.includes("://")) {
      folderWithScheme = `${fileScheme}://${folderPath.startsWith("/") ? "" : "/"}${folderPath}`;
    }
    const folderUriParsed = URI.parse(folderWithScheme);

    let folderPathClean = folderUriParsed.path || "";
    folderPathClean = decodeURIComponent(folderPathClean);

    filePath = filePath.replace(/\/$/, "");
    folderPathClean = folderPathClean.replace(/\/$/, "");

    return (
      filePath === folderPathClean || filePath.startsWith(`${folderPathClean}/`)
    );
  } catch (error) {
    console.error("Error in isFileWithinFolder:", error);
    return false;
  }
};
