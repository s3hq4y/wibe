import { createHash } from "node:crypto";
import type { ShowEditDiffParams } from "core/protocol/ideWebview";
import * as vscode from "vscode";

const SCHEME = "incontrol-edit-diff";
interface Snapshot { before: string; after: string }

/** Readonly, in-memory review. Never applies, saves or reverts a workspace file. */
export class EditSnapshotDiff implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly changes = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changes.event;
  private readonly disposables: vscode.Disposable[];
  private pending?: string;
  private queue = Promise.resolve();

  constructor() {
    this.disposables = [
      this.changes,
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
      vscode.window.tabGroups.onDidChangeTabs(() => this.prune()),
    ];
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const snapshot = this.snapshots.get(uri.authority);
    if (!snapshot || !/^\/(before|after)\//.test(uri.path)) {
      throw vscode.FileSystemError.FileNotFound("Reopen this change from INCONTROL chat");
    }
    return uri.path.startsWith("/before/") ? snapshot.before : snapshot.after;
  }

  show(params: ShowEditDiffParams): Promise<void> {
    // Rapid clicks must not let an earlier asynchronous open steal the final selection.
    const next = this.queue.then(() => this.open(params));
    this.queue = next.catch(() => {});
    return next;
  }

  private async open(params: ShowEditDiffParams): Promise<void> {
    if (!params || typeof params.filepath !== "string" || !params.filepath ||
        typeof params.before !== "string" || typeof params.after !== "string" ||
        !["file", "fragments"].includes(params.scope)) {
      throw new Error("Missing edit snapshots; reopen the change from chat");
    }
    const name = vscode.Uri.parse(params.filepath).path.split("/").pop() || "file";
    // Stable per SOURCE FILE, not per edit revision: the same pair of URIs
    // reuses the existing diff tab when another chat change is selected.
    const id = createHash("sha256").update(vscode.Uri.parse(params.filepath).toString()).digest("hex");
    this.snapshots.delete(id);
    this.snapshots.set(id, { before: params.before, after: params.after });
    this.pending = id;
    const before = vscode.Uri.from({ scheme: SCHEME, authority: id, path: `/before/${name}` });
    const after = vscode.Uri.from({ scheme: SCHEME, authority: id, path: `/after/${name}` });
    const target = params.selection?.side === "before" ? before : after;
    try {
      await Promise.all([
        this.refreshDocument(before, params.before),
        this.refreshDocument(after, params.after),
      ]);
      const doc = await vscode.workspace.openTextDocument(target);
      const line = Number.isFinite(params.selection?.line) ? Math.max(0, Math.trunc(params.selection!.line)) : 0;
      const range = doc.validateRange(new vscode.Range(line, 0, line, 0));
      const title = `${name} — INCONTROL Before ↔ After${params.scope === "fragments" ? " (fragments, not full file)" : ""}`;
      // Reuse the group where this file's diff already lives, including tabs
      // the user moved out of group One. Never create a second copy there.
      const groups = [...vscode.window.tabGroups.all].sort((a, b) => Number(b.isActive) - Number(a.isActive));
      const existingGroup = groups.find(group => group.tabs.some(tab =>
        tab.input instanceof vscode.TabInputTextDiff &&
        tab.input.original.toString() === before.toString() && tab.input.modified.toString() === after.toString()));
      await vscode.commands.executeCommand("vscode.diff", before, after, title, {
        preview: false, preserveFocus: false, viewColumn: existingGroup?.viewColumn ?? vscode.ViewColumn.One,
        // VS Code's standard selection option addresses only the modified side.
        ...(params.selection && target === after ? { selection: range } : {}),
      });
      if (params.selection) {
        const editor = await this.findVisibleEditor(target);
        if (editor) {
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
      }
    } finally {
      this.pending = undefined;
      this.prune();
    }
  }

  private async refreshDocument(uri: vscode.Uri, content: string): Promise<void> {
    const normalize = (text: string) => text.replace(/\r\n/g, "\n");
    const loaded = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    if (!loaded || normalize(loaded.getText()) === normalize(content)) return;
    // Listen BEFORE firing. The content provider refresh is asynchronous; do
    // not clamp/reveal a new revision's line against the previous document.
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { listener.dispose(); clearTimeout(timer); error ? reject(error) : resolve(); };
      const listener = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.toString() === uri.toString() && normalize(event.document.getText()) === normalize(content)) finish();
      });
      const timer = setTimeout(() => finish(new Error("Diff snapshot refresh timed out; click the change again")), 5000);
      this.changes.fire(uri);
    });
  }

  private async findVisibleEditor(uri: vscode.Uri): Promise<vscode.TextEditor | undefined> {
    const find = () => vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
    const current = find();
    if (current) return current;
    return new Promise(resolve => {
      const finish = () => { listener.dispose(); clearTimeout(timer); resolve(find()); };
      const listener = vscode.window.onDidChangeVisibleTextEditors(() => { if (find()) finish(); });
      const timer = setTimeout(finish, 1500);
      if (find()) finish();
    });
  }

  private prune(): void {
    const open = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputTextDiff) {
          for (const uri of [tab.input.original, tab.input.modified]) {
            if (uri.scheme === SCHEME) open.add(uri.authority);
          }
        }
      }
    }
    let characters = [...this.snapshots.values()].reduce((sum, s) => sum + s.before.length + s.after.length, 0);
    // Bound CLOSED history only. Open tabs and the currently opening pair remain valid.
    for (const [id, snapshot] of this.snapshots) {
      if (this.snapshots.size <= 32 && characters <= 16 * 1024 * 1024) break;
      if (id === this.pending || open.has(id)) continue;
      this.snapshots.delete(id);
      characters -= snapshot.before.length + snapshot.after.length;
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.snapshots.clear();
  }
}
