import { describe, expect, it } from "vitest";
import { terminalReadTarget } from "./terminalReadTitle";
describe("terminal file read titles", () => {
  it("recognizes the reported PowerShell read", () => expect(terminalReadTarget('Get-Content -Path "sokoban.html" -Raw -Encoding UTF8')).toBe("sokoban.html"));
  it("preserves quoted paths with spaces", () => expect(terminalReadTarget('Get-Content -LiteralPath "C:\\my files\\game.html" -Raw')).toBe("C:\\my files\\game.html"));
  it("recognizes simple cross-platform reads", () => {
    expect(terminalReadTarget("cat a.txt b.txt")).toBe("a.txt, b.txt");
    expect(terminalReadTarget("head -n 20 a.txt")).toBe("a.txt");
    expect(terminalReadTarget("type a.txt")).toBe("a.txt");
  });
  it.each(["npm test", "python script.py", "cat a > b", "cat a; rm b", "Get-Content a | Set-Content b", "cat $(cmd)", "Get-Content", 'cat "unclosed'])("keeps ambiguous or non-read commands unchanged: %s", command => expect(terminalReadTarget(command)).toBeUndefined());
});
