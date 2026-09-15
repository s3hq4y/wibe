import { describe, it, expect } from "vitest";
import { undoSnapshotError } from "core/edit/undoSnapshot";

describe("safe undo snapshot validation", () => {
  it("accepts matching content, including restoration of empty files", () => {
    expect(undoSnapshotError("", "new", "new")).toBeUndefined();
    expect(undoSnapshotError("old", "", "")).toBeUndefined();
  });
  it("rejects newer user edits and earlier undo attempts", () => {
    expect(undoSnapshotError("old", "new", "user edit")).toContain("protect newer changes");
    expect(undoSnapshotError("old", "new", "old")).toContain("protect newer changes");
  });
  it("does not normalize away whitespace or newline differences", () => {
    expect(undoSnapshotError("old", "new\n", "new\r\n")).toBeDefined();
  });
  it("rejects malformed and oversized snapshots", () => {
    expect(undoSnapshotError(undefined, "new")).toBeDefined();
    expect(undoSnapshotError("x".repeat(2_000_001), "")).toBeDefined();
  });
});
