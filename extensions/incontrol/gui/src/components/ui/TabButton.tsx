import { cn } from "../../util/cn";
import { ToolTip } from "../gui/Tooltip";

interface TabButtonProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  tabId?: string;
}

/**
 * Vertical nav row, Fluent geometry: 4px radius, 30px minimum height, a 2px
 * brand bar on the active row and a visible keyboard focus ring.
 */
export function TabButton({
  label,
  icon,
  isActive,
  onClick,
  tabId,
}: TabButtonProps) {
  return (
    <ToolTip content={label} place="right" className="text-xs md:!hidden">
      <div
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        className={cn(
          "flex min-h-[30px] cursor-pointer items-center justify-center gap-1.5 rounded-[var(--fluent-radius)] px-2 py-1.5 text-left transition-colors duration-100",
          "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fluent-stroke-focus)]",
          isActive
            ? "bg-vsc-input-background text-foreground shadow-[inset_2px_0_0_var(--fluent-accent)]"
            : "text-description hover:bg-list-hover hover:text-foreground"
        )}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        data-testid={tabId ? `tab-${tabId}` : undefined}
      >
        {icon}
        <span className="hidden md:inline">{label}</span>
      </div>
    </ToolTip>
  );
}
