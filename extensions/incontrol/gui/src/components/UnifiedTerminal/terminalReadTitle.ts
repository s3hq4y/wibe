// Presentation-only heuristic, NOT a security classifier. Ambiguous commands
// retain the ordinary terminal UI rather than being labelled as simple reads.
export function terminalReadTarget(command: string): string | undefined {
  if (/[;&|<>\r\n`$()]/.test(command)) return undefined;
  const tokens = command.trim().match(/"[^"]*"|'[^']*'|[^\s]+/g);
  if (!tokens?.length) return undefined;
  const tool = tokens.shift()!.toLowerCase();
  if (!["get-content", "gc", "cat", "type", "head", "tail"].includes(tool)) return undefined;
  const files: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const flag = token.toLowerCase();
    if (["-path", "-literalpath"].includes(flag)) {
      const path = tokens[++i];
      if (!path || path.startsWith("-")) return undefined;
      files.push(path);
    } else if (["-encoding", "-totalcount", "-tail", "-readcount"].includes(flag) ||
      (["head", "tail"].includes(tool) && ["-n", "-c"].includes(flag))) {
      if (!tokens[++i]) return undefined;
    } else if (["-raw", "-wait", "--"].includes(flag) || (tool === "cat" && ["-n", "-b", "-s"].includes(flag))) {
      continue;
    } else if (token.startsWith("-")) return undefined;
    else files.push(token);
  }
  if (!files.length) return undefined;
  const unquoted = files.map(path => path.replace(/^(["'])(.*)\1$/, "$2"));
  if (unquoted.some(path => !path || /["']/.test(path))) return undefined;
  return unquoted.join(", ");
}
