import { EditOperation } from "../../tools/definitions/multiEdit";
import { IncontrolError, IncontrolErrorReason } from "../../util/errors";
import { validateSingleEdit } from "./findAndReplaceUtils";

/**
 * Validates multi-edit arguments and all edits in a single pass
 * @param args - The arguments object containing the edits array
 * @returns Validated edits array
 * @throws IncontrolError if validation fails
 */
export function validateMultiEdit(args: unknown): {
  edits: EditOperation[];
} {
  if (typeof args !== "object" || !args || !("edits" in args)) {
    throw new IncontrolError(
      IncontrolErrorReason.MultiEditEditsArrayRequired,
      "invalid multi-edit args",
    );
  }

  // Validate that edits is a non-empty array
  if (!Array.isArray(args.edits)) {
    throw new IncontrolError(
      IncontrolErrorReason.MultiEditEditsArrayRequired,
      "edits array is required",
    );
  }
  const { edits } = args;

  if (edits.length === 0) {
    throw new IncontrolError(
      IncontrolErrorReason.MultiEditEditsArrayEmpty,
      "edits array must contain at least one edit",
    );
  }

  // Validate each individual edit
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];

    // Use existing single edit validation
    validateSingleEdit(edit.old_string, edit.new_string, edit.replace_all, i);

    // Only the first edit can have empty old_string (for insertion at beginning)
    if (i > 0 && edit.old_string === "") {
      throw new IncontrolError(
        IncontrolErrorReason.FindAndReplaceNonFirstEmptyOldString,
        `Edit at index ${i}: old_string cannot be empty. Only the first edit can have an empty old_string for insertion at the beginning of the file.`,
      );
    }
  }

  return { edits };
}
