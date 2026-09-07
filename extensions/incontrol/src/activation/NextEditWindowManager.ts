/* eslint-disable @typescript-eslint/naming-convention */
import { EXTENSION_NAME } from "core/util/constants";
// @ts-ignore
import * as vscode from "vscode";

import { DiffChar, DiffLine } from "core";
import { myersCharDiff } from "core/diff/myers";
import { getOffsetPositionAtLastNewLine } from "core/nextEdit/diff/diff";
import { NextEditLoggingService } from "core/nextEdit/NextEditLoggingService";
import { NextEditProvider } from "core/nextEdit/NextEditProvider";
import {
  HandlerPriority,
  SelectionChangeManager,
} from "./SelectionChangeManager";

export interface TextApplier {
  applyText(
    editor: vscode.TextEditor,
    text: string,
    position: vscode.Position,
    finalCursorPos: vscode.Position | null,
  ): Promise<boolean>;
}

/**
 * The preview is drawn with plain VS Code decorations: one `after` attachment
 * per predicted line, anchored at the end of the editor line it visually
 * overlays (region start + row index). All rows are padded to the same width
 * and pushed to a common column with `ch` margins, so together they form a
 * rectangular block that follows the editor font and the active colour theme
 * (ThemeColor / --vscode-* variables) without any bundled highlighter.
 */
const PREVIEW = {
  /** Columns of air between the longest host line and the block. */
  gapColumns: 1,
  /** Rows of predicted text past the end of the document are joined with this. */
  overflowSeparator: " \u23CE ",
  cornerRadius: "3px",
  textColor: () => new vscode.ThemeColor("editor.foreground"),
  background: () => new vscode.ThemeColor("editorWidget.background"),
  border: () => new vscode.ThemeColor("editorWidget.border"),
  cursorRowTint:
    "var(--vscode-editor-lineHighlightBackground, var(--vscode-editor-rangeHighlightBackground))",
  addedRowTint: "var(--vscode-diffEditor-insertedLineBackground)",
} as const;

const FULL_WIDTH_CHAR =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Expand tabs to spaces the way the editor lays them out. */
function expandTabs(text: string, tabSize: number): string {
  let out = "";
  let col = 0;
  for (const ch of text) {
    if (ch === "\t") {
      const n = tabSize - (col % tabSize);
      out += " ".repeat(n);
      col += n;
    } else {
      out += ch;
      col += FULL_WIDTH_CHAR.test(ch) ? 2 : 1;
    }
  }
  return out;
}

/** Number of monospace cells `text` occupies (tabs expanded, CJK = 2). */
function visualColumns(text: string, tabSize: number): number {
  let col = 0;
  for (const ch of text) {
    if (ch === "\t") {
      col += tabSize - (col % tabSize);
    } else {
      col += FULL_WIDTH_CHAR.test(ch) ? 2 : 1;
    }
  }
  return col;
}

function padToColumns(text: string, columns: number, tabSize: number): string {
  const missing = columns - visualColumns(text, tabSize);
  return missing > 0 ? text + " ".repeat(missing) : text;
}

// Command ID - can be used in package.json
export const HIDE_NEXT_EDIT_SUGGESTION_COMMAND =
  "incontrol.nextEditWindow.hideNextEditSuggestion";
export const ACCEPT_NEXT_EDIT_SUGGESTION_COMMAND =
  "incontrol.nextEditWindow.acceptNextEditSuggestion";

/**
 * This is where we create the preview block and deletion decorations for non-FIM next edit suggestions.
 * This class controls the decoration object lifetime.
 * The preview is rendered with native text decorations (see PREVIEW above); no
 * syntax highlighter or image generation is involved.
 */
export class NextEditWindowManager {
  private static instance: NextEditWindowManager | undefined;

  private readonly excludedURIPrefixes = ["output:", "vscode://inline-chat"];

