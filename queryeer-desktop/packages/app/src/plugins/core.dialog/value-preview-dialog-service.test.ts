import { describe, expect, it } from "vitest";
import {
  closeValuePreviewDialog,
  closeFocusedValuePreviewDialog,
  focusValuePreviewDialog,
  listValuePreviewDialogs,
  minimizeValuePreviewDialog,
  moveValuePreviewDialog,
  requestValuePreviewDialog,
  restoreValuePreviewDialog,
  resizeValuePreviewDialog,
} from "./value-preview-dialog-service";

describe("value preview dialog service", () => {
  it("opens multiple preview windows and supports focus/move/resize/close", async () => {
    await requestValuePreviewDialog({
      title: "Value Preview 1",
      value: "{\"a\":1}",
      mimeType: "application/json",
    });
    await requestValuePreviewDialog({
      title: "Value Preview 2",
      value: "<root />",
      mimeType: "application/xml",
    });

    const opened = listValuePreviewDialogs();
    expect(opened.length).toBeGreaterThanOrEqual(2);
    const first = opened[opened.length - 2];
    const second = opened[opened.length - 1];

    moveValuePreviewDialog(first.id, 120, 160);
    resizeValuePreviewDialog(first.id, 500, 300);
    focusValuePreviewDialog(first.id);

    const moved = listValuePreviewDialogs().find((item) => item.id === first.id);
    expect(moved?.x).toBe(120);
    expect(moved?.y).toBe(160);
    expect(moved?.width).toBe(500);
    expect(moved?.height).toBe(300);

    const focused = listValuePreviewDialogs().find((item) => item.id === first.id);
    const other = listValuePreviewDialogs().find((item) => item.id === second.id);
    expect((focused?.zIndex ?? 0) > (other?.zIndex ?? 0)).toBe(true);

    minimizeValuePreviewDialog(first.id);
    expect(listValuePreviewDialogs().find((item) => item.id === first.id)?.minimized).toBe(true);
    restoreValuePreviewDialog(first.id);
    expect(listValuePreviewDialogs().find((item) => item.id === first.id)?.minimized).toBe(false);

    expect(closeFocusedValuePreviewDialog()).toBe(true);
    expect(listValuePreviewDialogs().some((item) => item.id === first.id)).toBe(false);

    closeValuePreviewDialog(second.id);
    expect(listValuePreviewDialogs().some((item) => item.id === first.id || item.id === second.id)).toBe(false);
  });
});
