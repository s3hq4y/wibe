import {
  ChatMessage,
  ContextItem,
  MessageContent,
  MessagePart,
  TextMessagePart,
} from "../index";

export function stripImages(messageContent: MessageContent): string {
  if (typeof messageContent === "string") {
    return messageContent;
  }

  return messageContent
    .filter((part) => part.type === "text")
    .map((part) => (part as TextMessagePart).text)
    .join("\n");
}

export function renderChatMessage(message: ChatMessage): string {
  switch (message?.role) {
    case "user":
    case "assistant":
    case "thinking":
    case "system":
      return stripImages(message.content);
    case "tool":
      return message.content;
    default:
      return "";
  }
}

export function renderContextItems(contextItems: ContextItem[]): string {
  return contextItems.map((item) => item.content).join("\n\n");
}

export function renderContextItemsWithStatus(contextItems: any[]): string {
  return contextItems
    .map((item) => {
      let result = item.content;

      // If this item has a status, append it directly after the content
      if (item.status) {
        result += `\n[Status: ${item.status}]`;
      }

      return result;
    })
    .join("\n\n");
}

/**
 * Collect image payloads (data URL or remote URL) from tool-produced context
 * items. Tool results are text-only on the wire, so images carried on
 * ContextItem.imageUrl must be promoted to a user message to reach the model.
 */
export function collectContextItemImages(
  contextItems?: ContextItem[] | null,
): string[] {
  if (!contextItems || contextItems.length === 0) {
    return [];
  }
  const urls: string[] = [];
  for (const item of contextItems) {
    const url = item?.imageUrl;
    if (typeof url === "string" && url.trim()) {
      urls.push(url.trim());
    }
  }
  return urls;
}

/**
 * Build a user message carrying images produced by a tool.
 *
 * Tool messages (`role: "tool"`) have a plain-string content that OpenAI-style
 * providers cannot turn into image parts, so the pixels are emitted as a
 * following user message whose content array holds `imageUrl` parts. Returns
 * undefined when there are no images (so callers can skip insertion entirely).
 */
export function buildToolImageUserMessage(
  imageUrls: string[],
  note: string,
): ChatMessage | undefined {
  if (!imageUrls || imageUrls.length === 0) {
    return undefined;
  }
  const parts: MessagePart[] = imageUrls.map((url) => ({
    type: "imageUrl" as const,
    imageUrl: { url },
  }));
  parts.push({ type: "text", text: note });
  return { role: "user", content: parts };
}

export function normalizeToMessageParts(message: ChatMessage): MessagePart[] {
  switch (message.role) {
    case "user":
    case "assistant":
    case "thinking":
    case "system":
      return Array.isArray(message.content)
        ? message.content
        : [{ type: "text", text: message.content }];
    case "tool":
      return [{ type: "text", text: message.content }];
  }
}
