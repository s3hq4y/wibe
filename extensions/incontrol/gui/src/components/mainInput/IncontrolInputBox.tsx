import { Editor, JSONContent } from "@tiptap/react";
import {
  ContextItemWithId,
  InputModifiers,
  RuleMetadata,
  SlashCommandSource,
} from "core";
import { memo, useMemo } from "react";
import { defaultBorderRadius } from "..";
import { t } from "../../i18n";
import { useAppSelector } from "../../redux/hooks";
import { selectSlashCommandComboBoxInputs } from "../../redux/selectors";
import { ContextItemsPeek } from "./belowMainInput/ContextItemsPeek";
import { RulesPeek } from "./belowMainInput/RulesPeek";
import { GradientBorder } from "./GradientBorder";
import { ToolbarOptions } from "./InputToolbar";
import GoalBar from "./GoalBar";
import { Lump } from "./Lump";
import { TipTapEditor } from "./TipTapEditor";

interface IncontrolInputBoxProps {
  isLastUserInput: boolean;
  isMainInput?: boolean;
  onEnter: (
    editorState: JSONContent,
    modifiers: InputModifiers,
    editor: Editor
  ) => void;
  editorState?: JSONContent;
  contextItems?: ContextItemWithId[];
  appliedRules?: RuleMetadata[];
  hidden?: boolean;
  inputId: string; // used to keep track of things per input in redux
}

const EDIT_DISALLOWED_CONTEXT_PROVIDERS = [
  "tree",
  "open",
  "web",
  "diff",
  "folder",
  "search",
  "debugger",
  "repo-map",
];

const EDIT_ALLOWED_SLASH_COMMAND_SOURCES: SlashCommandSource[] = [
  "yaml-prompt-block",
  "mcp-prompt",
  "prompt-file-v1",
  "prompt-file-v2",
  "invokable-rule",
  "json-custom-command",
];

function IncontrolInputBox(props: IncontrolInputBoxProps) {
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const availableSlashCommands = useAppSelector(
    selectSlashCommandComboBoxInputs
  );
  const availableContextProviders = useAppSelector(
    (state) => state.config.config.contextProviders
  );
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const editModeState = useAppSelector((state) => state.editModeState);

  const filteredSlashCommands = useMemo(() => {
    if (isInEdit) {
      return availableSlashCommands.filter((cmd) =>
        cmd.slashCommandSource
          ? EDIT_ALLOWED_SLASH_COMMAND_SOURCES.includes(cmd.slashCommandSource)
          : false
      );
    }
    return availableSlashCommands;
  }, [isInEdit, availableSlashCommands]);

  const filteredContextProviders = useMemo(() => {
    if (isInEdit) {
      return (
        availableContextProviders?.filter(
          (provider) =>
            !EDIT_DISALLOWED_CONTEXT_PROVIDERS.includes(provider.title)
        ) ?? []
      );
    }

    return availableContextProviders ?? [];
  }, [availableContextProviders, isInEdit]);

  const historyKey = isInEdit ? "edit" : "chat";
  const placeholder = isInEdit ? t("Edit selected code") : undefined;

  const toolbarOptions: ToolbarOptions = useMemo(() => {
    if (isInEdit) {
      return {
        hideAddContext: false,
        hideImageUpload: false,
        hideUseCodebase: true,
        hideSelectModel: false,
        enterText:
          editModeState.applyState.status === "done" ? "Retry" : "Edit",
      } as ToolbarOptions;
    }
    // Stable empty object to avoid re-renders from identity changes
    return {} as ToolbarOptions;
  }, [isInEdit, editModeState.applyState.status]);

  const { appliedRules = [], contextItems = [] } = props;

  return (
    <div
      className={`chat-input-surface ${props.hidden ? "hidden" : ""}`}
      data-testid={`incontrol-input-box-${props.inputId}`}
    >
      {props.isMainInput && <GoalBar />}
      <div className={`relative flex w-full min-w-0 max-w-full flex-col px-2`}>
        <GradientBorder
          data-testid="incontrol-input-field"
          loading={isStreaming && (props.isLastUserInput || isInEdit) ? 1 : 0}
          borderRadius={defaultBorderRadius}
        >
          <TipTapEditor
            editorState={props.editorState}
            onEnter={props.onEnter}
            placeholder={placeholder}
            isMainInput={props.isMainInput ?? false}
            availableContextProviders={filteredContextProviders}
            availableSlashCommands={filteredSlashCommands}
            historyKey={historyKey}
            toolbarOptions={toolbarOptions}
            inputId={props.inputId}
          />
        </GradientBorder>
        {props.isMainInput && <Lump />}
      </div>

      {(appliedRules.length > 0 || contextItems.length > 0) && (
        <div className="mt-2 flex flex-col">
          <RulesPeek appliedRules={props.appliedRules} />
          <ContextItemsPeek
            contextItems={props.contextItems}
            isCurrentContextPeek={props.isLastUserInput}
          />
        </div>
      )}
    </div>
  );
}

export default memo(IncontrolInputBox);
