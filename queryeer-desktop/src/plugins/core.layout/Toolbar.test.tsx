import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutToolbarContribution, LayoutZone } from "../../contracts/extensions/LayoutExtension";
import { Toolbar } from "./Toolbar";

describe("Toolbar", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as unknown as { React: typeof React }).React = React;
    rootElement = document.createElement("div");
    document.body.append(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("renders separators and disables non-executable actions", () => {
    const actions: LayoutToolbarContribution[] = [
      { id: "one", commandId: "cmd.one", icon: "file-open", title: "One", order: 10 },
      { id: "sep", type: "separator", order: 11 },
      { id: "two", commandId: "cmd.two", icon: "file-open", title: "Two", order: 12 }
    ];

    act(() => {
      root.render(
        <Toolbar
          toolbarActions={actions}
          visibleZones={new Set(["mainArea"])}
          onToggleZone={vi.fn()}
          canExecuteCommand={(commandId) => commandId !== "cmd.two"}
          executeCommand={vi.fn(async () => ({ commandId: "", executed: true }))}
          getCommandTitle={() => undefined}
          getCommandAccelerator={() => undefined}
        />
      );
    });

    const separator = rootElement.querySelector(".shell-toolbar-separator");
    expect(separator).toBeTruthy();

    const buttons = rootElement.querySelectorAll("button.shell-toolbar-action");
    expect(buttons).toHaveLength(2);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("rechecks command enablement when command context changes", () => {
    const actions: LayoutToolbarContribution[] = [
      { id: "estimated-plan", commandId: "cmd.estimatedPlan", icon: "file-open", title: "Estimated Plan" }
    ];
    const visibleZones: ReadonlySet<LayoutZone> = new Set(["mainArea"]);
    const onToggleZone = vi.fn();
    const executeCommand = vi.fn(async () => ({ commandId: "cmd.estimatedPlan", executed: true as const }));
    const getCommandTitle = () => undefined;
    const getCommandAccelerator = () => undefined;
    let canExecute = false;
    const canExecuteCommand = () => canExecute;

    const renderToolbar = (commandContextVersion: number) => {
      root.render(
        <Toolbar
          toolbarActions={actions}
          visibleZones={visibleZones}
          onToggleZone={onToggleZone}
          canExecuteCommand={canExecuteCommand}
          executeCommand={executeCommand}
          getCommandTitle={getCommandTitle}
          getCommandAccelerator={getCommandAccelerator}
          commandContextVersion={commandContextVersion}
        />
      );
    };

    act(() => {
      renderToolbar(0);
    });
    expect((rootElement.querySelector("button.shell-toolbar-action") as HTMLButtonElement).disabled).toBe(true);

    canExecute = true;
    act(() => {
      renderToolbar(1);
    });

    expect((rootElement.querySelector("button.shell-toolbar-action") as HTMLButtonElement).disabled).toBe(false);
  });

  it("executes non-toggle commands on click", async () => {
    const executeCommand = vi.fn(async (commandId: string) => ({ commandId, executed: true as const }));

    act(() => {
      root.render(
        <Toolbar
          toolbarActions={[{ id: "open", commandId: "core.files.open", icon: "file-open", title: "Open File" }]}
          visibleZones={new Set(["mainArea"])}
          onToggleZone={vi.fn()}
          canExecuteCommand={() => true}
          executeCommand={executeCommand}
          getCommandTitle={(commandId) => (commandId === "core.files.open" ? "Open File" : undefined)}
          getCommandAccelerator={(commandId) => (commandId === "core.files.open" ? "CmdOrCtrl+O" : undefined)}
        />
      );
    });

    const button = rootElement.querySelector("button.shell-toolbar-action") as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.title).toBe("Open File (CmdOrCtrl+O)");

    await act(async () => {
      button.click();
    });

    expect(executeCommand).toHaveBeenCalledWith("core.files.open");
  });

  it("prevents mousedown default to preserve editor focus", () => {
    act(() => {
      root.render(
        <Toolbar
          toolbarActions={[{ id: "open", commandId: "core.files.open", icon: "file-open", title: "Open File" }]}
          visibleZones={new Set(["mainArea"])}
          onToggleZone={vi.fn()}
          canExecuteCommand={() => true}
          executeCommand={vi.fn(async () => ({ commandId: "core.files.open", executed: true }))}
          getCommandTitle={() => "Open File"}
          getCommandAccelerator={() => "Ctrl+O"}
        />
      );
    });

    const button = rootElement.querySelector("button.shell-toolbar-action") as HTMLButtonElement;
    expect(button).toBeTruthy();

    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const dispatched = button.dispatchEvent(event);

    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("renders select contribution and calls onChange", () => {
    const onChange = vi.fn();

    act(() => {
      root.render(
        <Toolbar
          toolbarActions={[
            {
              id: "output-select",
              type: "select",
              title: "Output",
              getOptions: () => [
                { value: "table", label: "Table" },
                { value: "text", label: "Text" }
              ],
              getValue: () => "table",
              onChange
            }
          ]}
          visibleZones={new Set(["mainArea"])}
          onToggleZone={vi.fn()}
          canExecuteCommand={() => true}
          executeCommand={vi.fn(async () => ({ commandId: "noop", executed: true }))}
          getCommandTitle={() => undefined}
          getCommandAccelerator={() => undefined}
        />
      );
    });

    const select = rootElement.querySelector("select.shell-toolbar-select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("table");

    act(() => {
      select.value = "text";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("text");
  });

  it("hides select when isVisible returns false", () => {
    act(() => {
      root.render(
        <Toolbar
          toolbarActions={[
            {
              id: "hidden-select",
              type: "select",
              title: "Hidden",
              getOptions: () => [{ value: "a", label: "A" }],
              getValue: () => "a",
              onChange: vi.fn(),
              isVisible: () => false
            }
          ]}
          visibleZones={new Set(["mainArea"])}
          onToggleZone={vi.fn()}
          canExecuteCommand={() => true}
          executeCommand={vi.fn(async () => ({ commandId: "noop", executed: true }))}
          getCommandTitle={() => undefined}
          getCommandAccelerator={() => undefined}
        />
      );
    });

    expect(rootElement.querySelector("select.shell-toolbar-select")).toBeNull();
  });

  it("renders menu contribution and executes selected item", async () => {
    const onSelect = vi.fn();

    act(() => {
      root.render(
        <Toolbar
          toolbarActions={[
            {
              id: "new-menu",
              type: "menu",
              title: "New",
              getItems: () => [
                { value: "application/sql", label: "SQL" },
                { value: "application/json", label: "JSON" }
              ],
              onSelect
            }
          ]}
          visibleZones={new Set(["mainArea"])}
          onToggleZone={vi.fn()}
          canExecuteCommand={() => true}
          executeCommand={vi.fn(async () => ({ commandId: "noop", executed: true }))}
          getCommandTitle={() => undefined}
          getCommandAccelerator={() => undefined}
        />
      );
    });

    const trigger = rootElement.querySelector("button.shell-toolbar-action") as HTMLButtonElement;
    expect(trigger).toBeTruthy();

    act(() => {
      trigger.click();
    });

    const menuItemButtons = rootElement.querySelectorAll("button.shell-toolbar-menu-item");
    expect(menuItemButtons).toHaveLength(2);

    await act(async () => {
      (menuItemButtons[1] as HTMLButtonElement).click();
    });

    expect(onSelect).toHaveBeenCalledWith("application/json");
    expect(rootElement.querySelector(".shell-toolbar-menu")).toBeNull();
  });
});

void React;
