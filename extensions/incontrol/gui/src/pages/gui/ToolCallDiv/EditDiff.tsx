import { Change } from "diff";
import { useMemo, useState } from "react";
import { editDiffRows, visibleEditRows } from "./editDiffRows";

export function EditDiff({ parts }: { parts: Change[] }) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => editDiffRows(parts), [parts]);
  const visible = useMemo(() => expanded ? rows : visibleEditRows(rows), [rows, expanded]);
  return <div className="max-h-96 overflow-auto" aria-label="File changes">
    <div className="text-description flex gap-3 px-3 py-1 text-xs"><span>− Before</span><span>+ After</span></div>
    <div className="w-max min-w-full font-mono text-xs" style={{ tabSize: 4 }}>
      {visible.map((row, i) => typeof row === "number" ? (
        <button key={i} type="button" className="text-description w-full cursor-pointer border-none bg-transparent px-3 py-1 text-left"
          onClick={() => setExpanded(true)} aria-label={`Show ${row} unchanged lines`}>⋯ {row}</button>
      ) : (
        <div key={i} className="flex whitespace-pre" style={{
          background: row.kind === "add" ? "var(--vscode-diffEditor-insertedLineBackground, rgba(46,160,67,.18))" : row.kind === "remove" ? "var(--vscode-diffEditor-removedLineBackground, rgba(248,81,73,.18))" : undefined,
        }}>
          <span className="text-description-muted inline-block w-10 flex-none select-none text-right" aria-label="Old line">{row.oldLine ?? ""}</span>
          <span className="text-description-muted mr-2 inline-block w-10 flex-none select-none text-right" aria-label="New line">{row.newLine ?? ""}</span>
          <span className="inline-block w-4 flex-none select-none" style={{ color: row.kind === "add" ? "#3fb950" : row.kind === "remove" ? "#f85149" : undefined }}>{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}</span>
          <span className="pr-3">{row.text || " "}</span>
        </div>
      ))}
    </div>
  </div>;
}
