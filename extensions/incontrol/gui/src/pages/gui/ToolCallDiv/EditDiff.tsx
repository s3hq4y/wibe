import { Change } from "diff";
import { useMemo, useState } from "react";
import { editDiffRows, editDiffTargetLine, visibleEditRows } from "./editDiffRows";

export function EditDiff({ parts, onNavigate, isPartial = false }: {
  parts: Change[];
  isPartial?: boolean;
  onNavigate?: (line: number, side: "before" | "after") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => editDiffRows(parts), [parts]);
  const visible = useMemo(() => expanded ? rows : visibleEditRows(rows), [rows, expanded]);
  return <div className="max-h-96 overflow-auto" aria-label="File changes">
    <div className="text-description flex gap-3 px-3 py-1 text-xs"><span>− Before</span><span>+ After</span></div>
    {isPartial && <div className="text-description px-3 py-1 text-xs">Edit fragments only — full file snapshot unavailable</div>}
    <div className="w-max min-w-full font-mono text-xs" style={{ tabSize: 4 }}>
      {visible.map((row, i) => {
        if (typeof row === "number") return (
          <button key={i} type="button" className="text-description w-full cursor-pointer border-none bg-transparent px-3 py-1 text-left"
            onClick={() => setExpanded(true)} aria-label={`Show ${row} unchanged lines`}>⋯ {row}</button>
        );
        const side = row.kind === "remove" ? "before" : "after";
        const line = editDiffTargetLine(rows, row, side);
        const label = `Open diff ${side} at ${isPartial ? "fragment " : ""}line ${line + 1}`;
        return (
          <div key={i} className={`flex whitespace-pre ${onNavigate ? "cursor-pointer hover:brightness-125 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1" : ""}`}
            role={onNavigate ? "button" : undefined} tabIndex={onNavigate ? 0 : undefined}
            aria-label={onNavigate ? `${label}: ${row.text}` : undefined}
            title={onNavigate ? label : undefined}
            onClick={event => {
              // Selecting/copying diff text must not unexpectedly focus the editor.
              const selection = window.getSelection();
              if (selection && !selection.isCollapsed &&
                  (event.currentTarget.contains(selection.anchorNode) || event.currentTarget.contains(selection.focusNode))) return;
              onNavigate?.(line, side);
            }}
            onKeyDown={event => {
              if (onNavigate && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onNavigate(line, side);
              }
            }}
            style={{ background: row.kind === "add" ? "var(--vscode-diffEditor-insertedLineBackground, rgba(46,160,67,.18))" : row.kind === "remove" ? "var(--vscode-diffEditor-removedLineBackground, rgba(248,81,73,.18))" : undefined }}>
            <span className="text-description-muted inline-block w-10 flex-none select-none text-right" aria-label="Old line">{row.oldLine ?? ""}</span>
            <span className="text-description-muted mr-2 inline-block w-10 flex-none select-none text-right" aria-label="New line">{row.newLine ?? ""}</span>
            <span className="inline-block w-4 flex-none select-none" style={{ color: row.kind === "add" ? "#3fb950" : row.kind === "remove" ? "#f85149" : undefined }}>{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}</span>
            <span className="pr-3">{row.text || " "}</span>
          </div>
        );
      })}
    </div>
  </div>;
}
