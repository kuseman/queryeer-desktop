import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputDialogHost } from "./InputDialogHost";
import {
  getActiveInputDialogRequest,
  requestInputDialog,
  resolveActiveInputDialog
} from "./input-dialog-service";

void React;

describe("InputDialogHost", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    while (getActiveInputDialogRequest()) {
      resolveActiveInputDialog({ canceled: true, value: undefined });
    }
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("restores previous focus when cancelled with Escape", async () => {
    const previousFocus = document.createElement("button");
    document.body.appendChild(previousFocus);
    const previousFocusSpy = vi.spyOn(previousFocus, "focus");

    await act(async () => {
      root.render(<InputDialogHost />);
    });

    previousFocus.focus();

    let dialogPromise: Promise<{ canceled: boolean; value?: string }>;
    await act(async () => {
      dialogPromise = requestInputDialog({
        title: "Unlock Vault",
        message: "Enter password",
        password: true
      });
      await Promise.resolve();
    });

    const input = rootElement.querySelector(".dialog-input-field") as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const globalKeydownSpy = vi.fn();
    document.addEventListener("keydown", globalKeydownSpy);

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });

    await expect(dialogPromise!).resolves.toEqual({ canceled: true, value: undefined });
    await act(async () => {
      await Promise.resolve();
    });
    expect(previousFocusSpy).toHaveBeenCalledTimes(2);
    expect(globalKeydownSpy).not.toHaveBeenCalled();
    document.removeEventListener("keydown", globalKeydownSpy);
    previousFocus.remove();
  });
});
