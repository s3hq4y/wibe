import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { ApplyState } from "core";
import { executeFindAndReplace } from "core/edit/searchAndReplace/performReplace";
import { EditOperation } from "core/tools/definitions/multiEdit";
import { renderContextItems } from "core/util/messageContent";
import { getLastNPathParts, getUriPathBasename } from "core/util/uri";
import { diffLines } from "diff";
import { useContext, useMemo, useState } from "react";
import { ApplyActions } from "../../../components/StyledMarkdownPreview/StepContainerPreToolbar/ApplyActions";
import { FileInfo } from "../../../components/StyledMarkdownPreview/StepContainerPreToolbar/FileInfo";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import {
  selectApplyStateByToolCallId,
  selectToolCallById,
} from "../../../redux/selectors/selectToolCalls";
import { setProcessedToolCallArgs, updateToolCallOutput } from "../../../redux/slices/sessionSlice";
import { EditDiff } from "./EditDiff";
import { getStatusIcon } from "./utils";
import { t } from "../../../i18n";

interface FindAndReplaceDisplayProps {
  fileUri?: string; // Added during args preprocessing
  newFileContents?: string; // Added during args preprocessing
  editingFileContents?: string; // Added args preprocessing
  relativeFilePath?: string;
  edits: EditOperation[];
  toolCallId: string;
  historyIndex: number;
}

function DiffStats({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 font-mono text-xs">
      {added > 0 && <span className="text-success">+{added}</span>}
      {removed > 0 && <span className="text-error">-{removed}</span>}
    </div>
  );
}

