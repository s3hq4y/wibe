import {
  RULE_FILE_EXTENSION,
  sanitizeRuleName,
} from "@incontrol/config-yaml";
import { WORKSPACE_CONFIG_DIR_NAME } from "../../util/paths";
import { joinPathsToUri } from "../../util/uri";

function createRelativeRuleFilePathParts(ruleName: string): string[] {
  const safeRuleName = sanitizeRuleName(ruleName);
  return [
    WORKSPACE_CONFIG_DIR_NAME,
    "rules",
    `${safeRuleName}.${RULE_FILE_EXTENSION}`,
  ];
}

export function createRelativeRuleFilePath(ruleName: string): string {
  return createRelativeRuleFilePathParts(ruleName).join("/");
}

/**
 * Creates the file path for a rule in the workspace .incontrol/rules directory
 */
export function createRuleFilePath(
  workspaceDir: string,
  ruleName: string,
): string {
  return joinPathsToUri(
    workspaceDir,
    ...createRelativeRuleFilePathParts(ruleName),
  );
}
