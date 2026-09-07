import styled from "styled-components";

/**
 * Toolbar affordance. Fluent treats these as "subtle" buttons: transparent
 * until hover, a soft fill on hover/press, 2px radius and a ring on keyboard
 * focus instead of the old color-only change.
 */
const HoverItem = styled.span<{ isActive?: boolean; px?: number }>`
  padding: 2px ${(props) => props.px ?? 6}px;
  cursor: pointer;
  border-radius: var(--fluent-radius-sm, 2px);
  color: ${(props) =>
    props.isActive
      ? "var(--fluent-fg)"
      : "var(--vscode-descriptionForeground, #b3b3b3)"};
  background-color: ${(props) =>
    props.isActive ? "var(--fluent-bg-hover)" : "transparent"};
  outline: none;

  &:hover {
    background-color: var(--fluent-bg-hover);
    color: var(--fluent-fg);
  }

  &:active {
    background-color: var(--vscode-list-activeSelectionBackground, #2c5aa050);
  }

  &:focus-visible {
    outline: 2px solid var(--fluent-stroke-focus);
    outline-offset: -2px;
  }

  transition: background-color var(--fluent-duration, 120ms)
      var(--fluent-ease, ease),
    color var(--fluent-duration, 120ms) var(--fluent-ease, ease);
`;

export default HoverItem;