  // Current active decoration
  private currentDecoration: vscode.TextEditorDecorationType | null = null;
  // A short-lived checker to determine if the cursor moved because of us accepting the next edit, or not.
  // Distinguishing the two is necessary to determine if we should log it as an accepted or rejected.
  private accepted: boolean = false;
  // Track which editor has the active decoration
  private activeEditor: vscode.TextEditor | null = null;
  // Store the current tooltip text for accepting
  private currentTooltipText: string | null = null;
  // Track for logging purposes.
  private loggingService: NextEditLoggingService;
  private mostRecentCompletionId: string | null = null;
  // Helps us skip redundant calculations. No need for cleanup because this always gets reassigned with new values at showNextEditWindow, and we don't reuse windows.
  private editableRegionStartLine: number = 0;
  private editableRegionEndLine: number = 0;

  // State tracking for key reservation.
  // By default it is set to free, and is only set to reserved when the transition is done.
  private keyReservationState: "free" | "reserved" | "transitioning" = "free";
  private latestOperationId = 0;

  // Disposables
  private disposables: vscode.Disposable[] = [];

  private textApplier: TextApplier | null = null;

  private finalCursorPos: vscode.Position | null = null;

  private isLineDelete: boolean = false;

  private context: vscode.ExtensionContext | null = null;

  public static getInstance(): NextEditWindowManager {
    if (!NextEditWindowManager.instance) {
      NextEditWindowManager.instance = new NextEditWindowManager();
    }
    return NextEditWindowManager.instance;
  }

  public static isInstantiated(): boolean {
    return !!NextEditWindowManager.instance;
  }

  public static clearInstance(): void {
    if (NextEditWindowManager.instance) {
      NextEditWindowManager.instance.dispose();
      NextEditWindowManager.instance = undefined;
    }
  }

  private constructor() {
    this.setupListeners();
    this.loggingService = NextEditLoggingService.getInstance();
  }

  // This is an implementation of last-action-wins.
  // For each action that fires setKeyReservation, it keeps its own operationId while incrementing latestOperationId.
  // When an action completes, checking for operationId === latestOperationId will determine which one came last.
  private async setKeyReservation(reserve: boolean): Promise<void> {
    // Increment and capture this operation's ID.
    const operationId = ++this.latestOperationId;

    // Return early when already in desired state.
    if (
      (reserve && this.keyReservationState === "reserved") ||
      (!reserve && this.keyReservationState === "free")
    ) {
      return;
    }

    try {
      await this.performKeyReservation(reserve);

      // Only update state if we're still the latest operation.
      if (operationId === this.latestOperationId) {
        this.keyReservationState = reserve ? "reserved" : "free";
      }
    } catch (err) {
      console.error(`Failed to set nextEditWindowActive to ${reserve}: ${err}`);

      // Only reset to free if we're still the latest operation.
      if (operationId === this.latestOperationId) {
        this.keyReservationState = "free";
      }
      throw err;
    }
  }

  public async resetKeyReservation(): Promise<void> {
    // Reset internal tracking.
    this.keyReservationState = "free";
    this.latestOperationId = 0;

    // Ensure VS Code context matches.
    try {
      await this.performKeyReservation(false);
    } catch (err) {
      console.error(`Failed to reset nextEditWindowActive context: ${err}`);
    }
  }

  private async performKeyReservation(reserve: boolean): Promise<void> {
    try {
      await vscode.commands.executeCommand(
        "setContext",
        "nextEditWindowActive",
        reserve,
      );
    } catch (err) {
      console.error(`Failed to set nextEditWindowActive to ${reserve}: ${err}`);
      throw err;
    }
  }

  public static async reserveTabAndEsc() {
    await NextEditWindowManager.getInstance().setKeyReservation(true);
  }

  public static async freeTabAndEsc() {
    await NextEditWindowManager.getInstance().setKeyReservation(false);
  }

