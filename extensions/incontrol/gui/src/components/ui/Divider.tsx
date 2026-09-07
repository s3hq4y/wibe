import { Divider as FluentDivider } from "@fluentui/react-components";
import { cn } from "../../util/cn";

interface DividerProps {
  className?: string;
}

export function Divider({ className }: DividerProps) {
  return (
    <FluentDivider
      className={cn("my-2 opacity-60", className)}
      style={{ borderColor: "var(--fluent-stroke-muted)" }}
    />
  );
}
