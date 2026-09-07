import { CheckCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { clearGoal } from "../../redux/slices/sessionSlice";

/** 完成动效：先变灰，再向下收进输入框 */
const GRAY_MS = 320;
const COLLAPSE_MS = 320;

/**
 * Plays a short two-tone chime when the goal is marked complete.
 * Synthesised with the Web Audio API so no binary asset is needed.
 * Silently no-ops if the browser blocks audio (e.g. no prior user gesture) -
 * the goal bar animation must never depend on the sound succeeding.
 */
function playCompletionChime() {
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) {
      return;
    }
    const ctx = new Ctor();
    if (ctx.state === "suspended") {
      return;
    }
    const now = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const at = now + i * 0.13;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.15, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.26);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // 提示音失败不应影响目标栏本身
  }
}

export default function GoalBar() {
  const dispatch = useAppDispatch();
  const goal = useAppSelector((state) => state.session.goal);
  const [collapsing, setCollapsing] = useState(false);
  const wasCompleted = useRef(false);

  useEffect(() => {
    if (!goal) {
      wasCompleted.current = false;
      setCollapsing(false);
      return;
    }
    if (goal.completed && !wasCompleted.current) {
      wasCompleted.current = true;
      playCompletionChime();
      const startCollapse = setTimeout(() => setCollapsing(true), GRAY_MS);
      const remove = setTimeout(
        () => dispatch(clearGoal()),
        GRAY_MS + COLLAPSE_MS,
      );
      return () => {
        clearTimeout(startCollapse);
        clearTimeout(remove);
      };
    }
  }, [goal, dispatch]);

  if (!goal) {
    return null;
  }

  const done = goal.completed;

  return (
    <div
      className="overflow-hidden transition-all duration-300 ease-in"
      style={{
        maxHeight: collapsing ? 0 : 44,
        opacity: collapsing ? 0 : 1,
        transform: collapsing ? "translateY(10px)" : "translateY(0)",
      }}
      data-testid="goal-bar"
    >
      <div className="mx-1 mb-1 flex items-center gap-2 rounded px-2 py-1 text-xs">
        {done ? (
          <CheckCircleIcon className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
        ) : null}

        <span className="text-description-muted flex-shrink-0 font-medium">
          Goal
        </span>

        <span
          className={`min-w-0 flex-1 truncate ${
            done ? "text-description-muted line-through opacity-60" : ""
          }`}
          title={goal.text}
        >
          {goal.text}
        </span>

        {!done && (
          <button
            type="button"
            onClick={() => dispatch(clearGoal())}
            className="flex-shrink-0 rounded border-0 bg-transparent p-0.5 text-description-muted hover:bg-white/10 hover:text-foreground"
            data-testid="goal-cancel"
            title="Cancel goal"
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
