import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { ChatHistoryItem } from "core";
import { useEffect, useId, useRef, useState } from "react";
import styled from "styled-components";
import { ExecutionTitle } from "../../ExecutionTitle";
import StyledMarkdownPreview from "../../StyledMarkdownPreview";
import { t } from "../../../i18n";

const ThinkingToggle = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 4px 8px;
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.25)));
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-foreground, var(--foreground));
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease;
  &:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.1)); }
  &:focus:not(:focus-visible) { outline: none; }
  &:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { transition: none; }
`;

// Animate the actual content height, not an arbitrary 50vh max-height. This
// avoids the delayed collapse and sudden opening of short thinking blocks.
const ThinkingPanel = styled.div<{ $open: boolean }>`
  display: grid;
  grid-template-rows: ${({ $open }) => $open ? "1fr" : "0fr"};
  opacity: ${({ $open }) => $open ? 1 : 0};
  visibility: ${({ $open }) => $open ? "visible" : "hidden"};
  transition: grid-template-rows 200ms cubic-bezier(0.2, 0, 0, 1),
    opacity 160ms ease, visibility 0s ${({ $open }) => $open ? "0s" : "200ms"};
  @media (prefers-reduced-motion: reduce) { transition: none; }
`;

const MarkdownWrapper = styled.div`
  & > div > *:first-child { margin-top: 0 !important; }
`;

interface ThinkingBlockPeekProps {
  content: string;
  redactedThinking?: string;
  index: number;
  prevItem: ChatHistoryItem | null;
  inProgress?: boolean;
  signature?: string;
  tokens?: number;
}

function ThinkingBlockPeek({ content, redactedThinking, index, prevItem, inProgress, tokens }: ThinkingBlockPeekProps) {
  const [open, setOpen] = useState(false);
  const startedAt = useRef<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState("");
  const panelId = useId();
  const duplicateRedactedThinkingBlock = prevItem?.message.role === "thinking" &&
    redactedThinking && prevItem.message.redactedThinking;

  useEffect(() => {
    if (inProgress) {
      startedAt.current = Date.now();
      setElapsedTime("");
    } else if (startedAt.current !== null) {
      setElapsedTime(`${((Date.now() - startedAt.current) / 1000).toFixed(1)}s`);
      startedAt.current = null;
    }
  }, [inProgress]);

  const title = redactedThinking ? "Redacted Thinking" : inProgress ? "Thinking…" :
    "Thought" + (elapsedTime ? ` for ${elapsedTime}` : "") + (tokens ? ` (${tokens} tokens)` : "");

  return duplicateRedactedThinkingBlock ? null : (
    <div className="thread-message">
      <div className="mt-1 flex flex-col px-4">
        <div>
          <ThinkingToggle type="button" data-testid="thinking-block-peek"
            aria-expanded={open} aria-controls={panelId}
            onClick={() => setOpen(value => !value)}>
            <ExecutionTitle $running={Boolean(inProgress)} data-running={Boolean(inProgress)}>{title}</ExecutionTitle>
            <ChevronDownIcon aria-hidden="true"
              className={`h-3 w-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
          </ThinkingToggle>
        </div>
        <ThinkingPanel id={panelId} $open={open} aria-hidden={!open}
          ref={node => { node?.toggleAttribute("inert", !open); }}>
          <div className="min-h-0 overflow-hidden">
            <div className="max-h-[50vh] overflow-y-auto pt-2">
              {redactedThinking ? (
                <div className="text-description pl-5 text-xs italic">{t("Thinking content redacted due to safety reasons.")}</div>
              ) : (
                <MarkdownWrapper>
                  <StyledMarkdownPreview isRenderingInStepContainer source={content} itemIndex={index} />
                </MarkdownWrapper>
              )}
            </div>
          </div>
        </ThinkingPanel>
      </div>
    </div>
  );
}
export default ThinkingBlockPeek;
