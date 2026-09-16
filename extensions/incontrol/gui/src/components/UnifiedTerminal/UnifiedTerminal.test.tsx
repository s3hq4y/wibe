import { screen } from "@testing-library/react";
import { ToolCallState } from "core";
import { renderWithProviders } from "../../util/test/render";
import { UnifiedTerminalCommand } from "./UnifiedTerminal";

const mockDispatch = vi.fn();
vi.mock("../../redux/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
const titleButton = () => screen.getByTestId("terminal-command-title").closest("button")!;
const longOutput = Array.from({length: 100}, (_, i) => `Output line ${i + 1}`).join("\n");

describe("all terminal operations use compact titles", () => {
  test.each(["npm test", "python script.py", "Get-Content -Path 'sokoban.html' -Raw", "cat a.txt | grep text"])("starts collapsed for %s", async command => {
    const { container } = await renderWithProviders(<UnifiedTerminalCommand command={command} output="hidden result" />);
    expect(titleButton()).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).not.toContain("hidden result");
    expect(screen.getByRole("status")).toHaveTextContent("Completed");
  });
  test("uses readable file titles and specific command titles", async () => {
    await renderWithProviders(<UnifiedTerminalCommand command="npm test" />);
    expect(screen.getByTestId("terminal-command-title")).toHaveTextContent("Run npm test");
  });
  test("keeps the full multiline command available after expansion", async () => {
    const command = "echo one\necho two";
    const { user, container } = await renderWithProviders(<UnifiedTerminalCommand command={command} output="result" />);
    expect(screen.getByTestId("terminal-command-title")).toHaveTextContent("Run echo one");
    await user.click(titleButton());
    expect(container.querySelector("pre")?.textContent).toContain(command);
  });
  test("one click shows all returned output, and another collapses it", async () => {
    const { user, container } = await renderWithProviders(<UnifiedTerminalCommand command="npm test" output={longOutput} displayLines={3} />);
    await user.click(titleButton());
    expect(titleButton()).toHaveAttribute("aria-expanded", "true");
    expect(container.textContent).toContain("Output line 1");
    expect(container.textContent).toContain("Output line 100");
    expect(screen.queryByText(/more lines/)).not.toBeInTheDocument();
    await user.click(titleButton());
    expect(container.querySelector("pre")).toBeNull();
  });
  test("can expand using the keyboard", async () => {
    const { user } = await renderWithProviders(<UnifiedTerminalCommand command="npm test" output="result" />);
    titleButton().focus();
    await user.keyboard("{Enter}");
    expect(titleButton()).toHaveAttribute("aria-expanded", "true");
  });
  test("preserves ANSI formatting and links in expanded output", async () => {
    const { user, container } = await renderWithProviders(<UnifiedTerminalCommand command="npm test" output={'\u001b[32mTest passed\u001b[0m\nhttps://example.com'} />);
    await user.click(titleButton());
    expect(container.querySelector("code")?.textContent).toContain("Test passed");
    expect(container.querySelector('a[href="https://example.com"]')).toBeInTheDocument();
  });
  test("keeps run/copy actions in the collapsed header", async () => {
    const { container } = await renderWithProviders(<UnifiedTerminalCommand command="npm test" output="result" />);
    expect(container.textContent).toContain("Run");
    expect(screen.getByText("Run", {exact: true})).toBeInTheDocument();
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(1);
    expect(container.querySelector("pre")).toBeNull();
  });
  test("can move a running command to background without opening output", async () => {
    const { user } = await renderWithProviders(<UnifiedTerminalCommand command="npm test" status="running" toolCallId="tool-1" />);
    mockDispatch.mockClear(); // Ignore setup actions from the provider harness.
    await user.click(screen.getByRole("button", {name: "Move to background"}));
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(titleButton()).toHaveAttribute("aria-expanded", "false");
  });
  test("preserves the user's expansion choice as output and status change", async () => {
    const { user, rerender } = await renderWithProviders(<UnifiedTerminalCommand command="npm test" status="running" output="first" />);
    await user.click(titleButton());
    rerender(<UnifiedTerminalCommand command="npm test" status="completed" output="first second" />);
    expect(titleButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("terminal-command-title")).toHaveAttribute("data-running", "false");
  });
  test("incoming output does not expand a collapsed command", async () => {
    const { rerender, container } = await renderWithProviders(<UnifiedTerminalCommand command="npm test" status="running" />);
    rerender(<UnifiedTerminalCommand command="npm test" status="running" output="new output" />);
    expect(titleButton()).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("pre")).toBeNull();
  });
});

describe("terminal title status and shimmer", () => {
  test.each(["running", "completed", "failed", "background"] as const)("shows %s without opening output", async status => {
    await renderWithProviders(<UnifiedTerminalCommand command="npm test" status={status} output="details" />);
    expect(screen.getByRole("status")).toHaveTextContent(new RegExp(status, "i"));
    expect(screen.getByTestId("terminal-command-title")).toHaveAttribute("data-running", String(status === "running"));
  });
  test.each(["completed", "failed", "background"] as const)("stops shimmer for %s even if calling state is stale", async status => {
    await renderWithProviders(<UnifiedTerminalCommand command="npm test" status={status} toolCallState={{status:"calling"} as ToolCallState} />);
    expect(screen.getByTestId("terminal-command-title")).toHaveAttribute("data-running", "false");
  });
  test("keeps failure details available on expansion", async () => {
    const { user } = await renderWithProviders(<UnifiedTerminalCommand command="npm test" status="failed" output="Permission denied" statusMessage="failed: exit code 1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Failed");
    expect(screen.queryByText("Permission denied")).not.toBeInTheDocument();
    await user.click(titleButton());
    expect(screen.getByText("Permission denied")).toBeInTheDocument();
    expect(screen.getByText("failed: exit code 1")).toBeInTheDocument();
  });
});

test("command cards no longer stack large outer and inner margins", async () => {
  await renderWithProviders(<UnifiedTerminalCommand command="cat sokoban.html" />);
  const card = screen.getByTestId("terminal-container");
  expect(card).toHaveClass("my-0");
  expect(card).not.toHaveClass("mb-4");
  expect(card.firstElementChild).toHaveClass("my-0");
});
