import styled, { keyframes } from "styled-components";

/**
 * The border of the main input. It is drawn by the wrapper's own background
 * showing through 1px of padding, which is what lets the streaming state run a
 * gradient across it. Otherwise this is Fluent's field treatment: a 1px neutral
 * stroke at rest, and a 2px accent edge on the focused side.
 */
const gradient = keyframes`
  0% {
    background-position: 0px 0;
  }
  100% {
    background-position: 100em 0;
  }
`;

export const GradientBorder = styled.div<{
  borderRadius?: string;
  borderColor?: string;
  loading: 0 | 1;
}>`
  border-radius: ${(props) => props.borderRadius || "0"};
  padding: 1px;
  box-sizing: border-box;
  background: ${(props) =>
    props.borderColor
      ? props.borderColor
      : props.loading
      ? `repeating-linear-gradient(
      101.79deg,
      var(--fluent-accent, #2c5aa0) 0%,
      #331bbe 16%,
      #1bbe84 33%,
      var(--fluent-accent, #2c5aa0) 55%,
      #331bbe 85%,
      #1bbe84 99%
    )`
      : `var(--fluent-stroke, var(--vscode-input-border, #555555))`};
  animation: ${(props) => (props.loading ? gradient : "")} 6s linear infinite;
  background-size: ${(props) => (props.loading ? "200% 200%" : "auto")};
  width: 100%;
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: ${(props) => (props.loading ? "8px" : "")};

  &:focus-within {
    background: ${(props) =>
      props.borderColor || props.loading
        ? undefined
        : "var(--fluent-stroke-focus, var(--vscode-focusBorder))"};
    padding-bottom: 2px;
  }
`;
