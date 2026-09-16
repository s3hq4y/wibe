import { fireEvent, render, screen } from "@testing-library/react";
import ThinkingBlockPeek from "./ThinkingBlockPeek";

vi.mock("../../StyledMarkdownPreview", () => ({ default: ({ source }: { source: string }) => <a href="#detail">{source}</a> }));
const props = { content: "reasoning content", index: 0, prevItem: null };
const toggle = () => screen.getByTestId("thinking-block-peek");
const panel = () => document.getElementById(toggle().getAttribute("aria-controls")!)!;

test("starts collapsed, with hidden content inert", () => {
  render(<ThinkingBlockPeek {...props} />);
  expect(toggle()).toHaveAttribute("aria-expanded", "false");
  expect(panel()).toHaveAttribute("inert");
  expect(panel()).toHaveAttribute("aria-hidden", "true");
});
test("opens and closes without replacing the content during animation", () => {
  render(<ThinkingBlockPeek {...props} />);
  const content = screen.getByText("reasoning content");
  fireEvent.click(toggle());
  expect(panel()).not.toHaveAttribute("inert");
  expect(toggle()).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(toggle());
  expect(screen.getByText("reasoning content")).toBe(content);
  expect(panel()).toHaveAttribute("inert");
});
test("incoming thinking text never overrides the user's expansion choice", () => {
  const { rerender } = render(<ThinkingBlockPeek {...props} inProgress />);
  expect(toggle().querySelector('[data-running="true"]')).not.toBeNull();
  fireEvent.click(toggle());
  rerender(<ThinkingBlockPeek {...props} content="longer reasoning" inProgress />);
  expect(toggle()).toHaveAttribute("aria-expanded", "true");
  rerender(<ThinkingBlockPeek {...props} inProgress={false} tokens={42} />);
  expect(toggle()).toHaveAttribute("aria-expanded", "true");
  expect(toggle().querySelector('[data-running="true"]')).toBeNull();
  expect(toggle()).toHaveTextContent("Thought");
  expect(toggle()).toHaveTextContent("42 tokens");
});
test("retains redacted reasoning behavior", () => {
  const { rerender } = render(<ThinkingBlockPeek {...props} redactedThinking="redacted" />);
  expect(screen.queryByText("reasoning content")).toBeNull();
  expect(toggle()).toHaveTextContent("Redacted Thinking");
  rerender(<ThinkingBlockPeek {...props} redactedThinking="redacted" prevItem={{ message: { role: "thinking", content: "", redactedThinking: "redacted" } } as any} />);
  expect(screen.queryByTestId("thinking-block-peek")).toBeNull();
});
