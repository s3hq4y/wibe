import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "./llms/OpenAI";
import { consumeUwaFields, markNextRequest, setUwaBridgeEnabled, setUwaSidecarBaseUrl } from "../util/uwaRequestContext";

const base = "http://127.0.0.1:8199/v1";
const image = { type: "imageUrl", imageUrl: { url: "data:image/png;base64,AAAA" } };
const history: any[] = [{ role: "user", content: [{ type: "text", text: "old" }, image] }, { role: "assistant", content: "understood" }, { role: "user", content: "continue" }];
const reply = { id: "r1", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
async function exhaust(iterable: AsyncIterable<unknown>) { for await (const _ of iterable) { /* consume */ } }

beforeEach(() => {
  setUwaBridgeEnabled(true, { history_mode: "ide" });
  setUwaSidecarBaseUrl("http://127.0.0.1:8199");
});
afterEach(() => {
  consumeUwaFields();
  setUwaBridgeEnabled(false);
  setUwaSidecarBaseUrl("");
  vi.restoreAllMocks();
});

describe("UWA image policy on actual request assembly paths", () => {
  it.each([false, true])("filters the direct path, streaming=%s", async stream => {
    const model = new OpenAI({ model: "gpt-4o", apiBase: base });
    const response = stream ? `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n` : JSON.stringify(reply);
    const fetch = vi.spyOn(model, "fetch").mockResolvedValue(new Response(response) as any);
    await exhaust((model as any)._streamChat(history, new AbortController().signal, { model: "gpt-4o", stream }));
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.history_mode).toBe("ide");
    expect(body.messages[0].content).toEqual([{ type: "text", text: "old" }]);
    expect(history[0].content).toContain(image);
  });
  it("does not attach UWA fields or consume one-shot state on other providers", async () => {
    markNextRequest({ force_new_conversation: true });
    const model = new OpenAI({ model: "gpt-4o", apiBase: "https://api.openai.com/v1" });
    const fetch = vi.spyOn(model, "fetch").mockResolvedValue(new Response(JSON.stringify(reply)) as any);
    await exhaust((model as any)._streamChat(history, new AbortController().signal, { model: "gpt-4o", stream: false }));
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.history_mode).toBeUndefined();
    expect(body.messages[0].content.some((part: any) => part.type === "image_url")).toBe(true);
    expect(consumeUwaFields()?.force_new_conversation).toBe(true);
  });
  it.each(["gpt-4o", "gpt-5"])("filters adapter requests and keeps %s on the UWA bridge route", async modelName => {
    const model = new OpenAI({ model: modelName, apiBase: base });
    const request = vi.fn().mockResolvedValue(reply);
    (model as any).openaiAdapter = { chatCompletionNonStream: request };
    vi.spyOn(model as any, "_logEnd").mockReturnValue("success");
    await exhaust(model.streamChat(history, new AbortController().signal, { stream: false, log: false }, { precompiled: true }));
    expect(request).toHaveBeenCalledOnce();
    const body = request.mock.calls[0][0];
    expect(body.history_mode).toBe("ide");
    expect(body.messages[0].content).toEqual([{ type: "text", text: "old" }]);
  });
});