  /**
   * An async setup function to help us initialize the NextEditWindowManager.
   * This is necessary because we need some setup to be done asynchronously,
   * and constructors in TypeScript cannot be async.
   * Plus, it's generally not recommended to pass arguments to getInstance() of a singleton.
   * @param context The extension context.
   * @param textApplier Callback that lets us use external deps such as llms if needed.
   */
  public async setupNextEditWindowManager(
    context: vscode.ExtensionContext,
    textApplier?: TextApplier,
  ) {
    this.context = context;

    // Set nextEditWindowActive to false to free esc and tab,
    // letting them return to their original behaviors.
    await this.resetKeyReservation();
    // await NextEditWindowManager.freeTabAndEsc();

    // Register HIDE_TOOLTIP_COMMAND and ACCEPT_NEXT_EDIT_COMMAND with their corresponding callbacks.
    this.registerCommandSafely(HIDE_NEXT_EDIT_SUGGESTION_COMMAND, async () => {
      console.debug(
        "deleteChain from NextEditWindowManager.ts: hide next edit command",
      );
      NextEditProvider.getInstance().deleteChain();
      await this.hideAllNextEditWindowsAndResetCompletionId();
    });
    this.registerCommandSafely(
      ACCEPT_NEXT_EDIT_SUGGESTION_COMMAND,
      async () => await this.acceptNextEdit(),
    );

    // Add this class to context disposables.
    context.subscriptions.push(this);

    if (textApplier) {
      this.textApplier = textApplier;
    }
  }

  /**
   * Update the most recent completion id.
   * @param completionId The id of current completion request.
   */
  public updateCurrentCompletionId(completionId: string) {
    this.mostRecentCompletionId = completionId;
  }

  /**
   * Registers our two custom commands to the extension context.
   * @param commandId Custom commands to help set up next edit.
   * @param callback Function to run on command execution.
   */
  private registerCommandSafely(
    commandId:
      | "incontrol.nextEditWindow.hideNextEditSuggestion"
      | "incontrol.nextEditWindow.acceptNextEditSuggestion",
    callback: () => Promise<void>,
  ) {
    if (!this.context) {
      console.log("Extension context is not yet set.");
      return;
    }

    try {
      const command = vscode.commands.registerCommand(commandId, callback);
      this.context.subscriptions.push(command);
    } catch (error) {
      console.log(
        `Command ${commandId} already has an associated callback, skipping registration`,
      );
    }
  }

  /**
   * Show a tooltip with the given text at the current cursor position.
   * @param editor The active text editor.
   * @param text Text to display in the tooltip.
   */
  public async showNextEditWindow(
    editor: vscode.TextEditor,
    currCursorPos: vscode.Position,
    editableRegionStartLine: number,
    editableRegionEndLine: number,
    oldEditRangeSlice: string,
    newEditRangeSlice: string,
    diffLines: DiffLine[],
  ) {
    if (!this.shouldRenderTip(editor.document.uri)) {
      return;
    }

    // Clear any existing decorations first (very important to prevent overlapping).
    await this.hideAllNextEditWindows();

    this.activeEditor = editor;

    this.editableRegionStartLine = editableRegionStartLine;
    this.editableRegionEndLine = editableRegionEndLine;

    // Store the current tooltip text for accepting later.
    this.currentTooltipText = newEditRangeSlice;

    // Determine if this is a line deletion case
    // NOTE: A simpler approach might be to just delete the line when newEditRangeSlice is "".
    // But we opt for the below in case the above note is too naive.
    this.isLineDelete = false;
    if (
      newEditRangeSlice === "" &&
      editableRegionStartLine === editableRegionEndLine
    ) {
      // Check if diffLines contains only deletions (no additions).
      const onlyDeletions = diffLines.every(
        (diff) => diff.type === "old" || diff.type === "same",
      );
      const hasDeletedLine = diffLines.some((diff) => diff.type === "old");

      if (onlyDeletions && hasDeletedLine) {
        // Check if the entire line is being deleted (not just characters).
        const line = editor.document.lineAt(editableRegionStartLine).text;
        const oldLine = oldEditRangeSlice.trim();
        if (line.trim() === oldLine || line.trim() === "") {
          this.isLineDelete = true;
        }
      }
    }

    // How far away is the current line from the start of the editable region?
    const lineOffsetAtCursorPos =
      currCursorPos.line - this.editableRegionStartLine;

    // How long is the line at the current cursor position?
    const lineContentAtCursorPos =
      newEditRangeSlice.split("\n")[lineOffsetAtCursorPos];

    const offset = getOffsetPositionAtLastNewLine(
      diffLines,
      lineContentAtCursorPos,
      lineOffsetAtCursorPos,
    );

    // Calculate the final cursor position.
    if (this.isLineDelete) {
      // For line deletion, position cursor at the end of the previous line.
      if (this.editableRegionStartLine > 0) {
        const prevLine = editor.document.lineAt(
          this.editableRegionStartLine - 1,
        );
        this.finalCursorPos = new vscode.Position(
          this.editableRegionStartLine - 1,
          prevLine.text.length,
        );
      } else {
        // If we're deleting the first line, position at the start of the document.
        this.finalCursorPos = new vscode.Position(0, 0);
      }
    } else {
      // For normal edits, use the standard calculation.
      this.finalCursorPos = new vscode.Position(
        this.editableRegionStartLine + offset.line,
        offset.character,
      );
    }

    const diffChars = myersCharDiff(oldEditRangeSlice, newEditRangeSlice);

    // Create and apply decoration with the text.
    if (newEditRangeSlice !== "") {
      try {
        await this.renderWindow(
          editor,
          currCursorPos,
          oldEditRangeSlice,
          newEditRangeSlice,
          this.editableRegionStartLine,
          diffLines,
          diffChars,
        );
      } catch (error) {
        console.error("Failed to render window:", error);
        // Clean up and reset state.
        await this.hideAllNextEditWindows();
        return;
      }
    }

    this.renderDeletions(editor, diffChars);

    // Reserve tab and esc to either accept or reject the displayed next edit contents.
    try {
      await NextEditWindowManager.reserveTabAndEsc();
    } catch (err) {
      console.error(
        `Error reserving Tab/Esc after showing decorations: ${err}`,
      );
      await this.hideAllNextEditWindows();
      return;
    }
  }

