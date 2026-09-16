import styled, { keyframes } from "styled-components";

const whiteSweep = keyframes`
  from { background-position: 200% center; }
  to { background-position: -200% center; }
`;

/** Quiet white highlight for active actions; terminal states remain static. */
export const ExecutionTitle = styled.span<{ $running: boolean }>`
  min-width: 0;
  color: var(--vscode-foreground, var(--foreground));
  ${({ $running }) => $running && `
    @supports ((background-clip: text) or (-webkit-background-clip: text)) {
      background-image: linear-gradient(105deg,
        var(--vscode-descriptionForeground, var(--foreground)) 35%,
        rgba(255, 255, 255, 0.8) 47%,
        #fff 50%,
        rgba(255, 255, 255, 0.8) 53%,
        var(--vscode-descriptionForeground, var(--foreground)) 65%);
      background-size: 250% 100%;
      background-clip: text;
      -webkit-background-clip: text;
      color: transparent;
    }
  `}
  animation: ${({ $running }) => $running ? whiteSweep : "none"} 2.4s linear infinite;
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
