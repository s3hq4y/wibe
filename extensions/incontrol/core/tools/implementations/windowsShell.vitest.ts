import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildPowerShellUtf8Command,
  buildWindowsShellCommand,
  createUtf8StreamDecoder,
} from "./windowsShell";

describe("buildPowerShellUtf8Command", () => {
  it("sets UTF-8 encodings before compiling the user command from base64", () => {
    const cmd = buildPowerShellUtf8Command("Write-Output '中文'");
    const payload = Buffer.from("Write-Output '中文'", "utf8").toString("base64");
    expect(cmd).toContain("[Console]::OutputEncoding = $__u");
    expect(cmd).toContain("$PSDefaultParameterValues['*:Encoding'] = 'utf8'");
    expect(cmd).toContain(payload);
    expect(cmd.indexOf("[Console]::OutputEncoding")).toBeLessThan(cmd.indexOf("[ScriptBlock]::Create"));
    // The raw command must not be embedded, so argv decoding can never corrupt it.
    expect(cmd).not.toContain("Write-Output '中文'");
  });

  it("launches powershell.exe without the user profile and non-interactively", () => {
    const { shell, args } = buildWindowsShellCommand("dir");
    expect(shell).toBe("powershell.exe");
    expect(args).toContain("-NoProfile");
    expect(args).toContain("-NonInteractive");
    expect(args[args.length - 2]).toBe("-Command");
  });
});

describe("createUtf8StreamDecoder", () => {
  it("joins a multi-byte character split across chunks", () => {
    const bytes = Buffer.from("中文", "utf8"); // 6 bytes
    const d = createUtf8StreamDecoder();
    const a = d.write(bytes.subarray(0, 4));
    const b = d.write(bytes.subarray(4));
    expect(a + b + d.end()).toBe("中文");
  });
});

const isWin = process.platform === "win32";
const hasPowerShell =
  isWin && spawnSync("where.exe", ["powershell.exe"], { encoding: "utf8" }).status === 0;

describe.skipIf(!hasPowerShell)("Windows PowerShell UTF-8 end to end", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "windows-shell-utf8-"));
  const file = path.join(dir, "中文.txt");
  fs.writeFileSync(file, "中文测试：你好，世界！— probe ✓\n", "utf8");
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (command: string) => {
    const { shell, args } = buildWindowsShellCommand(command);
    const r = spawnSync(shell, args, { cwd: dir, windowsHide: true });
    const out = createUtf8StreamDecoder();
    const err = createUtf8StreamDecoder();
    return {
      status: r.status,
      stdout: out.write(r.stdout) + out.end(),
      stderr: err.write(r.stderr) + err.end(),
    };
  };

  it("reads UTF-8 files and echoes Chinese on stdout", () => {
    const r = run(`Get-Content '${file}'; Write-Output '直接输出中文'`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("中文测试：你好，世界！— probe ✓");
    expect(r.stdout).toContain("直接输出中文");
  });

  it("reports runtime errors in UTF-8", () => {
    const r = run("Write-Error '运行期错误中文'; nonexist-命令");
    expect(r.stderr).toContain("运行期错误中文");
    expect(r.stderr).toContain("nonexist-命令");
    expect(r.stderr).not.toMatch(/\uFFFD/);
  });

  it("reports parse errors in UTF-8 with exit code 1", () => {
    const r = run("Write-Output '解析错误前' ||| x");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("解析错误前");
    expect(r.stderr).not.toMatch(/\uFFFD/);
  });

  it("exits 1 when the last statement fails, like plain -Command", () => {
    const r = run("nonexist-命令-xyz");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nonexist-命令-xyz");
  });

  it("propagates the exit code of the user command", () => {
    const r = run("Write-Output '中文'; cmd /c exit 7");
    expect(r.status).toBe(7);
    expect(r.stdout).toContain("中文");
  });
});
