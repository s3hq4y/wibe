import {
  ChatHistoryItem,
  ChatMessage,
  ContextItemWithId,
  RuleMetadata,
  RuleWithSource,
  TextMessagePart,
  ToolResultChatMessage,
  UserChatMessage,
} from "core";
import { chatMessageIsEmpty } from "core/llm/messages";
import { getSystemMessageWithRules } from "core/llm/rules/getSystemMessageWithRules";
import { RulePolicies } from "core/llm/rules/types";
import { BuiltInToolNames } from "core/tools/builtIn";
import {
  CANCELLED_TOOL_CALL_MESSAGE,
  ERRORED_TOOL_CALL_OUTPUT_MESSAGE,
  NO_TOOL_CALL_OUTPUT_MESSAGE,
} from "core/tools/constants";
import { convertToolCallStatesToSystemCallsAndOutput } from "core/tools/systemMessageTools/convertSystemTools";
import { SystemMessageToolsFramework } from "core/tools/systemMessageTools/types";
import { findLast, findLastIndex } from "core/util/findLast";
import {
  buildToolImageUserMessage,
  collectContextItemImages,
  normalizeToMessageParts,
  renderContextItems,
  renderContextItemsWithStatus,
} from "core/util/messageContent";
import { toolCallStateToContextItems } from "../../pages/gui/ToolCallDiv/utils";

// Helper function to render context items and append status information
// Helper function to render context items and append status information

