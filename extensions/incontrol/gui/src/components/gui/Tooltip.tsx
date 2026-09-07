import { cloneElement, CSSProperties, ReactElement, useId } from "react";
import ReactDOM from "react-dom";
import { ITooltip, Tooltip } from "react-tooltip";
import { vscBackground, vscForeground } from "..";
import { varWithFallback } from "../../styles/theme";
import { fontSize } from "../../util";

// Needed to override styles in react-tooltip
const TooltipStyles: CSSProperties = {
  fontSize: fontSize(-4),
  backgroundColor: `var(--vscode-editorHoverWidget-background, ${vscBackground})`,
  border: `1px solid ${varWithFallback("border")}`,
  color: `var(--vscode-editorHoverWidget-foreground, ${vscForeground})`,
  borderRadius: "var(--fluent-radius, 4px)",
  boxShadow: "var(--fluent-shadow-8, 0 2px 4px rgba(0, 0, 0, 0.18))",
  padding: "4px 8px",
  lineHeight: 1.35,
  zIndex: 1000,
  maxWidth: "80vw",
  textAlign: "left",
};

export function ToolTip({
  children,
  content,
  ...props
}: Omit<ITooltip, "id" | "children" | "content"> & {
  content: ITooltip["children"];
  children: ReactElement;
}) {
  const tooltipId = useId();

  const combinedStyles = {
    ...TooltipStyles,
    ...props.style,
  };

  const tooltipPortalDiv = document.getElementById("tooltip-portal-div");

  const childrenWithTooltipId = cloneElement(children, {
    "data-tooltip-id": tooltipId,
  });

  return (
    <>
      {childrenWithTooltipId}
      {tooltipPortalDiv &&
        ReactDOM.createPortal(
          <Tooltip
            {...props}
            id={tooltipId}
            noArrow
            style={combinedStyles}
            opacity={1}
            delayShow={200}
          >
            {content}
          </Tooltip>,
          tooltipPortalDiv
        )}
    </>
  );
}
