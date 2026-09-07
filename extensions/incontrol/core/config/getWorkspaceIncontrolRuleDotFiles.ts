import { ConfigValidationError } from "@incontrol/config-yaml";
import { IDE, RuleWithSource } from "..";
import { joinPathsToUri } from "../util/uri";
export const SYSTEM_PROMPT_DOT_FILE = ".incontrolrules";
/** Pre-rebrand rule dot file, still read when the new one is absent. */
export const LEGACY_SYSTEM_PROMPT_DOT_FILE = ".continuerules";

export async function getWorkspaceIncontrolRuleDotFiles(ide: IDE) {
  const dirs = await ide.getWorkspaceDirs();

  const errors: ConfigValidationError[] = [];
  const rules: RuleWithSource[] = [];
  for (const dir of dirs) {
    for (const [dotFileName, source] of [
      [SYSTEM_PROMPT_DOT_FILE, ".incontrolrules"],
      [LEGACY_SYSTEM_PROMPT_DOT_FILE, ".continuerules"],
    ] as const) {
      try {
        const dotFile = joinPathsToUri(dir, dotFileName);
        const exists = await ide.fileExists(dotFile);
        if (exists) {
          const content = await ide.readFile(dotFile);
          rules.push({
            rule: content,
            sourceFile: dotFile,
            source,
          });
        }
      } catch (e) {
        errors.push({
          fatal: false,
          message: `Failed to load system prompt dot file from workspace ${dir}: ${e instanceof Error ? e.message : e}`,
        });
      }
    }
  }

  return { rules, errors };
}
