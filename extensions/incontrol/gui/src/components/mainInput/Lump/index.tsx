import { LumpToolbar } from "./LumpToolbar/LumpToolbar";

/**
 * Settings row for the main input (rules / tools / models + the config picker).
 * It used to sit on top of the field like a tab; it now sits directly below it
 * and deliberately shares its width: no side insets, no rounding, and the same
 * 1px stroke, so field and toolbar read as one control.
 */
export function Lump() {
  return (
    <div
      data-testid="lump-toolbar"
      className="bg-input border-command-border w-full border-x border-b"
    >
      <div className="xs:px-2 px-1 py-0.5">
        <LumpToolbar />
      </div>
    </div>
  );
}
