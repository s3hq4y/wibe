import { renderWithProviders } from "../../../util/test/render";
import { getElementByTestId } from "../../../util/test/utils";
import { Chat } from "../Chat";

test("the main input's settings row sits below the field, in the same column", async () => {
  await renderWithProviders(<Chat />);

  const box = await getElementByTestId("incontrol-input-box-main-editor-input");
  const field = box.querySelector('[data-testid="incontrol-input-field"]');
  const toolbar = await getElementByTestId("lump-toolbar");

  expect(field).not.toBeNull();

  // DOM order is visual order here: the container is a flex column, so the
  // settings row following the field means it renders underneath it.
  expect(
    field!.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();

  // Same parent, both direct children of that column => identical width.
  expect(toolbar.parentElement).toBe(field!.parentElement);
});

test("the toolbar row wraps instead of forcing the panel wider", async () => {
  await renderWithProviders(<Chat />);

  // 窄侧栏里溢出的根因是这一行不能收缩：它一旦比窗口宽，整页网格轨道就会被
  // min-content 顶宽。换行 + min-w-0 是让它留在窗口内的手段，这里钉住。
  const send = await getElementByTestId("submit-input-button");
  const row = send.closest(".flex-wrap");
  expect(row).not.toBeNull();
  expect(row!.className).toContain("min-w-0");
});
