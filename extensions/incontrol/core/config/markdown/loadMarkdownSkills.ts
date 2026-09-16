import * as fs from "fs";
import * as path from "path";
import {
  ConfigValidationError,
  parseMarkdownRule,
  sanitizeRuleName,
} from "@incontrol/config-yaml";
import z from "zod";
import { IDE, Skill } from "../..";
import { walkDir } from "../../indexing/walkDir";
import { localPathToUri, localPathOrUriToPath } from "../../util/pathToUri";
import {
  getGlobalFolderWithName,
  WORKSPACE_CONFIG_DIR_NAME,
} from "../../util/paths";
import { findUriInDirs, joinPathsToUri } from "../../util/uri";
import { getAllDotIncontrolDefinitionFiles } from "../loadLocalAssistants";
import {
  CODEBLOCK_FORMATTING_INSTRUCTIONS,
  EDIT_CODE_INSTRUCTIONS,
} from "../../llm/defaultSystemMessages";
import { getStaticToolDocs } from "../../tools/toolUsageDocs";
import { getToolUsageGuides } from "../../tools/toolUsageGuides";
import { NO_PARALLEL_TOOL_CALLING_INSTRUCTION } from "../../tools/constants";

const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const SKILLS_DIR = "skills";

function getDisabledSkillsFilePath(): string {
  return path.join(getGlobalFolderWithName(SKILLS_DIR), ".disabled.json");
}

function readDisabledSkills(): string[] {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(getDisabledSkillsFilePath(), "utf8"),
    );
    return Array.isArray(parsed)
      ? parsed.filter((n): n is string => typeof n === "string")
      : [];
  } catch {
    return [];
  }
}

/** Persist which skills the read_skill tool should ignore. */
export function setSkillDisabled(name: string, disabled: boolean): void {
  const current = readDisabledSkills();
  const next = disabled
    ? Array.from(new Set([...current, name]))
    : current.filter((n) => n !== name);
  const file = getDisabledSkillsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
}

/** Guards the write/delete messages: only SKILL.md files inside a skills dir. */
export function isSkillFileUri(uri: string): boolean {
  const normalized = uri.replace(/\\/g, "/");
  return normalized.endsWith("/SKILL.md") && normalized.includes("/skills/");
}

export async function createSkillFile(
  ide: IDE,
  name: string,
  description?: string,
  scope: "global" | "workspace" = "global",
): Promise<string> {
  const safeName = sanitizeRuleName(name);
  const baseDir =
    scope === "global"
      ? localPathToUri(getGlobalFolderWithName(SKILLS_DIR))
      : joinPathsToUri(
        (await ide.getWorkspaceDirs())[0],
        WORKSPACE_CONFIG_DIR_NAME,
        SKILLS_DIR,
      );

  const dir = joinPathsToUri(baseDir, safeName);
  const fileUri = joinPathsToUri(dir, "SKILL.md");
  if (await ide.fileExists(fileUri)) {
    throw new Error(`A skill named "${safeName}" already exists`);
  }

  const skillDescription = description?.trim() || name;
  const content = `---
name: ${safeName}
description: ${skillDescription}
---

Describe how to perform this skill.
`;
  await ide.writeFile(fileUri, content);
  return fileUri;
}

/**
 * Get skills from .claude/skills directory
 */
async function getClaudeSkillsDir(ide: IDE) {
  const fullDirs = (await ide.getWorkspaceDirs()).map((dir) =>
    joinPathsToUri(dir, ".claude", SKILLS_DIR),
  );

  fullDirs.push(localPathToUri(getGlobalFolderWithName(SKILLS_DIR)));

  return (
    await Promise.all(
      fullDirs.map(async (dir) => {
        const exists = await ide.fileExists(dir);
        if (!exists) return [];
        const uris = await walkDir(dir, ide, {
          source: "get .claude skills files",
        });
        // filter markdown files only
        return uris.filter((uri) => uri.endsWith(".md"));
      }),
    )
  ).flat();
}

