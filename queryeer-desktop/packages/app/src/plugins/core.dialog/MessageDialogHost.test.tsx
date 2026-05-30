import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("submits the primary action when OK is clicked", async () => {
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

    const okButton = rootElement.querySelector(".dialog-message-button.primary") as HTMLButtonElement;
    expect(okButton).toBeTruthy();

    await act(async () => {
      okButton.click();
      await Promise.resolve();
    });

    await expect(dialogPromise!).resolves.toEqual({ action: "ok" });
    expect(document.activeElement).toBe(previousFocus);
    previousFocus.remove();
  });

  it("dismisses with OK action when Escape is pressed on an OK-only dialog", async () => {
    const previousFocus = document.createElement("button");
    document.body.appendChild(previousFocus);
    previousFocus.focus();

    await act(async () => {
      root.render(<MessageDialogHost />);
    });

    let dialogPromise: Promise<{ action: string }>;
    await act(async () => {
      dialogPromise = requestMessageDialog({
        title: "Info",
        message: "Something happened",
        options: [{ label: "OK", value: "ok" }]
      });
      await Promise.resolve();
    });

    const overlay = rootElement.querySelector(".dialog-message-overlay") as HTMLDivElement;
    expect(overlay).toBeTruthy();

    await act(async () => {
      overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });

    await expect(dialogPromise!).resolves.toEqual({ action: "ok" });
    expect(document.activeElement).toBe(previousFocus);
    previousFocus.remove();
  });

  it("dismisses with Cancel action when Escape is pressed on a dialog with Cancel", async () => {
    const previousFocus = document.createElement("button");
    document.body.appendChild(previousFocus);
    previousFocus.focus();

    await act(async () => {
      root.render(<MessageDialogHost />);
    });

    let dialogPromise: Promise<{ action: string }>;
    await act(async () => {
      dialogPromise = requestMessageDialog({
        title: "Confirm",
        message: "Are you sure?",
        options: [{ label: "OK", value: "ok" }, { label: "Cancel", value: "cancel" }]
      });
      await Promise.resolve();
    });

    const overlay = rootElement.querySelector(".dialog-message-overlay") as HTMLDivElement;
    expect(overlay).toBeTruthy();

    await act(async () => {
      overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });

    await expect(dialogPromise!).resolves.toEqual({ action: "cancel" });
    expect(document.activeElement).toBe(previousFocus);
    previousFocus.remove();
  });
});
