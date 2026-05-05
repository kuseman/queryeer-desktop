import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreMenuBar } from "./MenuBar";

describe("CoreMenuBar", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as unknown as { React: typeof React }).React = React;
    rootElement = document.createElement("div");
    document.body.append(rootElement);
    root = createRoot(rootElement);

    (window as unknown as {
      appShell: {
        platform: string;
        isWindowMaximized: () => Promise<boolean>;
        onWindowStateChanged: (listener: (state: { maximized: boolean }) => void) => () => void;
        windowMinimize: () => void;
        windowMaximize: () => void;
        windowClose: () => void;
      };
    }).appShell = {
      platform: "win32",
      isWindowMaximized: async () => false,
      onWindowStateChanged: () => () => {},
      windowMinimize: () => {},
      windowMaximize: () => {},
      windowClose: () => {}
    };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("clicking submenu parent with commandId executes parent command", async () => {
    const executeCommand = vi.fn(async () => ({}));
    await act(async () => {
      root.render(
        <CoreMenuBar
          keybindings={[]}
          canExecuteCommand={() => true}
          executeCommand={executeCommand}
          menuItems={[
            { id: "root.file", label: "File", order: 1 },
            {
              id: "core.files.menu.new",
              parentId: "root.file",
              label: "New",
              type: "submenu",
              commandId: "core.files.new",
              order: 1
            },
            {
              id: "core.files.menu.new.sql",
              parentId: "core.files.menu.new",
              label: "SQL",
              commandId: "core.files.new.fromMime.application/sql",
              order: 1
            }
          ]}
        />
      );
    });

    const fileButton = Array.from(rootElement.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "File"
    ) as HTMLButtonElement;
    expect(fileButton).toBeTruthy();

    await act(async () => {
      fileButton.click();
    });

    const newButton = Array.from(rootElement.querySelectorAll(".shell-titlebar-dropdown-item")).find(
      (button) => button.textContent?.includes("New")
    ) as HTMLButtonElement;
    expect(newButton).toBeTruthy();

    await act(async () => {
      newButton.click();
    });

    expect(executeCommand).toHaveBeenCalledWith("core.files.new");
  });
});

void React;
