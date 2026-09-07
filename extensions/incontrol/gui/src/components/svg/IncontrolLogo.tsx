import { vscForeground } from "..";
import { INCONTROL_MARK_PATHS } from "./IncontrolSignet";

interface IncontrolLogoProps {
  height?: number;
  width?: number;
}

/**
 * Mark + wordmark, sized against the same 900x257 box the upstream logo used so
 * callers that pass only `height` keep laying out identically.
 */
export default function IncontrolLogo({
  height = 257,
  width = 900,
}: IncontrolLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 900 257"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      style={{ color: vscForeground }}
    >
      <g transform="translate(150 20) scale(1.8)">{INCONTROL_MARK_PATHS}</g>
      <text
        x="452"
        y="176"
        fill="currentColor"
        fontFamily="ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif"
        fontSize="118"
        fontWeight={600}
        letterSpacing="-3"
      >
        incontrol
      </text>
    </svg>
  );
}
