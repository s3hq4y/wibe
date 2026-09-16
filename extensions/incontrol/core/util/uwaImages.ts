import { isUwaModelApiBase } from "./uwaRequestContext";

type WireMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  function_call?: unknown;
};

function hasAssistantResponse(message: WireMessage): boolean {
  // A tool result also proves that the preceding model request has run.
  if (message.role === "tool" || message.role === "function") return true;
  if (message.role !== "assistant") return false;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  if (message.function_call) return true;
  if (typeof message.content === "string") return message.content.trim().length > 0;
  if (Array.isArray(message.content)) {
    return message.content.some((part) =>
      part && typeof part === "object" &&
      (("text" in part && typeof part.text === "string" && part.text.trim().length > 0) ||
        ("refusal" in part && typeof part.refusal === "string" && part.refusal.trim().length > 0)),
    );
  }
  return false;
}

/**
 * UWA IDE conversations already retain prior attachments in the web conversation.
 * Its upload extractor scans the entire payload, unlike ordinary multimodal APIs.
 * Filter only the outgoing wire copy, never persisted chat messages/thumbnails.
 *
 * Keep the latest user's attachments until a substantive assistant/tool response.
 * Empty streaming placeholders and failed requests therefore remain retryable;
 * a tool continuation does not re-upload that user's image. No URL/hash cache is
 * used, so explicitly attaching the same image in a new turn still sends it.
 */
export function prepareUwaChatMessages<T extends WireMessage>(
  messages: T[],
  apiBase: string | undefined,
  historyMode: unknown,
): T[] {
  if (!isUwaModelApiBase(apiBase) || String(historyMode).toLowerCase() !== "ide") {
    return messages;
  }
  let latestUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      latestUser = i;
      break;
    }
  }
  const latestUserHandled = messages.slice(latestUser + 1).some(hasAssistantResponse);
  return messages.map((message, index) => {
    if (message.role !== "user" || !Array.isArray(message.content) ||
        (index === latestUser && !latestUserHandled)) return message;
    const content = message.content.filter((part) =>
      !part || typeof part !== "object" || !["image_url", "imageUrl", "input_image"].includes(part.type),
    );
    if (content.length === message.content.length) return message;
    // Image-only historical turns remain present, but are valid empty text turns.
    return { ...message, content: content.length > 0 ? content : "" };
  });
}