  /**
   * Hide all tooltips in all editors.
   */
  public async hideAllNextEditWindows() {
    try {
      await NextEditWindowManager.freeTabAndEsc();
    } catch (err) {
      console.error(`Error freeing Tab/Esc while hiding: ${err}`);
    }

    if (this.currentDecoration) {
      vscode.window.visibleTextEditors.forEach((editor) => {
        editor.setDecorations(this.currentDecoration!, []);
      });

      // If we know which editor had the decoration, clear it specifically.
      // This is a bit redundant but ensures we don't leave any decorations behind.
      if (this.activeEditor) {
        this.activeEditor.setDecorations(this.currentDecoration, []);
        this.activeEditor = null;
      }

      // This prevents memory leaks.
      this.currentDecoration.dispose();
      this.currentDecoration = null;

      // Clear the current tooltip text.
      this.currentTooltipText = null;
    }

    if (this.disposables.length > 0) {
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
    }
  }

  public async hideAllNextEditWindowsAndResetCompletionId() {
    await this.hideAllNextEditWindows();

    // Log with accept = false.
    await vscode.commands.executeCommand(
      "incontrol.logNextEditOutcomeReject",
      this.mostRecentCompletionId,
      this.loggingService,
    );

    this.mostRecentCompletionId = null;
  }

