import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageDialogHost } from "./MessageDialogHost";
import {
  getActiveMessageDialogRequest,
  requestMessageDialog,
  resolveActiveMessageDialog
} from "./message-dialog-service";

void React;

describe("MessageDialogHost", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    while (getActiveMessageDialogRequest()) {
      resolveActiveMessageDialog({ action: "" });
    }
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("submits the primary action when Enter is pressed", async () => {
    const previousFocus = document.createElement("button");
    document.body.appendChild(previousFocus);
    previousFocus.focus();

    await act(async () => {
      root.render(<MessageDialogHost />);
    });

    let dialogPromise: Promise<{ action: string }>;
    await act(async () => {
      dialogPromise = requestMessageDialog({
        title: "Security",
        message: "Invalid master password",
        options: [{ label: "OK", value: "ok" }]
      });
      await Promise.resolve();
    });

    const overlay = rootElement.querySelector(".dialog-message-overlay");
    expect(overlay).toBeTruthy();

    const globalKeydownSpy = vi.fn();
    document.addEventListener("keydown", globalKeydownSpy);

    await act(async () => {
      overlay?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    await expect(dialogPromise!).resolves.toEqual({ action: "ok" });
    expect(document.activeElement).toBe(previousFocus);
    expect(globalKeydownSpy).not.toHaveBeenCalled();
    document.removeEventListener("keydown", globalKeydownSpy);
    previousFocus.remove();
  });
});
