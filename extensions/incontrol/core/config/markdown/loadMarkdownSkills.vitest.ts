import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

// paths.ts resolves the global folder once at import time, so it has to point
// somewhere disposable before this module (or anything it imports) loads.
const TEST_GLOBAL_DIR = path.join(
  os.tmpdir(),
  `incontrol-skills-dedup-${process.pid}`,
);
process.env.INCONTROL_GLOBAL_DIR = TEST_GLOBAL_DIR;

const { walkDirSpy, definitionFilesSpy } = vi.hoisted(() => ({
  walkDirSpy: vi.fn(async () => [] as string[]),
  definitionFilesSpy: vi.fn(async () => [] as { path: string; content: string }[]),
}));

vi.mock("../../indexing/walkDir", () => ({
  walkDir: walkDirSpy,
  walkDirCache: { invalidate: vi.fn() },
}));
vi.mock("../loadLocalAssistants", () => ({
  getAllDotIncontrolDefinitionFiles: definitionFilesSpy,
}));

const { dedupeSkillFilesByPath, loadMarkdownSkills } = await import(
  "./loadMarkdownSkills"
);
const { localPathToUri } = await import("../../util/pathToUri");

const SKILL_TEMPLATE = (name: string) => `---
name: ${name}
description: Full usage documentation for the built-in tools.
---

# ${name} guide
`;

function writeSkillDir(name: string): string {
  const skillDir = path.join(TEST_GLOBAL_DIR, "skills", name);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillFile, SKILL_TEMPLATE(name));
  return localPathToUri(skillFile);
}

const globalSkillsDirUri = () =>
  localPathToUri(path.join(TEST_GLOBAL_DIR, "skills"));

/**
 * The .incontrol scan is driven through `definitionFilesSpy`; the `.claude`
 * scan goes through walkDir on the global skills directory, which is the same
 * directory - that overlap is the duplicate we are guarding against.
 */
function makeIde(uris: Map<string, string>) {
  return {
    async readFile(uri: string) {
      const content = uris.get(uri);
      if (content === undefined) {
        throw new Error(`unexpected readFile: ${uri}`);
      }
      return content;
    },
    async fileExists(uri: string) {
      return uri === globalSkillsDirUri() || uris.has(uri);
    },
    async getWorkspaceDirs() {
      // Global skills live outside the workspace, so paths fall back to the URI.
      return [];
    },
  };
}

describe("dedupeSkillFilesByPath", () => {
  it("drops the duplicate a skill gets from being scanned twice", () => {
    const seeded =
      "file:///C:/Users/Atlas%20SOS/.incontrol/skills/tool-usage/SKILL.md";
    // The global skills folder is walked both by getAllDotIncontrolDefinitionFiles
    // and by getClaudeSkillsDir, which is why the bundled "tool-usage" skill was
    // listed twice in the Skills settings section and in the read_skill tool.
    expect(dedupeSkillFilesByPath([seeded, seeded])).toEqual([seeded]);
  });

  it("collapses uri and native path spellings of the same file", () => {
    const seeded =
      "file:///C:/Users/Atlas%20SOS/.incontrol/skills/tool-usage/SKILL.md";
    expect(
      dedupeSkillFilesByPath([
        seeded,
        "C:\\Users\\Atlas SOS\\.incontrol\\skills\\tool-usage\\SKILL.md",
        "file:///c:/Users/Atlas%20SOS/.incontrol/skills/tool-usage/SKILL.md",
      ]),
    ).toEqual([seeded]);
  });

  it("collapses percent-encoded and space-in-uri spellings of the same file", () => {
    const encoded =
      "file:///C:/Users/Atlas%20SOS/.incontrol/skills/tool-usage/SKILL.md";
    const unencoded =
      "file:///C:/Users/Atlas SOS/.incontrol/skills/tool-usage/SKILL.md";
    expect(dedupeSkillFilesByPath([encoded, unencoded])).toEqual([encoded]);
  });

  it("keeps distinct skills", () => {
    const toolUsage =
      "file:///C:/Users/Atlas%20SOS/.incontrol/skills/tool-usage/SKILL.md";
    const other =
      "file:///C:/Users/Atlas%20SOS/.incontrol/skills/my-skill/SKILL.md";
    expect(dedupeSkillFilesByPath([toolUsage, other, toolUsage])).toEqual([
      toolUsage,
      other,
    ]);
  });
});

describe("loadMarkdownSkills", () => {
  afterAll(() => {
    fs.rmSync(TEST_GLOBAL_DIR, { recursive: true, force: true });
  });

  it("reports one skill per SKILL.md when two scans return the same file", async () => {
    const toolUsageUri = writeSkillDir("tool-usage");
    const uris = new Map([[toolUsageUri, SKILL_TEMPLATE("tool-usage")]]);
    // .incontrol scan + .claude scan of the very same seeded skill file.
    definitionFilesSpy.mockResolvedValue([{ path: toolUsageUri, content: "" }]);
    walkDirSpy.mockImplementation(async (uri: string) =>
      uri === globalSkillsDirUri() ? [toolUsageUri] : [],
    );

    const { skills, errors } = await loadMarkdownSkills(
      makeIde(uris) as unknown as Parameters<typeof loadMarkdownSkills>[0],
    );

    expect(errors).toEqual([]);
    expect(skills.map((skill) => skill.name)).toEqual(["tool-usage"]);
    expect(skills[0].fileUri).toBe(toolUsageUri);
  });

  it("still loads every distinct skill", async () => {
    const toolUsageUri = writeSkillDir("tool-usage");
    const secondUri = writeSkillDir("second-skill");
    const uris = new Map([
      [toolUsageUri, SKILL_TEMPLATE("tool-usage")],
      [secondUri, SKILL_TEMPLATE("second-skill")],
    ]);
    definitionFilesSpy.mockResolvedValue([
      { path: toolUsageUri, content: "" },
      { path: secondUri, content: "" },
    ]);
    walkDirSpy.mockImplementation(async (uri: string) =>
      uri === globalSkillsDirUri() ? [toolUsageUri, secondUri] : [],
    );

    const { skills, errors } = await loadMarkdownSkills(
      makeIde(uris) as unknown as Parameters<typeof loadMarkdownSkills>[0],
    );

    expect(errors).toEqual([]);
    expect(skills.map((skill) => skill.name)).toEqual([
      "tool-usage",
      "second-skill",
    ]);
  });
});