/**
 * Two discovery paths walk the same folders: the `.incontrol`/`.continue`
 * definition-file scan and `getClaudeSkillsDir` both include the global skills
 * directory, so a single SKILL.md (the seeded `tool-usage` skill in particular)
 * was reported twice. Collapse URIs that point at the same file, keeping the
 * first sighting.
 */
export function dedupeSkillFilesByPath(fileUris: string[]): string[] {
  const seen = new Set<string>();
  return fileUris.filter((fileUri) => {
    const key = getSkillFileDedupeKey(fileUri);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getSkillFileDedupeKey(fileUri: string): string {
  let localPath = fileUri.trim();
  try {
    localPath = localPathOrUriToPath(localPath);
  } catch {
    // Keep the original spelling and normalize below.
  }
  localPath = localPath.replace(/\\/g, "/");
  try {
    localPath = decodeURIComponent(localPath);
  } catch {
    // Ignore malformed percent-encoding.
  }
  localPath = localPath.replace(/^file:\/\//i, "");
  // fileURL-style Windows paths look like /C:/Users/...
  if (/^\/[a-zA-Z]:/.test(localPath)) {
    localPath = localPath.slice(1);
  }
  return localPath.replace(/\/+$/, "").toLowerCase();
}

const BUNDLED_TOOL_USAGE_SKILL_NAME = "tool-usage";

/** Bump to re-seed the bundled skill over an older copy on existing installs. */
const BUNDLED_TOOL_USAGE_VERSION = 4;

function getBundledVersionPath(): string {
  return path.join(getGlobalFolderWithName(SKILLS_DIR), ".bundled-version.json");
}

function readBundledVersion(): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(getBundledVersionPath(), "utf8"));
    return typeof parsed?.toolUsage === "number" ? parsed.toolUsage : 0;
  } catch {
    return 0;
  }
}

function writeBundledVersion(): void {
  try {
    const file = getBundledVersionPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ toolUsage: BUNDLED_TOOL_USAGE_VERSION }, null, 2),
    );
  } catch (error) {
    console.error("Failed to record bundled skill version:", error);
  }
}

function getBundledTombstonesPath(): string {
  return path.join(
    getGlobalFolderWithName(SKILLS_DIR),
    ".bundled-deleted.json",
  );
}

function readBundledTombstones(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(getBundledTombstonesPath(), "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter((n): n is string => typeof n === "string")
      : [];
  } catch {
    return [];
  }
}

/** Tombstone a bundled skill when the user deletes it, so it stays deleted. */
export function markBundledSkillDeleted(fileUri: string): void {
  const marker = `/skills/${BUNDLED_TOOL_USAGE_SKILL_NAME}/SKILL.md`;
  if (!fileUri.replace(/\\/g, "/").endsWith(marker)) {
    return;
  }
  const tombstones = readBundledTombstones();
  if (tombstones.includes(BUNDLED_TOOL_USAGE_SKILL_NAME)) {
    return;
  }
  try {
    const file = getBundledTombstonesPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        Array.from(new Set([...tombstones, BUNDLED_TOOL_USAGE_SKILL_NAME])),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Failed to record bundled skill tombstone:", error);
  }
}

/** Strip the shared indentation the shared instruction constants carry. */
function dedent(text: string): string {
  const lines = text.split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^[ \t]*/)![0].length);
  const strip = indents.length > 0 ? Math.min(...indents) : 0;
  return lines
    .map((line) => line.slice(strip))
    .join("\n")
    .trim();
}

function buildToolUsageSkillContent(): string {
  const guides = getToolUsageGuides()
    .map((guide) => `## ${guide.title}\n\n${guide.body}`)
    .join("\n\n");

  const toolSections = Object.entries(getStaticToolDocs())
    .map(([name, doc]) => `### ${name}\n\n${doc}`)
    .join("\n\n");

  return `---
name: ${BUNDLED_TOOL_USAGE_SKILL_NAME}
description: Full usage documentation for the built-in tools (reading, search, editing formats, terminal, web, rules) and code presentation conventions. Read this before using a tool whose brief description is unclear.
---

# Built-in tool usage guide

How to work in this editor: read before you edit, search before you guess, verify after you change. Which tools exist in a session varies with the user's configuration and the model, so never call a name that is not in your tool list.

${guides}

## Code presentation

${dedent(CODEBLOCK_FORMATTING_INSTRUCTIONS)}

${dedent(EDIT_CODE_INSTRUCTIONS)}

## Tool calling etiquette

- If you need multiple pieces of information, call multiple read-only tools simultaneously.
- ${NO_PARALLEL_TOOL_CALLING_INSTRUCTION} (applies to the edit tools).

## Tool reference

Full description of every built-in tool, for lookup by name:

${toolSections}

The \`read_skill\` tool lists currently available skills in its description; call it with a skill name to read the full instructions.
`;
}

