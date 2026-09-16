import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApplyState } from "core";
import { EditOperation } from "core/tools/definitions/multiEdit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FindAndReplaceDisplay } from "./FindAndReplace";

const { mockRequest, mockPost } = vi.hoisted(() => ({ mockRequest: vi.fn(), mockPost: vi.fn() }));

// Mock the dependencies
vi.mock("../../../context/IdeMessenger", () => ({
  IdeMessengerContext: {
    _currentValue: { post: vi.fn() },
  },
}));

vi.mock("../../../redux/hooks", () => ({
  useAppSelector: vi.fn(),
  useAppDispatch: () => vi.fn(),
}));

vi.mock("../../../components/ui", () => ({
  useFontSize: () => 14,
}));

vi.mock("core/edit/searchAndReplace/performReplace", () => ({
  executeFindAndReplace: vi.fn(),
}));

vi.mock("./utils", () => ({
  getStatusIcon: vi.fn(() => <div data-testid="status-icon">✓</div>),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    useContext: () => ({ post: mockPost, request: mockRequest }),
  };
});

// Import mocked modules
import { executeFindAndReplace } from "core/edit/searchAndReplace/performReplace";
import { useAppSelector } from "../../../redux/hooks";

const mockUseAppSelector = useAppSelector as any;
const mockExecuteFindAndReplace = executeFindAndReplace as any;