interface MessageWithContextItems {
  ctxItems: ContextItemWithId[];
  message: ChatMessage;
}
export function constructMessages(
  history: ChatHistoryItem[],
  baseSystemMessage: string | undefined,
  availableRules: RuleWithSource[],
  rulePolicies: RulePolicies,
  useSystemToolsFramework?: SystemMessageToolsFramework,
): {
  messages: ChatMessage[];
  appliedRules: RuleMetadata[];
  appliedRuleIndex: number;
} {
  // Find the most recent conversation summary and filter history accordingly
  let summaryContent = "";
  let filteredHistory = history;

  for (let i = history.length - 1; i >= 0; i--) {
    const summary = history[i].conversationSummary;
    if (summary) {
      summaryContent = summary;
      // Only include messages that come AFTER the message with the summary
      filteredHistory = history.slice(i + 1);
      break;
    }
  }

  const historyCopy = [...filteredHistory];

  // Index of the newest assistant message. Tool-produced images are only
  // re-attached while that tool round is still the freshest assistant turn;
  // once the model has produced a newer reply we stop resending the (possibly
  // multi-megabyte) image on every subsequent request. uwa applies an
  // equivalent "latest un-answered turn only" rule in prepareUwaChatMessages.
  let lastAssistantIndex = -1;
  for (let i = historyCopy.length - 1; i >= 0; i--) {
    if (historyCopy[i].message.role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  const msgs: MessageWithContextItems[] = [];
  let appliedRuleIndex = -1;
  let index = -1;
  for (const item of historyCopy) {
    index++;
    if (
      item.message.role === "system" ||
      item.message.role === "tool" ||
      chatMessageIsEmpty(item.message)
    ) {
      // Tool messages will be re-inserted
      continue;
    }

    if (item.message.role === "user") {
      appliedRuleIndex = index;
      // Gather context items for user messages
      let content = normalizeToMessageParts(item.message);

      const ctxItemParts = item.contextItems
        .map((ctxItem) => {
          return {
            type: "text",
            text: `${ctxItem.content}\n`,
          } as TextMessagePart;
        })
        .filter((part) => !!part.text.trim());

      content = [...ctxItemParts, ...content];
      msgs.push({
        ctxItems: item.contextItems,
        message: {
          ...item.message,
          content,
        },
      });
    } else if (item.message.role === "thinking") {
      msgs.push({
        ctxItems: item.contextItems,
        message: item.message,
      });
    } else if (item.message.role === "assistant") {
      // When using system message tools, convert tool calls/states to text content
      if (item.toolCallStates?.length && useSystemToolsFramework) {
        const { userMessage, assistantMessage } =
          convertToolCallStatesToSystemCallsAndOutput(
            item.message,
            item.toolCallStates ?? [],
            useSystemToolsFramework,
          );
        msgs.push({
          message: assistantMessage,
          ctxItems: [],
        });
        // Tool results are text-only here as well, so any image a tool
        // produced (e.g. fetch_image's ContextItem.imageUrl) is appended to
        // the synthetic user message as `imageUrl` parts. Without this the
        // pixels would be dropped whenever the model runs through the
        // system-message-tools framework instead of native tool calls.
        if (index === lastAssistantIndex) {
          const toolImages = collectContextItemImages(
            (item.toolCallStates ?? []).flatMap((tc) => tc.output ?? []),
          );
          if (toolImages.length > 0) {
            const baseContent = normalizeToMessageParts(userMessage);
            userMessage.content = [
              ...toolImages.map((url) => ({
                type: "imageUrl" as const,
                imageUrl: { url },
              })),
              ...baseContent,
              {
                type: "text" as const,
                text: "Image(s) returned by the tool call(s) above. Inspect them directly.",
              },
            ];
          }
        }
        msgs.push({
          message: userMessage,
          ctxItems: [],
        });
        continue;
      }

      msgs.push({
        ctxItems: item.contextItems,
        message: item.message,
      });

      // Add a tool message for each tool call
      if (item.toolCallStates?.length) {
        // If the assistant message has tool calls, we need to insert tool messages
        for (const toolCallState of item.toolCallStates) {
          const { output, status, toolCall } = toolCallState;
          let content: string = NO_TOOL_CALL_OUTPUT_MESSAGE;

          if (status === "canceled") {
            content = CANCELLED_TOOL_CALL_MESSAGE;
          } else if (output) {
            if (
              toolCall.function?.name == BuiltInToolNames.RunTerminalCommand
            ) {
              // Add status for tools containing detailed status outcomes per context item
              content = renderContextItemsWithStatus(output);
            } else {
              content = renderContextItems(output);
            }
          } else if (toolCallState.status === "errored") {
            content = ERRORED_TOOL_CALL_OUTPUT_MESSAGE;
          }

          msgs.push({
            ctxItems: toolCallStateToContextItems(toolCallState),
            message: {
              role: "tool",
              content,
              toolCallId: toolCall.id!,
            },
          });

          // Tool results are text-only on the wire, so any image a tool
          // produced (e.g. fetch_image's ContextItem.imageUrl) is promoted to
          // a following user message. OpenAI-style providers only turn
          // `imageUrl` parts into image payloads inside user/assistant content
          // arrays, never inside a `role: "tool"` string.
          if (index === lastAssistantIndex) {
            const toolImages = collectContextItemImages(output);
            const imageMessage = buildToolImageUserMessage(
              toolImages,
              `Image returned by the ${toolCall.function?.name ?? "tool"} tool.`,
            );
            if (imageMessage) {
              msgs.push({ ctxItems: [], message: imageMessage });
            }
          }
        }
      } else if (item.toolCallStates && item.toolCallStates.length > 0) {
        // This case indicates a potential mismatch - we have tool call states but no message.toolCalls
        console.error(
          "ERROR constructMessages: Assistant message has toolCallStates but no message.toolCalls:",
          {
            toolCallStates: item.toolCallStates.length,
            toolCallIds: item.toolCallStates.map((s) => s.toolCallId),
            messageContent:
              typeof item.message.content === "string"
                ? item.message.content?.substring(0, 50) + "..."
                : "Non-string content",
          },
        );
      }
    }
  }

  // Some rules only apply to the last user or tool message
  const lastUserOrToolMsg = findLast(
    msgs,
    (item) => item.message.role === "user" || item.message.role === "tool",
  )?.message as UserChatMessage | ToolResultChatMessage;

  // Some rules apply to all context items since the last user message, inclusiv
  const lastUserMsgIndex = findLastIndex(
    msgs,
    (item) => item.message.role === "user",
  );
  const itemsBackToLastUserMessage = msgs
    .slice(lastUserMsgIndex, msgs.length)
    .filter(
      (item) => item.message.role === "tool" || item.message.role === "user",
    );
  const rulesContextItems = itemsBackToLastUserMessage
    .map((item) => item.ctxItems)
    .flat();

  const { systemMessage, appliedRules } = getSystemMessageWithRules({
    baseSystemMessage,
    availableRules,
    userMessage: lastUserOrToolMsg,
    contextItems: rulesContextItems,
    rulePolicies,
  });

  // Append conversation summary to system message if it exists
  let finalSystemMessage = systemMessage;
  if (summaryContent) {
    finalSystemMessage = systemMessage
      ? `${systemMessage}\n\nPrevious conversation summary:\n\n ${summaryContent}`
      : `Previous conversation summary:\n\n ${summaryContent}`;
  }

  if (finalSystemMessage.trim()) {
    msgs.unshift({
      ctxItems: [],
      message: {
        role: "system",
        content: finalSystemMessage,
      },
    });
  }

  const messages = msgs.map((m) => m.message);
  return {
    messages,
    appliedRules,
    appliedRuleIndex,
  };
}