/** Seed the bundled "tool-usage" skill, re-seeding when its version changes. */
export function seedBundledSkills(): void {
  if (readBundledTombstones().includes(BUNDLED_TOOL_USAGE_SKILL_NAME)) {
    return;
  }
  const skillDir = path.join(
    getGlobalFolderWithName(SKILLS_DIR),
    BUNDLED_TOOL_USAGE_SKILL_NAME,
  );
  const skillFile = path.join(skillDir, "SKILL.md");
  if (
    fs.existsSync(skillFile) &&
    readBundledVersion() >= BUNDLED_TOOL_USAGE_VERSION
  ) {
    return;
  }
  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillFile, buildToolUsageSkillContent());
    writeBundledVersion();
  } catch (error) {
    console.error("Failed to seed bundled skill:", error);
  }
}

export async function loadMarkdownSkills(ide: IDE) {
  seedBundledSkills();
  const errors: ConfigValidationError[] = [];
  const skills: Skill[] = [];
  const disabledNames = new Set(readDisabledSkills());

  try {
    const yamlAndMarkdownFileUris = [
      ...(
        await getAllDotIncontrolDefinitionFiles(
          ide,
          {
            includeGlobal: true,
            includeWorkspace: true,
            fileExtType: "markdown",
          },
          SKILLS_DIR,
        )
      ).map((file) => file.path),
      ...(await getClaudeSkillsDir(ide)),
    ];

    const skillFiles = dedupeSkillFilesByPath(
      yamlAndMarkdownFileUris.filter((path) => path.endsWith("SKILL.md")),
    );

    const workspaceDirs = await ide.getWorkspaceDirs();
    for (const fileUri of skillFiles) {
      try {
        const content = await ide.readFile(fileUri);
        const { frontmatter, markdown } = parseMarkdownRule(
          content,
        ) as unknown as { frontmatter: Skill; markdown: string };

        const validatedFrontmatter = skillFrontmatterSchema.parse(frontmatter);

        const filesInSkillsDirectory = (
          await walkDir(fileUri.substring(0, fileUri.lastIndexOf("/")), ide, {
            source: "get skill files",
          })
        )
          // do not include SKILL.md as it is already in content
          .filter((file) => !file.endsWith("SKILL.md"));

        const foundRelativeUri = findUriInDirs(fileUri, workspaceDirs);

        skills.push({
          ...validatedFrontmatter,
          content: markdown,
          path: foundRelativeUri.foundInDir
            ? foundRelativeUri.relativePathOrBasename
            : fileUri,
          files: filesInSkillsDirectory,
          fileUri,
          rawContent: content,
          disabled: disabledNames.has(validatedFrontmatter.name),
        });
      } catch (error) {
        errors.push({
          fatal: false,
          message: `Failed to parse markdown skill file: ${error instanceof Error ? error.message : error}`,
        });
      }
    }
  } catch (err) {
    errors.push({
      fatal: false,
      message: `Error loading markdown skill files: ${err instanceof Error ? err.message : err}`,
    });
  }

  // Path-normalization can still miss two spellings of the same file; collapse
  // identical skill names so the settings page never lists "tool-usage" twice.
  const seenNames = new Set<string>();
  const uniqueSkills: Skill[] = [];
  for (const skill of skills) {
    const nameKey = skill.name.trim().toLowerCase();
    if (seenNames.has(nameKey)) {
      continue;
    }
    seenNames.add(nameKey);
    uniqueSkills.push(skill);
  }

  return { skills: uniqueSkills, errors };
}