export function FindAndReplaceDisplay({
  fileUri,
  newFileContents,
  relativeFilePath,
  editingFileContents,
  edits,
  toolCallId,
  historyIndex,
}: FindAndReplaceDisplayProps) {
  const [isExpanded, setIsExpanded] = useState<boolean | undefined>(undefined);
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const applyState: ApplyState | undefined = useAppSelector((state) =>
    selectApplyStateByToolCallId(state, toolCallId),
  );

  const toolCallState = useAppSelector((state) =>
    selectToolCallById(state, toolCallId),
  );
  const showContent = isExpanded ?? ["generated", "calling", "done"].includes(toolCallState?.status ?? "");
  const [undoState, setUndoState] = useState<"idle" | "busy" | "done">("idle");
  const [undoMessage, setUndoMessage] = useState("");
  const [diffOpenError, setDiffOpenError] = useState("");
  const alreadyUndone = toolCallState?.processedArgs?.editUndone === true;
  async function undoCompletedEdit() {
    if (!fileUri || typeof editingFileContents !== "string" || typeof newFileContents !== "string" || (undoState !== "idle" || alreadyUndone)) return;
    setUndoState("busy");
    try {
      const response = await ideMessenger.request("edit/undoCompleted", {
        filepath: fileUri, before: editingFileContents, after: newFileContents,
      });
      if (response.status !== "success") throw new Error(String(response.error));
      if (!response.content.ok) throw new Error(response.content.message);
      dispatch(setProcessedToolCallArgs({ toolCallId, newArgs: {
        ...toolCallState?.processedArgs, editUndone: true,
      } }));
      dispatch(updateToolCallOutput({ toolCallId, contextItems: [{
        name: "Edit undone", description: fileUri,
        content: `The user undid this edit to ${fileUri}. Read the file again before editing it.`, hidden: true,
      }] }));
      setUndoState("done");
      setUndoMessage(response.content.saved ? t("Edit undone") : t("Edit undone in editor; save the file to persist it"));
    } catch (error) {
      setUndoState("idle");
      setUndoMessage(error instanceof Error ? t(error.message) : String(error));
    }
  }

  const displayName = useMemo(() => {
    if (fileUri) {
      return getUriPathBasename(fileUri);
    }
    if (relativeFilePath) {
      return getLastNPathParts(relativeFilePath, 1);
    }
    return "";
  }, [fileUri, relativeFilePath]);

  // Get file content from tool call state instead of reading file
  const currentFileContent = useMemo(() => {
    if (typeof editingFileContents === "string") {
      return editingFileContents;
    }
    if (Array.isArray(edits)) {
      return edits.map((edit) => edit.old_string ?? "").join("\n");
    }
    return "";
  }, [editingFileContents, edits]);

  const diffResult = useMemo(() => {
    try {
      // Without a full "before", never compare a fragment against a full
      // "after" or pretend the fragment line numbers belong to the file.
      if (typeof editingFileContents !== "string") {
        const after = edits.map(edit => edit.new_string ?? "").join("\n");
        return { diff: diffLines(currentFileContent, after), before: currentFileContent, after, error: null };
      }
      let contentsAfterReplace = newFileContents;
      if (typeof contentsAfterReplace === "undefined") {
        // Apply all edits sequentially
        contentsAfterReplace = currentFileContent;
        for (let i = 0; i < edits.length; i++) {
          const {
            old_string: oldString,
            new_string: newString,
            replace_all: replaceAll,
          } = edits[i];
          contentsAfterReplace = executeFindAndReplace(
            contentsAfterReplace,
            oldString,
            newString,
            !!replaceAll,
            i,
          );
        }
      }

      // Generate diff between original and final content
      const diff = diffLines(currentFileContent, contentsAfterReplace);
      return { diff, before: currentFileContent, after: contentsAfterReplace, error: null };
    } catch (error) {
      return {
        diff: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, [currentFileContent, newFileContents, edits, editingFileContents]);

  async function openDiff(line?: number, side: "before" | "after" = "after") {
    if (!fileUri || !diffResult.diff) return;
    setDiffOpenError("");
    try {
      const response = await ideMessenger.request("edit/showDiff", {
        filepath: fileUri, before: diffResult.before!, after: diffResult.after!,
        scope: typeof editingFileContents === "string" ? "file" : "fragments",
        ...(line === undefined ? {} : { selection: { line, side } }),
      });
      if (response.status !== "success") throw new Error(String(response.error));
    } catch (error) {
      setDiffOpenError(error instanceof Error ? error.message : String(error));
    }
  }

  const diffStats = useMemo(() => {
    if (!diffResult?.diff) {
      return { added: 0, removed: 0 };
    }

    let added = 0;
    let removed = 0;

    diffResult.diff.forEach((part) => {
      const lines = part.value.split("\n");
      // Exclude empty line at the end (similar to DiffLines component logic)
      const lineCount =
        lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

      if (part.added) {
        added += lineCount;
      } else if (part.removed) {
        removed += lineCount;
      }
    });

    return { added, removed };
  }, [diffResult?.diff]);

  const statusIcon = useMemo(() => {
    const status = toolCallState?.status;
    if (status) {
      return (
        <div
          className={`mr-1 h-4 w-4 flex-shrink-0 ${toolCallState.output ? "cursor-pointer" : ""}`}
          onClick={(e) => {
            if (toolCallState.output) {
              e.stopPropagation();
              ideMessenger.post("showVirtualFile", {
                name: "Edit output",
                content: renderContextItems(toolCallState.output),
              });
            }
          }}
        >
          {getStatusIcon(status)}
        </div>
      );
    }
  }, [toolCallState?.status, toolCallState?.output]);

  // Unified container component that always renders the same structure
  const renderContainer = (content: React.ReactNode) => (
    <div className="outline-command-border -outline-offset-0.5 rounded-default bg-editor mx-2 my-1 flex min-w-0 flex-col outline outline-1">
      <div
        className={`find-widget-skip bg-editor sticky -top-2 z-10 m-0 flex cursor-pointer items-center justify-between gap-3 px-1.5 py-1 ${showContent ? "rounded-t-default border-command-border border-b" : "rounded-default"}`}
        onClick={() => {
          setIsExpanded(!showContent);
        }}
      >
        <div className="flex min-w-0 flex-1 flex-row items-center gap-2 text-xs">
          <div className="flex min-w-0 flex-row items-center">
            {statusIcon}
            <ChevronDownIcon
              data-testid="toggle-find-and-replace-diff"
              className={`text-lightgray h-3.5 w-3.5 flex-shrink-0 cursor-pointer select-none transition-all hover:brightness-125 ${
                showContent ? "rotate-0" : "-rotate-90"
              }`}
            />
            <button type="button" disabled={!fileUri}
              className="min-w-0 cursor-pointer border-none bg-transparent p-0 text-inherit hover:underline disabled:cursor-default"
              aria-label={`Compare ${displayName || "file"} before and after`}
              title="Open side-by-side diff"
              onClick={event => {
                event.stopPropagation();
                void openDiff();
              }}>
              <FileInfo filepath={displayName || "..."} />
            </button>
          </div>
          <DiffStats added={diffStats.added} removed={diffStats.removed} />
        </div>

        {toolCallState?.status === "done" && applyState?.status === "closed" &&
          typeof editingFileContents === "string" && typeof newFileContents === "string" && (
          <button type="button" disabled={undoState !== "idle" || alreadyUndone}
            className="text-link cursor-pointer border-none bg-transparent text-xs"
            onClick={(event) => { event.stopPropagation(); void undoCompletedEdit(); }}>
            {undoState === "done" || alreadyUndone ? t("Edit undone") : undoState === "busy" ? t("Undoing edit…") : t("Undo edit")}
          </button>
        )}
        {applyState && (
          <ApplyActions
            onClickAccept={() => {
              ideMessenger.post(`acceptDiff`, {
                filepath: fileUri,
                streamId: applyState.streamId,
                ...(applyState.background ? { background: true, toolCallId } : {}),
              });
            }}
            onClickReject={() => {
              ideMessenger.post(`rejectDiff`, {
                filepath: fileUri,
                streamId: applyState.streamId,
                ...(applyState.background ? { background: true, toolCallId } : {}),
              });
            }}
            disableManualApply={true}
            applyState={applyState}
          />
        )}
      </div>
      {diffOpenError && <div role="alert" className="text-error px-3 py-2 text-xs">{diffOpenError}</div>}
      {undoMessage && <div role="status" className="text-description px-3 py-2 text-xs">{undoMessage}</div>}
      {showContent ? content : null}
    </div>
  );

  if (diffResult?.error) {
    return (
      <div className="text-description mt-2 px-3">
        {t("The searched string was not found in the file")}</div>
    );
  }

  if (
    !diffResult?.diff ||
    (diffResult.diff.length === 1 &&
      !diffResult.diff[0].added &&
      !diffResult.diff[0].removed)
  ) {
    return renderContainer(
      <div className="text-description-muted p-3">{t("No changes to display")}</div>,
    );
  }

  return renderContainer(<EditDiff parts={diffResult.diff}
    isPartial={typeof editingFileContents !== "string"}
    onNavigate={fileUri ? (line, side) => { void openDiff(line, side); } : undefined} />);
}
