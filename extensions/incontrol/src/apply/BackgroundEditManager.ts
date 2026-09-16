import type { AcceptOrRejectDiffPayload, ApplyState, ApplyToFilePayload } from "core";
import * as vscode from "vscode";

interface PendingEdit {
  payload: ApplyToFilePayload;
  before: string;
  after: string;
  busy: boolean;
}

/** Stages chat edits without an editor. No disk/buffer changes until approval. */
export class BackgroundEditManager implements vscode.Disposable {
  private readonly pending = new Map<string, PendingEdit>();
  private readonly completed = new Set<string>();
  constructor(private readonly notify: (state: ApplyState) => Promise<void>) {}

  async stage(payload: ApplyToFilePayload): Promise<void> {
    if (!payload.filepath || !payload.toolCallId || !payload.isSearchAndReplace ||
        typeof payload.expectedFileContent !== "string" || typeof payload.text !== "string") {
      throw new Error("Missing background edit snapshot; read the file again before editing");
    }
    const uri = vscode.Uri.parse(payload.filepath);
    if (!["file", "vscode-remote"].includes(uri.scheme)) throw new Error("Cannot edit a readonly review resource");
    if (this.completed.has(payload.streamId)) return;
    if (this.pending.has(payload.streamId)) return;
    if ([...this.pending.values()].some(p => p.payload.filepath === payload.filepath)) {
      throw new Error("Another edit for this file is awaiting approval");
    }
    // Loading a TextDocument does NOT create a visible editor/tab.
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc.getText() !== payload.expectedFileContent) throw new Error("File changed since it was read; read it again before editing");
    // Recheck after the asynchronous document load for parallel tool calls.
    if ([...this.pending.values()].some(p => p.payload.filepath === payload.filepath)) throw new Error("Another edit for this file is awaiting approval");
    const pending = { payload, before: payload.expectedFileContent, after: payload.text, busy: false };
    this.pending.set(payload.streamId, pending);
    try {
      await this.notify({ streamId: payload.streamId, toolCallId: payload.toolCallId, filepath: payload.filepath,
        background: true, status: "done", numDiffs: pending.before === pending.after ? 0 : 1,
        originalFileContent: pending.before, fileContent: pending.after });
    } catch (error) {
      this.pending.delete(payload.streamId);
      throw error;
    }
  }

  async resolve(accept: boolean, data: AcceptOrRejectDiffPayload): Promise<boolean> {
    const id = data.streamId;
    if (id && this.completed.has(id)) return true;
    const pending = id ? this.pending.get(id) : undefined;
    if (!pending) {
      if (!data.background) return false;
      await this.notify({ streamId: id ?? "", toolCallId: data.toolCallId, filepath: data.filepath,
        background: true, status: "closed", error: "This pending edit expired. Read the file and run the edit again; no changes were applied." });
      return true; // Never fall through to a legacy auto-open/apply path.
    }
    if (pending.busy) return true;
    pending.busy = true;
    const { payload, before, after } = pending;
    const result: ApplyState = { streamId: id!, toolCallId: payload.toolCallId, filepath: payload.filepath,
      background: true, status: "closed", numDiffs: 0, originalFileContent: before, fileContent: before };
    try {
      if (data.filepath && data.filepath !== payload.filepath) throw new Error("Edit target does not match the pending file");
      if (!accept) {
        result.rejected = true;
      } else {
        const uri = vscode.Uri.parse(payload.filepath!);
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.getText() !== before) throw new Error("Newer changes protected: the file changed while this edit was awaiting approval");
        const wasDirty = doc.isDirty;
        await vscode.commands.executeCommand("_wibe.setBackgroundEdit", doc.uri.toString(), true);
        try {
          if (doc.getText() !== before) throw new Error("Newer changes protected: file changed before applying the edit");
          const edit = new vscode.WorkspaceEdit();
          edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(before.length)), after);
          // WorkspaceEdit is version-checked by VS Code, and never needs showTextDocument.
          if (!(await vscode.workspace.applyEdit(edit))) throw new Error("Edit conflict: no changes were applied");
          result.fileContent = doc.getText();
          // Do not silently save unrelated user changes that were already unsaved.
          result.saved = wasDirty ? false : await doc.save();
          result.fileContent = doc.getText();
          if (!wasDirty && !result.saved) throw new Error("Edit is in the unsaved buffer, but saving failed; save or review the file manually");
        } finally {
          await vscode.commands.executeCommand("_wibe.setBackgroundEdit", doc.uri.toString(), false);
        }
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.pending.delete(id!);
      this.completed.add(id!);
      if (this.completed.size > 256) this.completed.delete(this.completed.values().next().value!);
    }
    await this.notify(result);
    return true;
  }

  dispose(): void { this.pending.clear(); this.completed.clear(); }
}
