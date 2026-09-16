import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareUwaChatMessages } from "./uwaImages";
import { setUwaBridgeEnabled, setUwaSidecarBaseUrl } from "./uwaRequestContext";

const apiBase = "http://127.0.0.1:8199/v1";
const image = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };
const text = (value: string) => ({ type: "text", text: value });
const user = (content: unknown) => ({ role: "user", content });
const assistant = (content: unknown = "Seen the image") => ({ role: "assistant", content });
const prepare = (messages: any[]) => prepareUwaChatMessages(messages, apiBase, "ide");

beforeEach(() => {
  setUwaBridgeEnabled(true, { history_mode: "ide" });
  setUwaSidecarBaseUrl("http://127.0.0.1:8199");
});
afterEach(() => {
  setUwaBridgeEnabled(false);
  setUwaSidecarBaseUrl("");
});

describe("UWA outgoing image scope", () => {
  it("keeps new images on the first request", () => {
    const messages = [user([text("Look at this"), image, image])];
    expect(prepare(messages)).toEqual(messages);
  });
  it("removes historical images but preserves every text/history turn", () => {
    const messages = [user([text("old text"), image]), assistant(), user("continue")];
    expect(prepare(messages)).toEqual([user([text("old text")]), assistant(), user("continue")]);
    expect(messages[0].content).toEqual([text("old text"), image]);
  });
  it("sends an explicitly reattached identical image in a new turn", () => {
    const messages = [user([image]), assistant(), user([text("again"), image])];
    expect(prepare(messages)).toEqual([user(""), assistant(), messages[2]]);
  });
  it("does not upload the latest user's image during a tool continuation", () => {
    const call = { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "read", arguments: "{}" } }] };
    const result = { role: "tool", content: "file contents", tool_call_id: "t1" };
    expect(prepare([user([image]), call, result])).toEqual([user(""), call, result]);
  });
  it("recognizes a tool result even when the assistant was compacted away", () => {
    expect(prepare([user([image]), { role: "tool", content: "" }])[0].content).toBe("");
  });
  it.each(["", "   ", null, [], [text("")]])("keeps images past empty assistant placeholders: %j", (empty) => {
    const messages = [user([image]), assistant(empty)];
    expect(prepare(messages)).toEqual(messages);
  });
  it("can retry a failed request without a sent-image cache losing attachments", () => {
    const messages = [user([image]), assistant("")];
    expect(prepare(messages)).toEqual(messages);
    expect(prepare(messages)).toEqual(messages);
  });
  it("recognizes non-empty assistant text parts", () => {
    expect(prepare([user([image]), assistant([text("Processed")])])[0].content).toBe("");
  });
  it("does not retain historical images when the newest turn has no attachment", () => {
    expect(prepare([user([image]), user("new question")])).toEqual([user(""), user("new question")]);
  });
  it("preserves unrelated multimodal parts and does not rewrite text containing image URLs", () => {
    const audio = { type: "input_audio", input_audio: { data: "AA", format: "wav" } };
    const urlText = text("The word image_url and data:image/png are text");
    expect(prepare([user([image, audio, urlText]), assistant()])[0].content).toEqual([audio, urlText]);
  });
  it.each(["auto", "full", "last", undefined])("leaves explicitly non-IDE modes unchanged: %s", mode => {
    const messages = [user([image]), assistant(), user("continue")];
    expect(prepareUwaChatMessages(messages, apiBase, mode)).toBe(messages);
  });
  it.each(["https://api.openai.com/v1", "http://127.0.0.1:81990/v1", undefined])("leaves other providers unchanged: %s", base => {
    const messages = [user([image]), assistant()];
    expect(prepareUwaChatMessages(messages, base, "ide")).toBe(messages);
  });
  it("leaves disabled bridge requests unchanged", () => {
    setUwaBridgeEnabled(false);
    const messages = [user([image]), assistant()];
    expect(prepare(messages)).toBe(messages);
  });
  it("works with frozen persisted history", () => {
    const messages = [user(Object.freeze([text("keep"), image])), assistant()];
    messages.forEach(Object.freeze);
    Object.freeze(messages);
    expect(prepare(messages)[0].content).toEqual([text("keep")]);
  });
});