  /**
   * Accept the current next edit suggestion by inserting it at cursor position.
   */
  private async acceptNextEdit() {
    if (this.activeEditor === null || this.currentTooltipText === null) {
      return;
    }
    this.accepted = true;

    const editor = this.activeEditor;
    const text = this.currentTooltipText;
    const position = editor.selection.active;

    let success = false;

    // Hide windows first for a snappier feel.
    await this.hideAllNextEditWindows();

    if (this.textApplier) {
      success = await this.textApplier.applyText(
        editor,
        text,
        position,
        this.finalCursorPos,
      );
    } else {
      // Define the range to replace.
      const startPos = new vscode.Position(this.editableRegionStartLine, 0);
      const endPosChar = editor.document.lineAt(this.editableRegionEndLine).text
        .length;

      const endPos = new vscode.Position(
        this.editableRegionEndLine,
        endPosChar,
      );
      const editRange = new vscode.Range(startPos, endPos);

      if (this.isLineDelete) {
        // Handle line deletion - extend the range to include the newline.
        let lineDeleteRange = editRange;

        // If this isn't the last line, extend to include the newline character.
        if (this.editableRegionStartLine < editor.document.lineCount - 1) {
          lineDeleteRange = new vscode.Range(
            startPos,
            new vscode.Position(this.editableRegionStartLine + 1, 0),
          );
        }

        success = await editor.edit((editBuilder) => {
          editBuilder.delete(lineDeleteRange);
        });
      } else {
        success = await editor.edit((editBuilder) => {
          editBuilder.replace(editRange, text);
        });
      }
    }

    if (success && this.finalCursorPos) {
      // Move cursor to the final position if available.
      editor.selection = new vscode.Selection(
        this.finalCursorPos,
        this.finalCursorPos,
      );
    }

    // Log with accept = true.
    await vscode.commands.executeCommand(
      "incontrol.logNextEditOutcomeAccept",
      this.mostRecentCompletionId,
      this.loggingService,
    );
    this.mostRecentCompletionId = null;

    // Reset to false for future logging.
    this.accepted = false;
  }

