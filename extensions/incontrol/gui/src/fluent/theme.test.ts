import { buildFluentTheme } from "./theme";

/**
 * Corner treatment is meant to be a single knob: the CSS layer publishes
 * `--fluent-radius: 0px` for hand-written styles, and real Fluent components
 * read these JS tokens. Nothing may stay rounded behind the user's back, so
 * every radius token the theme supports is pinned to 0.
 */
test("the Fluent theme publishes sharp corners", () => {
  const theme = buildFluentTheme() as unknown as Record<string, string>;
  const radiusTokens = [
    "borderRadiusNone",
    "borderRadiusSmall",
    "borderRadiusMedium",
    "borderRadiusLarge",
    "borderRadiusXLarge",
    "borderRadius2XLarge",
    "borderRadius3XLarge",
    "borderRadius4XLarge",
    "borderRadius5XLarge",
    "borderRadius6XLarge",
  ];
  // 一次性比对整个半径集合：哪个令牌漏了，diff 里会直接点名
  expect(Object.fromEntries(radiusTokens.map((t) => [t, theme[t]]))).toEqual(
    Object.fromEntries(radiusTokens.map((t) => [t, "0px"]))
  );
});
