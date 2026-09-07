import { Tool } from "../..";
import { validateMultiEdit } from "../../edit/searchAndReplace/multiEditValidation";
import { executeMultiFindAndReplace } from "../../edit/searchAndReplace/performReplace";
import { validateSearchAndReplaceFilepath } from "../../edit/searchAndReplace/validateArgs";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { NO_PARALLEL_TOOL_CALLING_INSTRUCTION } from "../constants";

export interface EditOperation {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface MultiEditArgs {
  filepath: string;
  edits: EditOperation[];
}

export const multiEditTool: Tool = {
  type: "function",
  displayTitle: "Multi Edit",
  wouldLikeTo: "edit {{{ filepath }}}",
  isCurrently: "editing {{{ filepath }}}",
  hasAlready: "edited {{{ filepath }}}",
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  isInstant: false,
  function: {
    name: BuiltInToolNames.MultiEdit,
    description: `Use this tool to make multiple find-and-replace edits to an existing file in one atomic operation.

Rules:
- Call read_file immediately before editing so you work from the file's up-to-date contents.
- Each edit needs old_string (exact match from the file, whitespace/indentation included) and new_string (must differ from old_string). Use replace_all to rename every occurrence of a string.
- Edits are applied in order, each on the result of the previous one; if earlier edits change text that later edits match, files can get mangled.
- All edits must be valid or nothing is applied. Do not leave the file in a broken state.
- Make ALL changes to a file in this one call. This tool cannot be called in parallel with any other tool, including itself.`,
    parameters: {
      type: "object",
      required: ["filepath", "edits"],
      properties: {
        filepath: {
          type: "string",
          description:
            "The path to the file to modify, relative to the root of the workspace",
        },
        edits: {
          type: "array",
          description:
            "Array of edit operations to perform sequentially on the file",
          items: {
            type: "object",
            required: ["old_string", "new_string"],
            properties: {
              old_string: {
                type: "string",
                description:
                  "The text to replace (exact match including whitespace/indentation)",
              },
              new_string: {
                type: "string",
                description:
                  "The text to replace it with. MUST be different than old_string.",
              },
              replace_all: {
                type: "boolean",
                description:
                  "Replace all occurrences of old_string (default false) in the file",
              },
            },
          },
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To make multiple edits to a single file, use the ${BuiltInToolNames.MultiEdit} tool with a filepath (relative to the root of the workspace) and an array of edit operations.

  For example, you could respond with:`,
    exampleArgs: [
      ["filepath", "path/to/file.ts"],
      [
        "edits",
        `[
  { "old_string": "const oldVar = 'value'", "new_string": "const newVar = 'updated'" },
  { "old_string": "oldFunction()", "new_string": "newFunction()", "replace_all": true }
]`,
      ],
    ],
  },
  defaultToolPolicy: "allowedWithPermission",
  preprocessArgs: async (args, extras) => {
    const { edits } = validateMultiEdit(args);
    const fileUri = await validateSearchAndReplaceFilepath(
      args.filepath,
      extras.ide,
    );

    const editingFileContents = await extras.ide.readFile(fileUri);
    const newFileContents = executeMultiFindAndReplace(
      editingFileContents,
      edits,
    );

    return {
      ...args,
      fileUri,
      editingFileContents,
      newFileContents,
    };
  },
};
