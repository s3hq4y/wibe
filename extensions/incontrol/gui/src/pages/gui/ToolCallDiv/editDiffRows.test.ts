import { describe, it, expect } from "vitest";
import { diffLines } from "diff";
import { editDiffRows, visibleEditRows } from "./editDiffRows";

describe("edit diff rows", () => {
  it("numbers additions and deletions independently", () => {
    const rows = editDiffRows(diffLines("a\nb\n", "a\nc\nd\n"));
    expect(rows.map(r => [r.kind, r.oldLine, r.newLine])).toEqual([
      ["context",1,1], ["remove",2,undefined], ["add",undefined,2], ["add",undefined,3],
    ]);
  });
  it("preserves blank lines, indentation, CRLF and empty baselines", () => {
    const rows = editDiffRows(diffLines("", "  x\r\n\r\ny"));
    expect(rows.map(r => r.text)).toEqual(["  x", "", "y"]);
    expect(rows.map(r => r.newLine)).toEqual([1,2,3]);
  });
  it("collapses only unchanged context without changing line numbers", () => {
    const rows = editDiffRows(diffLines("a\nb\nc\nd\ne\nf\ng\n", "a\nb\nc\nD\ne\nf\ng\n"));
    const shown = visibleEditRows(rows, 1);
    expect(shown[0]).toBe(2);
    expect(shown[shown.length-1]).toBe(2);
    expect(shown).toContainEqual(expect.objectContaining({kind:"add", newLine:4}));
  });
});
