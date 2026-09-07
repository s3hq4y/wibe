import { ChevronRightIcon } from "@heroicons/react/24/outline";

interface ToggleProps {
  isOpen: boolean;
  onToggle: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Toggle({
  isOpen,
  onToggle,
  title,
  subtitle,
  children,
}: ToggleProps) {
  return (
    <div>
      <div
        role="button"
        aria-expanded={isOpen}
        tabIndex={0}
        className="group flex min-h-[28px] cursor-pointer items-start gap-2 rounded-[var(--fluent-radius)] px-1 py-0.5 text-left text-sm font-semibold transition-colors duration-100 hover:bg-list-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fluent-stroke-focus)]"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <ChevronRightIcon
          className={`mt-0.5 h-4 w-4 shrink-0 transition-transform duration-150 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <div>
          <span>{title}</span>
          {subtitle && (
            <p className="text-description my-1 text-xs font-normal">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div
        className={`duration-400 overflow-hidden transition-all ease-in-out ${
          isOpen ? "mt-3 max-h-screen" : "max-h-0"
        }`}
      >
        <div className="pl-6">{children}</div>
      </div>
    </div>
  );
}
