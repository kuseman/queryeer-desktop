import { describe, expect, it, vi } from "vitest";
import {
  requestCloseActiveEditor,
  requestOpenEditorToSide,
  requestSplitActiveEditorRight,
  subscribeCloseActiveEditorRequests,
  subscribeOpenEditorToSideRequests,
  subscribeSplitActiveEditorRightRequests
} from "./layout-editor-events";

describe("layout editor events", () => {
  it("publishes split-active-editor-right requests", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSplitActiveEditorRightRequests(listener);

    requestSplitActiveEditorRight();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("publishes open-editor-to-side requests", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenEditorToSideRequests(listener);

    requestOpenEditorToSide({ fileId: "graph", removeFromOtherGroups: true });

    expect(listener).toHaveBeenCalledWith({ fileId: "graph", removeFromOtherGroups: true });
    unsubscribe();
  });

  it("publishes close-active-editor requests", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCloseActiveEditorRequests(listener);

    requestCloseActiveEditor();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
