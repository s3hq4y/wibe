import { renderToString } from "react-dom/server";
import { ServerStyleSheet } from "styled-components";
import { ExecutionTitle } from "./ExecutionTitle";

const styles = (running: boolean) => {
  const sheet = new ServerStyleSheet();
  try {
    renderToString(sheet.collectStyles(<ExecutionTitle $running={running}>Read file</ExecutionTitle>));
    return sheet.getStyleTags();
  } finally {
    sheet.seal();
  }
};
test("running titles use a white highlight, not the old blue gradient", () => {
  const css = styles(true);
  expect(css).toContain("linear-gradient");
  expect(css).toContain("#fff");
  expect(css).not.toContain("#2563eb");
});
test("inactive titles are static", () => {
  expect(styles(false)).not.toContain("linear-gradient");
  expect(styles(false)).toContain("animation:none");
});
test("reduced motion and forced colors keep readable static titles", () => {
  const css = styles(true);
  expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  expect(css).toMatch(/forced-colors:\s*active/);
  expect(css).toContain("background-image:none");
  expect(css).toContain("CanvasText");
});
