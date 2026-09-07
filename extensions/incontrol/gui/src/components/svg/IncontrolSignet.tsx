interface IncontrolSignetProps {
  /** Height of the signet in pixels */
  height?: number;
  /** Width of the signet in pixels */
  width?: number;
  /** Additional CSS classes to apply to the SVG */
  className?: string;
}

/**
 * The incontrol mark: two prompt chevrons and a caret bar, drawn with
 * `currentColor` so it follows the surrounding theme like text does.
 *
 * The component keeps the upstream `IncontrolSignet` name (it is referenced from
 * several places in the GUI and from vitest mocks); only the artwork changed.
 */
export const INCONTROL_MARK_PATHS = (
  <g
    fill="none"
    stroke="currentColor"
    strokeWidth={12}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M28 34 L48 60 L28 86" />
    <path d="M56 34 L76 60 L56 86" />
    <path d="M90 32 L90 88" strokeWidth={13} />
  </g>
);

export default function IncontrolSignet({
  height = 100,
  width = 100,
  className = "",
}: IncontrolSignetProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {INCONTROL_MARK_PATHS}
    </svg>
  );
}
