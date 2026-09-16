import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { ToolCallDiv } from "./index";

vi.mock("../../../redux/hooks", () => ({ useAppSelector: () => [] }));
vi.mock("./FunctionSpecificToolCallDiv", () => ({ default: ({ toolCallState }: { toolCallState: ToolCallState }) => <button>details {toolCallState.toolCallId}</button> }));
vi.mock("./MCPAppRenderer", () => ({ McpAppRenderer: () => null }));
vi.mock("./SimpleToolCallUI", () => ({ SimpleToolCallUI: () => null }));
vi.mock("./ToolCallDisplay", () => ({ ToolCallDisplay: () => null }));

const calls = (status: ToolCallState["status"] = "done"): ToolCallState[] => ["one", "two"].map(toolCallId => ({
  toolCallId, status, parsedArgs: {},
  toolCall: { id: toolCallId, type: "function", function: { name: BuiltInToolNames.RunTerminalCommand, arguments: "{}" } },
} as ToolCallState));
const header = () => screen.getByTestId("performing-actions");

describe("compact action groups", () => {
  test.each(["done", "calling", "generated"] as const)("starts %s groups collapsed and hides their controls", status => {
    render(<ToolCallDiv toolCallStates={calls(status)} historyIndex={0} />);
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "details one" })).not.toBeInTheDocument();
    expect(document.getElementById(header().getAttribute("aria-controls")!)).toHaveAttribute("hidden");
  });
  test("one chevron click expands once, another collapses", () => {
    render(<ToolCallDiv toolCallStates={calls()} historyIndex={0} />);
    fireEvent.click(header().querySelector("svg")!);
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "details one" })).toBeVisible();
    fireEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });
  test("supports Enter and Space without a mouse", async () => {
    const user = userEvent.setup();
    render(<ToolCallDiv toolCallStates={calls()} historyIndex={0} />);
    header().focus();
    await user.keyboard("{Enter}");
    expect(header()).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });
  test("preserves manual expansion and stops the title shimmer on completion", () => {
    const { rerender } = render(<ToolCallDiv toolCallStates={calls("calling")} historyIndex={0} />);
    expect(header().querySelector('[data-running="true"]')).not.toBeNull();
    fireEvent.click(header());
    rerender(<ToolCallDiv toolCallStates={calls()} historyIndex={0} />);
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(header()).toHaveTextContent("Performed 2 actions");
    expect(header().querySelector('[data-running="true"]')).toBeNull();
  });
  test("does not expand when streaming becomes a complete action group", () => {
    const { rerender } = render(<ToolCallDiv toolCallStates={calls("generating")} historyIndex={0} />);
    expect(screen.queryByTestId("performing-actions")).toBeNull();
    rerender(<ToolCallDiv toolCallStates={calls("calling")} historyIndex={0} />);
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });
  test("keeps a single action directly accessible", () => {
    render(<ToolCallDiv toolCallStates={calls().slice(0, 1)} historyIndex={0} />);
    expect(screen.getByRole("button", { name: "details one" })).toBeVisible();
    expect(screen.queryByTestId("performing-actions")).toBeNull();
  });
});
