/**
 * UTF-8 hardening for Windows PowerShell launched by the terminal tool.
 *
 * Windows consoles default to the legacy ANSI/OEM code page (936 on Chinese systems),
 * so without preparation PowerShell writes stdout/stderr in GBK, Get-Content reads
 * UTF-8 files as GBK, and a syntax error in the user command is reported (in GBK)
 * before any inline "$OutputEncoding = utf8" prelude has a chance to run, because
 * the whole -Command string is parsed first.
 *
 * buildPowerShellUtf8Command therefore switches the encodings first and only then
 * compiles the user command from a base64 payload. Parse errors are re-emitted on
 * stderr (UTF-8) with exit code 1; otherwise the command's own $LASTEXITCODE wins,
 * and a failed last statement (e.g. an unknown command) yields exit code 1 like
 * plain -Command does.
 * The result is plain UTF-8 on both streams, so callers can decode with a normal
 * UTF-8 StringDecoder instead of guessing between UTF-8 and GBK.
 */
import { StringDecoder } from "node:string_decoder";

const PS_PRELUDE =
  "$__u = New-Object System.Text.UTF8Encoding($false); " +
  "[Console]::InputEncoding = $__u; [Console]::OutputEncoding = $__u; $OutputEncoding = $__u; " +
  "$PSDefaultParameterValues['*:Encoding'] = 'utf8'; " +
  "$env:PYTHONIOENCODING = 'utf-8'; $env:PYTHONUTF8 = '1'; ";

export function buildPowerShellUtf8Command(command: string): string {
  const payload = Buffer.from(command, "utf8").toString("base64");
  return (
    PS_PRELUDE +
    "try { $__c = [ScriptBlock]::Create([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" +
    payload +
    "'))) } " +
    "catch { $__m = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }; $Host.UI.WriteErrorLine($__m); exit 1 }; " +
    "$__e = $Error.Count; & $__c; if ($LASTEXITCODE -ne $null) { exit $LASTEXITCODE }; if ($Error.Count -gt $__e) { exit 1 }"
  );
}

/** argv for powershell.exe that runs `command` with UTF-8 input/output. */
export function buildWindowsShellCommand(command: string): {
  shell: string;
  args: string[];
} {
  return {
    shell: "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      buildPowerShellUtf8Command(command),
    ],
  };
}

/**
 * Streaming-safe UTF-8 decoder. Multi-byte characters can be split across chunks,
 * so a per-stream StringDecoder must be used instead of Buffer#toString per chunk.
 */
export function createUtf8StreamDecoder(): {
  write: (chunk: Buffer) => string;
  end: () => string;
} {
  const decoder = new StringDecoder("utf8");
  return {
    write: (chunk: Buffer) => decoder.write(chunk),
    end: () => decoder.end(),
  };
}
