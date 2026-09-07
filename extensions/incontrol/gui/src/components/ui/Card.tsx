import { Card as FluentCard } from "@fluentui/react-components";
import { cn } from "../../util/cn";

interface CardProps extends React.ComponentProps<"div"> {
  children: React.ReactNode;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <FluentCard
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
      className={cn(
        "w-full items-stretch gap-0 rounded-[var(--fluent-radius)] border border-solid border-[var(--fluent-stroke-muted)] bg-editor px-4 py-3 shadow-[var(--fluent-shadow-2)]",
        className
      )}
    >
      {children}
    </FluentCard>
  );
}
