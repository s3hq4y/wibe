import { fireEvent, render, screen } from "@testing-library/react";
import { diffLines } from "diff";
import { EditDiff } from "./EditDiff";
import { editDiffRows, editDiffTargetLine } from "./editDiffRows";

test("maps removed rows to the surviving boundary, not stale old line numbers", () => {
  const rows = editDiffRows(diffLines("a\nx\ny\nz\nb\n", "a\nb\n"));
  expect(editDiffTargetLine(rows, rows.find(row => row.text === "z")!)).toBe(1);
  expect(editDiffTargetLine(rows, rows.find(row => row.text === "z")!, "before")).toBe(3);
});
test.each([["a\nx\n", "a\n", 0], ["x\n", "", 0]])("clamps deleted EOF lines to a surviving line or zero", (before, after, expected) => {
  const rows = editDiffRows(diffLines(before as string, after as string));
  expect(editDiffTargetLine(rows, rows.find(row => row.kind === "remove")!)).toBe(expected);
});
test("supports keyboard navigation without removing the colored diff", () => {
  const onNavigate = vi.fn();
  render(<EditDiff parts={diffLines("old\n", "new\n")} onNavigate={onNavigate} />);
  const row = screen.getByRole("button", { name: "Open diff after at line 1: new" });
  fireEvent.keyDown(row, { key: "Enter" });
  fireEvent.keyDown(row, { key: " " });
  expect(onNavigate).toHaveBeenNthCalledWith(1, 0, "after");
  expect(onNavigate).toHaveBeenNthCalledWith(2, 0, "after");
  expect(screen.getByText("old")).toBeVisible();
  expect(screen.getByText("new")).toBeVisible();
});
test("expanding skipped context does not open a file", () => {
  const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
  const onNavigate = vi.fn();
  render(<EditDiff parts={diffLines(before, before.replace("line10", "changed"))} onNavigate={onNavigate} />);
  fireEvent.click(screen.getAllByRole("button", { name: /unchanged lines/ })[0]);
  expect(onNavigate).not.toHaveBeenCalled();
  expect(screen.getByText("line0")).toBeVisible();
});
test("text selection does not unexpectedly switch focus to the editor", () => {
  const onNavigate = vi.fn();
  render(<EditDiff parts={diffLines("old\n", "new\n")} onNavigate={onNavigate} />);
  const text = screen.getByText("new");
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(text);
  selection.removeAllRanges(); selection.addRange(range);
  fireEvent.click(text);
  expect(onNavigate).not.toHaveBeenCalled();
  selection.removeAllRanges();
  fireEvent.click(text);
  expect(onNavigate).toHaveBeenCalledWith(0, "after");
});

test("removed rows locate the original snapshot, including deleted EOF", () => {
  const onNavigate = vi.fn();
  render(<EditDiff parts={diffLines("a\nx\ny\n", "a\n")} onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole("button", { name: "Open diff before at line 3: y" }));
  expect(onNavigate).toHaveBeenCalledWith(2, "before");
});
