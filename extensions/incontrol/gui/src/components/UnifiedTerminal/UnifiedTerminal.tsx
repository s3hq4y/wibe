import { ChevronDownIcon } from "@heroicons/react/24/outline";
import Anser, { AnserJsonEntry } from "anser";
import { ToolCallState } from "core";
import { escapeCarriageReturn } from "escape-carriage";
import { useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";
import { useAppDispatch } from "../../redux/hooks";
import { moveTerminalProcessToBackground } from "../../redux/thunks/moveTerminalProcessToBackground";
import { getFontSize } from "../../util";
import { CopyButton } from "../StyledMarkdownPreview/StepContainerPreToolbar/CopyButton";
import { RunInTerminalButton } from "../StyledMarkdownPreview/StepContainerPreToolbar/RunInTerminalButton";
import { t } from "../../i18n";
import { terminalReadTarget } from "./terminalReadTitle";

const titleSweep = keyframes`
  from { background-position: 200% center; }
  to { background-position: -200% center; }
`;

const CommandTitle = styled.span<{ $running: boolean }>`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: 8px;
  color: var(--vscode-foreground, var(--foreground));
  ${({ $running }) => $running && `
    @supports ((background-clip: text) or (-webkit-background-clip: text)) {
      background-image: linear-gradient(105deg,
        var(--vscode-descriptionForeground, var(--foreground)) 25%,
        var(--vscode-textLink-foreground, #4daafc) 45%,
        var(--vscode-foreground, var(--foreground)) 50%,
        var(--vscode-textLink-foreground, #4daafc) 55%,
        var(--vscode-descriptionForeground, var(--foreground)) 75%);
      background-size: 250% 100%;
      background-clip: text;
      -webkit-background-clip: text;
      color: transparent;
    }
  `}
  animation: ${({ $running }) => $running ? titleSweep : "none"} 2.4s linear infinite;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    background-image: none;
    color: var(--vscode-foreground, var(--foreground));
  }
  @media (forced-colors: active) {
    animation: none;
    background-image: none;
    color: CanvasText;
  }
`;

const blinkCursor = keyframes`
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
`;

const BlinkingCursor = styled.span`
  &::after {
    content: "█";
    animation: ${blinkCursor} 1s infinite;
    color: var(--foreground);
  }
`;

const AnsiSpan = styled.span<{
  bg?: string;
  fg?: string;
  decoration?: string;
}>`
  ${({ bg }) => bg && `background-color: rgb(${bg});`}
  ${({ fg }) => fg && `color: rgb(${fg});`}
  ${({ decoration }) => {
    switch (decoration) {
      case "bold":
        return "font-weight: bold;";
      case "dim":
        return "opacity: 0.5;";
      case "italic":
        return "font-style: italic;";
      case "hidden":
        return "visibility: hidden;";
      case "strikethrough":
        return "text-decoration: line-through;";
      case "underline":
        return "text-decoration: underline;";
      case "blink":
        return "text-decoration: blink;";
      default:
        return "";
    }
  }}
`;

const AnsiLink = styled.a`
  color: var(--link);
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const StyledTerminalContainer = styled.div<{
  fontSize?: number;
}>`
  background-color: var(--background);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  font-size: ${(props) => props.fontSize || getFontSize()}px;
  color: var(--foreground);
  line-height: 1.5;

  > *:last-child {
    margin-bottom: 0;
  }
`;

const TerminalContent = styled.div`
  pre {
    white-space: pre-wrap;
    max-width: 100%;
    overflow-x: scroll;
    overflow-y: auto;
    max-height: 60vh;
    padding: 8px;
    margin: 0;
  }

  code {
    span.line:empty {
      display: none;
    }
    word-wrap: break-word;
    border-radius: 0.5rem;
    background-color: var(--editor-background);
    font-size: ${getFontSize() - 2}px;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas,
      "Liberation Mono", Menlo, monospace;
  }

  code:not(pre > code) {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas,
      "Liberation Mono", Menlo, monospace;
    color: var(--input-placeholder);
  }
`;

function ansiToJSON(
  input: string,
  use_classes: boolean = false
): AnserJsonEntry[] {
  input = escapeCarriageReturn(fixBackspace(input));
  return Anser.ansiToJson(input, {
    json: true,
    remove_empty: true,
    use_classes,
  });
}

function createClass(bundle: AnserJsonEntry): string | null {
  let classNames: string = "";

  if (bundle.bg) {
    classNames += `${bundle.bg}-bg `;
  }
  if (bundle.fg) {
    classNames += `${bundle.fg}-fg `;
  }
  if (bundle.decoration) {
    classNames += `ansi-${bundle.decoration} `;
  }

  if (classNames === "") {
    return null;
  }

  classNames = classNames.substring(0, classNames.length - 1);
  return classNames;
}

function convertBundleIntoReact(
  linkify: boolean,
  useClasses: boolean,
  bundle: AnserJsonEntry,
  key: number
): JSX.Element {
  const className = useClasses ? createClass(bundle) : null;
  const decorationProp = bundle.decoration
    ? String(bundle.decoration)
    : undefined;

  if (!linkify) {
    return (
      <AnsiSpan
        key={key}
        className={className || undefined}
        bg={useClasses ? undefined : bundle.bg}
        fg={useClasses ? undefined : bundle.fg}
        decoration={decorationProp}
      >
        {bundle.content}
      </AnsiSpan>
    );
  }

  const content: React.ReactNode[] = [];
  const linkRegex = /(\s|^)(https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]{2,})/g;

  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(bundle.content)) !== null) {
    const [, pre, url] = match;

    const startIndex = match.index + pre.length;
    if (startIndex > index) {
      content.push(bundle.content.substring(index, startIndex));
    }

    const href = url.startsWith("www.") ? `http://${url}` : url;

    content.push(
      <AnsiLink key={index} href={href} target="_blank">
        {url}
      </AnsiLink>
    );

    index = linkRegex.lastIndex;
  }

  if (index < bundle.content.length) {
    content.push(bundle.content.substring(index));
  }

  return (
    <AnsiSpan
      key={key}
      className={className || undefined}
      bg={useClasses ? undefined : bundle.bg}
      fg={useClasses ? undefined : bundle.fg}
      decoration={decorationProp}
    >
      {content}
    </AnsiSpan>
  );
}

function fixBackspace(txt: string) {
  let tmp = txt;
  do {
    txt = tmp;
    tmp = txt.replace(/[^\n]\x08/gm, "");
  } while (tmp.length < txt.length);
  return txt;
}

function AnsiRenderer({
  children,
  linkify = false,
}: {
  children?: string;
  linkify?: boolean;
}) {
  const ansiContent = ansiToJSON(children ?? "", false).map((bundle, i) =>
    convertBundleIntoReact(linkify, false, bundle, i)
  );

  return <>{ansiContent}</>;
}

interface StatusIconProps {
  status: "running" | "completed" | "failed" | "background";
}

function StatusIcon({ status }: StatusIconProps) {
  const getStatusColor = () => {
    switch (status) {
      case "running":
        return "bg-success";
      case "completed":
        return "bg-success";
      case "background":
        return "bg-accent";
      case "failed":
        return "bg-error";
      default:
        return "bg-success";
    }
  };

  return (
    <span
      className={`mr-2 h-2 w-2 rounded-full ${getStatusColor()} ${
        status === "running" ? "animate-pulse" : ""
      }`}
    />
  );
}

interface UnifiedTerminalCommandProps {
  command: string;
  output?: string;
  status?: "running" | "completed" | "failed" | "background";
  statusMessage?: string;
  toolCallState?: ToolCallState;
  toolCallId?: string;
  displayLines?: number;
}

export function UnifiedTerminalCommand({
  command,
  output = "",
  status = "completed",
  statusMessage = "",
  toolCallState,
  toolCallId,
}: UnifiedTerminalCommandProps) {
  const dispatch = useAppDispatch();
  const readTarget = useMemo(() => terminalReadTarget(command), [command]);
  const isFileRead = readTarget !== undefined;
  const [isExpanded, setIsExpanded] = useState(false);
  const title = isFileRead ? t("Read {0}", readTarget) :
    t("Run {0}", command.trim().split(/\r?\n/)[0] || t("Command"));

  // Explicit completion/failure/background signals take precedence over a
  // briefly stale tool-call status while the output stream is settling.
  const statusType = status === "failed" || statusMessage.includes("failed") ? "failed" :
    status === "background" || statusMessage.includes("background") ? "background" :
    toolCallState?.status === "calling" || status === "running" ? "running" : status;
  const isRunning = statusType === "running";
  const hasOutput = output.length > 0;

  const handleMoveToBackground = () => {
    if (toolCallId) {
      void dispatch(
        moveTerminalProcessToBackground({
          toolCallId,
        })
      );
    }
  };

  // Create combined content for copying (command + output)
  const copyContent = useMemo(() => {
    let content = command;
    if (hasOutput) {
      content += `\n\n${output}`;
    }
    return content;
  }, [command, output, hasOutput]);

  return (
    <StyledTerminalContainer
      fontSize={getFontSize()}
      className="mx-2 mb-4"
      data-testid="terminal-container"
    >
      <div className="outline-command-border rounded-default bg-editor !my-2 flex min-w-0 flex-col outline outline-1">
        {/* Toolbar */}
        <div
          className={`find-widget-skip bg-editor sticky -top-2 z-10 m-0 flex items-center justify-between gap-3 px-1.5 py-1 ${
            isExpanded
              ? "rounded-t-default border-command-border border-b"
              : "rounded-default"
          }`}
          style={{ fontSize: `${getFontSize() - 2}px` }}
        >
          <button type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center border-none bg-transparent p-0 text-left"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded(!isExpanded)}
            title={title}>
            <ChevronDownIcon
              className={`text-description h-3.5 w-3.5 flex-shrink-0 ${isExpanded ? "rotate-0" : "-rotate-90"}`}
            />
            <CommandTitle $running={isRunning && statusType === "running"}
              data-testid="terminal-command-title"
              data-running={isRunning && statusType === "running"}>
              {title}
            </CommandTitle>
            <span className="text-description ml-2 flex flex-shrink-0 items-center text-xs" role="status">
              <StatusIcon status={statusType} />
              {isRunning ? t("Running") : statusType === "failed" ? t("Failed") : statusType === "background" ? t("Background") : t("Completed")}
            </span>
          </button>

          <div className="flex items-center gap-2.5">
            {isRunning && toolCallId && !isExpanded && (
              <button type="button" className="text-link cursor-pointer border-none bg-transparent text-xs"
                onClick={handleMoveToBackground}>{t("Move to background")}</button>
            )}
            {!isRunning && (
              <div className="xs:flex hidden items-center gap-2.5">
                <CopyButton text={copyContent} />
                <RunInTerminalButton command={command} />
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        {isExpanded && (
          <TerminalContent>
            <pre className="bg-editor">
              <code>
                {/* Command is always visible */}
                <div className="text-terminal pb-2">{command}</div>

                {/* Running state with cursor */}
                {isRunning && !hasOutput && (
                  <div className="mt-1 flex items-center gap-1">
                    <BlinkingCursor />
                  </div>
                )}

                {/* Output with optional collapsible functionality */}
                {hasOutput && (
                  <div className="mt-1">
                    <div className="pt-2">
                      <AnsiRenderer linkify>{output}</AnsiRenderer>
                    </div>
                  </div>
                )}
              </code>
            </pre>
          </TerminalContent>
        )}

        {/* Status information */}
        {(statusMessage || isRunning) && isExpanded && (
          <div
            className="text-description flex items-center px-2 pb-2 pt-2 text-xs"
            style={{
              borderTop:
                "1px solid var(--vscode-commandCenter-inactiveBorder, #555555)",
            }}
          >
            <StatusIcon status={statusType} />
            {isRunning ? "Running" : statusMessage}
            {isRunning && toolCallId && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  handleMoveToBackground();
                }}
                className="text-link ml-3 cursor-pointer text-xs no-underline hover:underline"
              >
                {t("Move to background")}
              </a>
            )}
          </div>
        )}
      </div>
    </StyledTerminalContainer>
  );
}
