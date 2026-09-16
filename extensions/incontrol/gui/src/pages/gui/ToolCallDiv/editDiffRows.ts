import type { Change } from "diff";

export interface EditDiffRow {
  text: string;
  kind: "add" | "remove" | "context";
  oldLine?: number;
  newLine?: number;
}

// Preserve indentation, blank lines and CRLF line counts. Numbers are from
// the actual before/after snapshots, not from the shortened display.
export function editDiffRows(parts: Change[]): EditDiffRow[] {
  let oldLine = 1;
  let newLine = 1;
  const rows: EditDiffRow[] = [];
  for (const part of parts) {
    if (!part.value) continue;
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) {
      rows.push({
        text: text.endsWith("\r") ? text.slice(0, -1) : text,
        kind: part.added ? "add" : part.removed ? "remove" : "context",
        oldLine: part.added ? undefined : oldLine++,
        newLine: part.removed ? undefined : newLine++,
      });
    }
  }
  return rows;
}

export function visibleEditRows(rows: EditDiffRow[], context = 3): (EditDiffRow | number)[] {
  const visible = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind !== "context") {
      for (let i = Math.max(0, index - context); i <= Math.min(rows.length - 1, index + context); i++) visible.add(i);
    }
  });
  const result: (EditDiffRow | number)[] = [];
  let hidden = 0;
  rows.forEach((row, i) => {
    if (!visible.has(i)) { hidden++; return; }
    if (hidden) { result.push(hidden); hidden = 0; }
    result.push(row);
  });
  if (hidden) result.push(hidden);
  return result;
}

/** Zero-based target in the current file; deleted/inserted-only lines use the
 * next surviving line at that boundary, or the last surviving line at EOF. */
export function editDiffTargetLine(rows: EditDiffRow[], row: EditDiffRow, side: "before" | "after" = "after"): number {
  const field = side === "after" ? "newLine" : "oldLine";
  if (row[field] !== undefined) return Math.max(0, row[field]! - 1);
  const index = rows.indexOf(row);
  const line = row[field] ?? rows.slice(index + 1).find(candidate => candidate[field] !== undefined)?.[field] ??
    rows.slice(0, index).reverse().find(candidate => candidate[field] !== undefined)?.[field] ?? 1;
  return Math.max(0, line - 1);
}
