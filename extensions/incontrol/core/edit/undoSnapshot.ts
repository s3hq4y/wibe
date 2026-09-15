// Pure checks shared by the editor-side undo handler and regression tests.
export function undoSnapshotError(before: unknown, after: unknown, current?: string): string | undefined {
  if (typeof before !== "string" || typeof after !== "string" || before.length + after.length > 2_000_000) {
    return "Invalid or oversized edit snapshot";
  }
  if (current !== undefined && current !== after) {
    return "The file has changed since this edit. Undo was stopped to protect newer changes.";
  }
  return undefined;
}
