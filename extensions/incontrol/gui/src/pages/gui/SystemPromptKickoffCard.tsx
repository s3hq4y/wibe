import { ArrowUpIcon } from "@heroicons/react/24/outline";
import {
  Button as FluentButton,
  Card as FluentCard,
  Text,
} from "@fluentui/react-components";
import type { JSONContent } from "@tiptap/react";
import { ToolTip } from "../../components/gui/Tooltip";
import { useMainEditor } from "../../components/mainInput/TipTapEditor";
import { useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { MANUAL_SYSTEM_PROMPT_TEMPLATE } from "../../util/systemPromptTemplate";
import { t } from "../../i18n";

/**
 * One-line paragraph per source line: tiptap stores the text of a paragraph as
 * a single text node, so line breaks only survive as separate paragraphs.
 */
function toEditorDoc(text: string): JSONContent {
  const content = text.split("\n").map((line) =>
    line.length > 0
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" },
  );
  return { type: "doc", content };
}

/**
 * Shown on an empty chat. Sends the prompt that is currently in effect for
 * manual-system-prompt mode as the first message of the session: the text saved
 * in Settings -> General if there is one, otherwise the built-in template.
 *
 * It goes through the main editor on purpose (insert, then the same submit the
 * Enter key uses) so context items, mode and model selection behave exactly as
 * a hand-typed message instead of a parallel code path.
 */
export function SystemPromptKickoffCard() {
  const { mainEditor, onEnterRef } = useMainEditor();
  const savedPrompt = useAppSelector(
    (state) => state.config.config.ui?.manualSystemMessage?.trim() ?? "",
  );
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const chatModel = useAppSelector(selectSelectedChatModel);

  const prompt = savedPrompt || MANUAL_SYSTEM_PROMPT_TEMPLATE;
  const blockedReason = !chatModel
    ? t("Select a chat model first")
    : isStreaming
      ? t("Wait for the current response to finish")
      : !mainEditor
        ? t("The input box is not ready yet")
        : "";
  const canSend = blockedReason === "";

  function handleSend() {
    if (!mainEditor || !canSend) {
      return;
    }
    mainEditor.commands.setContent(toEditorDoc(prompt));
    // The editor assigns this ref on mount; optional chaining keeps the click
    // safe if it fires before the handler is wired up.
    onEnterRef.current?.({ useCodebase: false, noContext: true });
  }

  return (
    <FluentCard
      size="medium"
      className="flex w-full flex-row items-center justify-between gap-3 rounded-[var(--fluent-radius)] border border-solid border-[var(--fluent-stroke-muted)] bg-input px-3 py-2.5 shadow-[var(--fluent-shadow-2)]"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <Text size={400} weight="semibold">
          {t("Send system prompt")}
        </Text>
        <Text
          size={200}
          wrap
          className="text-description"
          style={{ lineHeight: 1.35 }}
        >
          {t("Sends the active system prompt as this session's first message.")}{" "}
          {savedPrompt
            ? t("Using the prompt saved in settings")
            : t("Using the built-in tool template")}
            {" · "}
          {prompt.length} {t("characters")}
        </Text>
        {blockedReason && (
          <Text size={200} wrap style={{ color: "var(--fluent-fg-muted)" }}>
            {blockedReason}
          </Text>
        )}
      </div>
      <ToolTip
        content={canSend ? t("Sends the active system prompt as this session's first message.") : blockedReason}
        place="top"
        className="text-xs"
      >
        <FluentButton
          appearance="primary"
          size="medium"
          icon={<ArrowUpIcon className="h-4 w-4" />}
          disabled={!canSend}
          onClick={handleSend}
          data-testid="send-system-prompt-button"
        >
          {t("Send")}
        </FluentButton>
      </ToolTip>
    </FluentCard>
  );
}

export default SystemPromptKickoffCard;