  /**
   * Dispose of the NextEditWindowManager.
   */
  public dispose() {
    void this.resetKeyReservation().catch((err) =>
      console.error(`Failed to reset keys on dispose: ${err}`),
    );

    // Dispose current decoration.
    if (this.currentDecoration) {
      this.currentDecoration.dispose();
      this.currentDecoration = null;
    }

    // Dispose all other disposables.
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  /**
   * Setup listeners for editor and cursor position changes. Theme and font
   * changes need no handling: the preview uses ThemeColor and inherits the
   * editor font, so VS Code re-renders it by itself.
   */
  private setupListeners() {
    // Listen for editor changes to clean up decorations when editor closes.
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(async () => {
        // If our active editor is no longer visible, clear decorations.
        if (
          this.activeEditor &&
          !vscode.window.visibleTextEditors.includes(this.activeEditor)
        ) {
          if (this.mostRecentCompletionId) {
            this.loggingService.cancelRejectionTimeout(
              this.mostRecentCompletionId,
            );
          }
          await this.hideAllNextEditWindows();
        }
      }),
    );

    // Listen for selection changes to hide tooltip when cursor moves.
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(async (e) => {
        // If the selection changed in our active editor, hide the tooltip.
        if (this.activeEditor && e.textEditor === this.activeEditor) {
          // If the cursor moved because of something other than accepting next edit, stop logging it.
          if (!this.accepted && this.mostRecentCompletionId) {
            this.loggingService.cancelRejectionTimeout(
              this.mostRecentCompletionId,
            );
          }
          await this.hideAllNextEditWindows();
        }
      }),
    );
  }

  private shouldRenderTip(uri: vscode.Uri): boolean {
    const isAllowedUri =
      !this.excludedURIPrefixes.some((prefix) =>
        uri.toString().startsWith(prefix),
      ) && uri.scheme !== "comment";

    const isEnabled =
      !!vscode.workspace
        .getConfiguration(EXTENSION_NAME)
        .get<boolean>("showInlineTip") === true;

    return isAllowedUri && isEnabled;
  }

  /**
   * Build one decoration per predicted line. Row i is anchored at the end of
   * editor line `editableRegionStartLine + i`, which is exactly where the old
   * image window used to paint it. Rows that would fall past the end of the
   * document are folded into the last available row.
   */
  private buildPreviewRows(
    editor: vscode.TextEditor,
    position: vscode.Position,
    predictedCode: string,
    editableRegionStartLine: number,
    newDiffLines: DiffLine[],
  ): vscode.DecorationOptions[] {
    const doc = editor.document;
    const tabSizeOption = editor.options?.tabSize;
    const tabSize = typeof tabSizeOption === "number" ? tabSizeOption : 4;

    const predictedLines = predictedCode
      .split("\n")
      .map((line) => expandTabs(line.replace(/\r$/, ""), tabSize));

    const availableRows = doc.lineCount - editableRegionStartLine;
    const rowCount = Math.min(predictedLines.length, availableRows);
    if (rowCount <= 0) {
      return [];
    }

    const rowTexts = predictedLines.slice(0, rowCount);
    if (predictedLines.length > rowCount) {
      rowTexts[rowCount - 1] = [
        rowTexts[rowCount - 1],
        ...predictedLines.slice(rowCount),
      ].join(PREVIEW.overflowSeparator);
    }

    const hostLines = rowTexts.map((_, i) =>
      doc.lineAt(editableRegionStartLine + i),
    );
    const blockColumn =
      Math.max(
        ...hostLines.map((line) => visualColumns(line.text, tabSize)),
      ) + PREVIEW.gapColumns;
    const blockWidth = Math.max(
      ...rowTexts.map((text) => visualColumns(text, tabSize)),
    );

    // Lines the model added, matched by content the same way the old
    // highlighter annotated them (each diff entry marks one row).
    const addedLineBudget = new Map<string, number>();
    for (const diffLine of newDiffLines ?? []) {
      if (diffLine.type === "new") {
        addedLineBudget.set(
          diffLine.line,
          (addedLineBudget.get(diffLine.line) ?? 0) + 1,
        );
      }
    }
    const cursorRow = position.line - editableRegionStartLine;
    const lastRow = rowCount - 1;
    const hoverMessage = [this.buildHideTooltipHoverMsg()];

    return rowTexts.map((text, i) => {
      const host = hostLines[i];
      const anchor = new vscode.Position(
        editableRegionStartLine + i,
        host.text.length,
      );
      const gap = blockColumn - visualColumns(host.text, tabSize);

      const rawLine = predictedCode.split("\n")[i] ?? "";
      const remaining = addedLineBudget.get(rawLine) ?? 0;
      const isAdded = remaining > 0;
      if (isAdded) {
        addedLineBudget.set(rawLine, remaining - 1);
      }
      const isCursorRow = i === cursorRow;

      const borderWidth =
        rowCount === 1
          ? "1px"
          : i === 0
            ? "1px 1px 0 1px"
            : i === lastRow
              ? "0 1px 1px 1px"
              : "0 1px 0 1px";
      const radius: string[] = [];
      if (i === 0) {
        radius.push(
          `border-top-left-radius: ${PREVIEW.cornerRadius}`,
          `border-top-right-radius: ${PREVIEW.cornerRadius}`,
        );
      }
      if (i === lastRow) {
        radius.push(
          `border-bottom-left-radius: ${PREVIEW.cornerRadius}`,
          `border-bottom-right-radius: ${PREVIEW.cornerRadius}`,
        );
      }
      const tint = isCursorRow
        ? PREVIEW.cursorRowTint
        : isAdded
          ? PREVIEW.addedRowTint
          : undefined;

      // `textDecoration` is passed through verbatim, which is the established
      // way in this code base to hand extra CSS to an attachment.
      const extraCss = [
        "none",
        "white-space: pre",
        "display: inline-block",
        "height: 100%",
        "vertical-align: top",
        "box-sizing: border-box",
        ...radius,
        ...(tint ? [`box-shadow: inset 0 0 0 100vmax ${tint}`] : []),
      ].join("; ");

      return {
        range: new vscode.Range(anchor, anchor),
        hoverMessage,
        renderOptions: {
          after: {
            contentText: ` ${padToColumns(text, blockWidth, tabSize)} `,
            margin: `0 0 0 ${gap}ch`,
            color: PREVIEW.textColor(),
            backgroundColor: PREVIEW.background(),
            border: `solid; border-width: ${borderWidth}`,
            borderColor: PREVIEW.border(),
            textDecoration: extraCss,
          },
        },
      };
    });
  }

  private buildHideTooltipHoverMsg() {
    const hoverMarkdown = new vscode.MarkdownString(
      `[Reject (Esc)](command:${HIDE_NEXT_EDIT_SUGGESTION_COMMAND}) | [Accept (Tab)](command:${ACCEPT_NEXT_EDIT_SUGGESTION_COMMAND})`,
    );

    hoverMarkdown.isTrusted = true;
    hoverMarkdown.supportHtml = true;
    return hoverMarkdown;
  }

  private isValidRange(
    editor: vscode.TextEditor,
    range: vscode.Range,
  ): boolean {
    const doc = editor.document;

    // Check if line numbers are valid.
    if (range.start.line < 0 || range.start.line >= doc.lineCount) {
      console.debug(
        "Invalid start line:",
        range.start.line,
        "doc lines:",
        doc.lineCount,
      );
      return false;
    }

    if (range.end.line < 0 || range.end.line >= doc.lineCount) {
      console.debug(
        "Invalid end line:",
        range.end.line,
        "doc lines:",
        doc.lineCount,
      );
      return false;
    }

    // Check if character positions are valid.
    const startLine = doc.lineAt(range.start.line);
    const endLine = doc.lineAt(range.end.line);

    if (
      range.start.character < 0 ||
      range.start.character > startLine.text.length
    ) {
      console.debug(
        "Invalid start character:",
        range.start.character,
        "line length:",
        startLine.text.length,
      );
      return false;
    }

    if (range.end.character < 0 || range.end.character > endLine.text.length) {
      console.debug(
        "Invalid end character:",
        range.end.character,
        "line length:",
        endLine.text.length,
      );
      return false;
    }

    return true;
  }

  /**
   * Render the preview block for the predicted code next to the edit region.
   */
  private async renderWindow(
    editor: vscode.TextEditor,
    position: vscode.Position,
    originalCode: string,
    predictedCode: string,
    editableRegionStartLine: number,
    newDiffLines: DiffLine[],
    diffChars: DiffChar[],
  ) {
    const rows = this.buildPreviewRows(
      editor,
      position,
      predictedCode,
      editableRegionStartLine,
      newDiffLines,
    );
    if (rows.length === 0) {
      console.debug("Nothing to preview for text:", predictedCode);
      return;
    }

    for (const row of rows) {
      if (!this.isValidRange(editor, row.range)) {
        console.error("Invalid range detected, skipping decoration");
        return;
      }
    }

    const decoration = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    // Store the decoration and editor.
    this.currentDecoration = decoration;
    this.disposables.push(decoration);

    editor.setDecorations(decoration, rows);

    // Clear the timeout while the preview is on the editor.
    if (this.currentDecoration && this.mostRecentCompletionId)
      this.loggingService.cancelRejectionTimeoutButKeepCompletionId(
        this.mostRecentCompletionId,
      );
  }

  private renderDeletions(editor: vscode.TextEditor, oldDiffChars: DiffChar[]) {
    const charsToDelete: vscode.DecorationOptions[] = [];

    // const diffChars = myersCharDiff(oldEditRangeSlice, newEditRangeSlice);

    oldDiffChars.forEach((diff) => {
      // TODO: This check if technically redundant.
      if (diff.type === "old") {
        charsToDelete.push({
          range: new vscode.Range(
            new vscode.Position(
              this.editableRegionStartLine + diff.oldLineIndex!,
              diff.oldCharIndexInLine!,
            ),
            new vscode.Position(
              this.editableRegionStartLine + diff.oldLineIndex!,
              diff.oldCharIndexInLine! + diff.char.length,
            ),
          ),
        });
      }
    });

    const deleteDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("diffEditor.removedTextBackground"),
    });

    editor.setDecorations(deleteDecorationType, charsToDelete);
    this.disposables.push(deleteDecorationType);
  }

  public hasAccepted() {
    return this.accepted;
  }

  public registerSelectionChangeHandler(): void {
    const manager = SelectionChangeManager.getInstance();

    manager.registerListener(
      "nextEditWindowManager",
      async (e, state) => {
        if (state.nextEditWindowAccepted) {
          console.debug(
            "NextEditWindowManager: Edit was just accepted, preserving chain",
          );
          return true;
        }
        return false;
      },
      HandlerPriority.CRITICAL,
    );
  }
}

export default async function setupNextEditWindowManager(
  context: vscode.ExtensionContext,
  textApplier?: TextApplier,
) {
  await NextEditWindowManager.getInstance().setupNextEditWindowManager(
    context,
    textApplier,
  );
}
