import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { ToolCallState } from "core";
import { ExecutionTitle } from "../../../components/ExecutionTitle";
import { getGroupActionVerb } from "./utils";

interface GroupedToolCallHeaderProps {
  toolCallStates: ToolCallState[];
  activeCalls: ToolCallState[];
  open: boolean;
  onToggle: () => void;
  controls: string;
}

export function GroupedToolCallHeader({
  toolCallStates,
  activeCalls,
  open,
  onToggle,
  controls,
}: GroupedToolCallHeaderProps) {
  const running = toolCallStates.some((call) => call.status === "generating" || call.status === "calling");
  return (
    <button
      type="button"
      className={`text-description flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left hover:brightness-125 ${open ? "mb-1" : ""}`}
      data-testid="performing-actions"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <ChevronRightIcon aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
      <ExecutionTitle $running={running} data-running={running}>
        {getGroupActionVerb(toolCallStates)} {activeCalls.length}{" "}
        {activeCalls.length === 1 ? "action" : "actions"}
      </ExecutionTitle>
    </button>
  );
}