describe("FindAndReplaceDisplay", () => {
  const defaultProps = {
    fileUri: "file:///test/file.ts",
    relativeFilePath: "test/file.ts",
    editingFileContents: "const old = 'value';\nconst other = 'test';",
    edits: [
      {
        old_string: "const old = 'value';",
        new_string: "const new = 'value';",
        replace_all: false,
      },
    ] as EditOperation[],
    toolCallId: "test-tool-call-id",
    historyIndex: 0,
  };

  const mockToolCallState = {
    status: "done" as const,
    output: null,
  };

  const mockConfig = {
    ui: {
      showChatScrollbar: true,
      codeWrap: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue({ status: "success", content: undefined });

    mockUseAppSelector.mockImplementation((selector: any) => {
      const mockState = {
        config: { config: mockConfig },
        session: {
          history: [],
          codeBlockApplyStates: { states: [] },
        },
      };

      if (selector.toString().includes("selectApplyStateByToolCallId")) {
        return undefined; // No apply state by default
      }
      if (selector.toString().includes("selectToolCallById")) {
        return mockToolCallState;
      }

      return selector(mockState);
    });

    mockExecuteFindAndReplace.mockImplementation(
      (content: string, oldStr: string, newStr: string) => {
        return content.replace(oldStr, newStr);
      },
    );
  });

  describe("side-by-side snapshot review without losing the chat diff", () => {
    const expected = {
      filepath: defaultProps.fileUri, before: defaultProps.editingFileContents,
      after: "const new = 'value';\nconst other = 'test';", scope: "file",
    };
    it("opens immutable before/after snapshots from the title", () => {
      render(<FindAndReplaceDisplay {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: "Compare file.ts before and after" }));
      expect(mockRequest).toHaveBeenCalledWith("edit/showDiff", expected);
      expect(mockPost).not.toHaveBeenCalled();
      expect(screen.getByText("const new = 'value';")).toBeVisible();
      expect(screen.getByText("const old = 'value';")).toBeVisible();
    });
    it("selects additions in the modified snapshot", () => {
      render(<FindAndReplaceDisplay {...defaultProps} />);
      fireEvent.click(screen.getByText("const new = 'value';"));
      expect(mockRequest).toHaveBeenCalledWith("edit/showDiff", { ...expected, selection: { side: "after", line: 0 } });
    });
    it("selects deleted lines in the original snapshot, not their surviving boundary", () => {
      render(<FindAndReplaceDisplay {...defaultProps} editingFileContents={"a\nx\ny\n"} newFileContents={"a\n"} />);
      fireEvent.click(screen.getByText("y"));
      expect(mockRequest).toHaveBeenCalledWith("edit/showDiff", expect.objectContaining({ before: "a\nx\ny\n", after: "a\n", selection: { side: "before", line: 2 } }));
    });
    it("labels fragment history and never mixes a partial before with a full after", () => {
      render(<FindAndReplaceDisplay {...defaultProps} editingFileContents={undefined} newFileContents="unrelated full file" />);
      fireEvent.click(screen.getByText("const new = 'value';"));
      expect(mockRequest).toHaveBeenCalledWith("edit/showDiff", {
        filepath: defaultProps.fileUri, before: "const old = 'value';", after: "const new = 'value';",
        scope: "fragments", selection: { side: "after", line: 0 },
      });
      expect(screen.getByText(/full file snapshot unavailable/)).toBeVisible();
      expect(mockPost).not.toHaveBeenCalled();
    });
    it("does not send unresolved paths", () => {
      render(<FindAndReplaceDisplay {...defaultProps} fileUri={undefined} />);
      expect(screen.getByRole("button", { name: "Compare file.ts before and after" })).toBeDisabled();
      fireEvent.click(screen.getByText("const new = 'value';"));
      expect(mockRequest).not.toHaveBeenCalled();
    });
    it("keeps snapshots after undo rather than swapping sides or reading the live file", () => {
      mockUseAppSelector.mockImplementation((selector: any) => selector.toString().includes("selectToolCallById") ? { ...mockToolCallState, processedArgs: { editUndone: true } } : undefined);
      render(<FindAndReplaceDisplay {...defaultProps} />);
      fireEvent.click(screen.getByText("const new = 'value';"));
      expect(mockRequest).toHaveBeenCalledWith("edit/showDiff", { ...expected, selection: { side: "after", line: 0 } });
    });
    it("keeps whitespace-only changes and empty new files as real snapshots", () => {
      render(<FindAndReplaceDisplay {...defaultProps} editingFileContents={"  old\n"} newFileContents="" />);
      fireEvent.click(screen.getByRole("button", { name: "Compare file.ts before and after" }));
      expect(mockRequest).toHaveBeenCalledWith("edit/showDiff", { ...expected, before: "  old\n", after: "" });
    });
    it("shows an open failure without hiding the chat diff or modifying files", async () => {
      mockRequest.mockResolvedValue({ status: "error", error: "Diff unavailable" });
      render(<FindAndReplaceDisplay {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: "Compare file.ts before and after" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Diff unavailable"));
      expect(screen.getByText("const old = 'value';")).toBeVisible();
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  describe("basic rendering", () => {
    it("should keep completed edit differences expanded by default", () => {
      render(<FindAndReplaceDisplay {...defaultProps} />);

      expect(screen.getByText("file.ts")).toBeInTheDocument();
      expect(
        screen.getByTestId("toggle-find-and-replace-diff"),
      ).toBeInTheDocument();

      expect(screen.getByText("const old = 'value';")).toBeInTheDocument();
      expect(screen.getByText("const new = 'value';")).toBeInTheDocument();
    });

    it("should display file name from fileUri", () => {
      render(<FindAndReplaceDisplay {...defaultProps} />);
      expect(screen.getByText("file.ts")).toBeInTheDocument();
    });

    it("should display file name from relativeFilePath when no fileUri", () => {
      render(
        <FindAndReplaceDisplay
          {...defaultProps}
          fileUri={undefined}
          relativeFilePath="src/components/test.tsx"
        />,
      );
      expect(screen.getByText("test.tsx")).toBeInTheDocument();
    });

    it("should handle missing file paths gracefully", () => {
      render(
        <FindAndReplaceDisplay
          {...defaultProps}
          fileUri={undefined}
          relativeFilePath={undefined}
        />,
      );

      // Should still render the component structure
      expect(
        screen.getByTestId("toggle-find-and-replace-diff"),
      ).toBeInTheDocument();
    });
  });

  describe("expand/collapse functionality", () => {
    it("should collapse and re-expand when clicked", () => {
      render(<FindAndReplaceDisplay {...defaultProps} />);


      const toggleButton = screen.getByTestId("toggle-find-and-replace-diff");
      fireEvent.click(toggleButton);
      expect(screen.queryByText("const new = 'value';")).not.toBeInTheDocument();
      fireEvent.click(toggleButton);
      // Should show diff content when expanded
      expect(screen.getByText("−")).toBeInTheDocument();
      expect(screen.getByText("+")).toBeInTheDocument();
    });

    it("should show content when tool call status is 'generated'", () => {
      mockUseAppSelector.mockImplementation((selector: any) => {
        const mockState = {
          config: { config: mockConfig },
          session: {
            history: [],
            codeBlockApplyStates: { states: [] },
          },
        };

        if (selector.toString().includes("selectToolCallById")) {
          return { ...mockToolCallState, status: "generated" };
        }
        if (selector.toString().includes("selectApplyStateByToolCallId")) {
          return undefined;
        }

        return selector(mockState);
      });

      render(<FindAndReplaceDisplay {...defaultProps} />);

      // Should show diff content without expanding
      expect(screen.getByText("−")).toBeInTheDocument();
      expect(screen.getByText("+")).toBeInTheDocument();
    });
  });

  describe("diff generation", () => {
    it("should generate and display diff correctly", () => {
      render(<FindAndReplaceDisplay {...defaultProps} />);


      // Should show removed line
      expect(screen.getByText("const old = 'value';")).toBeInTheDocument();

      // Should show added line
      expect(screen.getByText("const new = 'value';")).toBeInTheDocument();

      // Should show unchanged line
      expect(screen.getByText("const other = 'test';")).toBeInTheDocument();
    });

    it("should handle multiple edits", () => {
      const multipleEdits = [
        {
          old_string: "const old = 'value';",
          new_string: "const new = 'value';",
          replace_all: false,
        },
        {
          old_string: "const other = 'test';",
          new_string: "const other = 'updated';",
          replace_all: false,
        },
      ] as EditOperation[];

      mockExecuteFindAndReplace
        .mockReturnValueOnce("const new = 'value';\nconst other = 'test';")
        .mockReturnValueOnce("const new = 'value';\nconst other = 'updated';");

      render(<FindAndReplaceDisplay {...defaultProps} edits={multipleEdits} />);


      expect(mockExecuteFindAndReplace).toHaveBeenCalledTimes(2);
    });

    it("should handle diff generation errors", () => {
      mockExecuteFindAndReplace.mockImplementation(() => {
        throw new Error("Test error");
      });

      render(<FindAndReplaceDisplay {...defaultProps} />);

      // When diff generation errors, component shows a friendly message
      // without rendering the expand/collapse container
      expect(
        screen.getByText("The searched string was not found in the file"),
      ).toBeInTheDocument();
    });

    it("should show 'No changes to display' when diff is empty", () => {
      // Mock the function to return the exact same content (no changes)
      mockExecuteFindAndReplace.mockReturnValue(
        defaultProps.editingFileContents,
      );

      render(<FindAndReplaceDisplay {...defaultProps} />);


      expect(screen.getByText("No changes to display")).toBeInTheDocument();
    });
  });

  describe("apply actions", () => {
    const mockApplyState: ApplyState = {
      streamId: "test-stream-id",
      status: "streaming",
      numDiffs: 1,
      fileContent: "test content",
    };

    beforeEach(() => {
      mockUseAppSelector.mockImplementation((selector: any) => {
        const mockState = {
          config: { config: mockConfig },
          session: {
            history: [],
            codeBlockApplyStates: { states: [mockApplyState] },
          },
        };

        if (selector.toString().includes("selectApplyStateByToolCallId")) {
          return mockApplyState;
        }
        if (selector.toString().includes("selectToolCallById")) {
          return mockToolCallState;
        }

        return selector(mockState);
      });
    });

    it("should show apply actions when applyState exists", () => {
      render(<FindAndReplaceDisplay {...defaultProps} />);

      // ApplyActions component should be rendered (we can test by looking for its structure)
      // Since we don't have the exact structure, we test that the container is there
      expect(
        screen.getByTestId("toggle-find-and-replace-diff"),
      ).toBeInTheDocument();
    });

    it("should handle accept action", () => {
      render(<FindAndReplaceDisplay {...defaultProps} />);

      // This would need more detailed testing if ApplyActions was properly mocked
      // For now, we verify the component renders without errors
      expect(
        screen.getByTestId("toggle-find-and-replace-diff"),
      ).toBeInTheDocument();
    });
  });

  describe("content handling", () => {
    it("should use editingFileContents when provided", () => {
      render(<FindAndReplaceDisplay {...defaultProps} />);


      expect(mockExecuteFindAndReplace).toHaveBeenCalledWith(
        "const old = 'value';\nconst other = 'test';",
        "const old = 'value';",
        "const new = 'value';",
        false,
        0,
      );
    });

    it("shows paired edit fragments when the full original is unavailable", () => {
      render(<FindAndReplaceDisplay {...defaultProps} editingFileContents={undefined} />);
      expect(mockExecuteFindAndReplace).not.toHaveBeenCalled();
      expect(screen.getByText("const old = 'value';")).toBeVisible();
      expect(screen.getByText("const new = 'value';")).toBeVisible();
      expect(screen.getByText(/full file snapshot unavailable/)).toBeVisible();
    });
  });
  describe("completed edit undo", () => {
    beforeEach(() => {
      mockUseAppSelector.mockImplementation((selector: any) => {
        if (selector.toString().includes("selectApplyStateByToolCallId")) return { status: "closed", streamId: "s" };
        return mockToolCallState;
      });
    });
    it("sends exact snapshots and disables repeated undo after success", async () => {
      mockRequest.mockResolvedValue({status: "success", content: {ok: true, saved: true}});
      render(<FindAndReplaceDisplay {...defaultProps} newFileContents="new contents" />);
      fireEvent.click(screen.getByRole("button", {name: "Undo edit"}));
      await waitFor(() => expect(screen.getByRole("button", {name: "Edit undone"})).toBeDisabled());
      expect(mockRequest).toHaveBeenCalledWith("edit/undoCompleted", {
        filepath: defaultProps.fileUri, before: defaultProps.editingFileContents, after: "new contents",
      });
    });
    it("shows conflicts without pretending the undo succeeded", async () => {
      mockRequest.mockResolvedValue({status: "success", content: {ok: false, message: "Newer changes protected"}});
      render(<FindAndReplaceDisplay {...defaultProps} newFileContents="new contents" />);
      fireEvent.click(screen.getByRole("button", {name: "Undo edit"}));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Newer changes protected"));
      expect(screen.getByRole("button", {name: "Undo edit"})).not.toBeDisabled();
    });
  });

});
