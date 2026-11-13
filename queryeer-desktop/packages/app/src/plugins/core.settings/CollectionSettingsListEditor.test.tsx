import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "./CollectionSettingsListEditor";

void React;

describe("CollectionSettingsListEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders selection and delegates collection actions", async () => {
    const onSelect = vi.fn();
    const onAdd = vi.fn();
    const onClone = vi.fn();
    const onDelete = vi.fn();

    await act(async () => {
      root.render(
        <CollectionSettingsListEditor
          items={[{ id: "one", label: "One", invalid: true }]}
          selectedId="one"
          readonly={false}
          onSelect={onSelect}
          onAdd={onAdd}
          onClone={onClone}
          onDelete={onDelete}
          renderDetails={(id) => <div>Details {id}</div>}
        />
      );
    });

    const click = (selector: string) => {
      const button = container.querySelector<HTMLButtonElement>(selector);
      expect(button).not.toBeNull();
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    await act(async () => {
      click("button[title='One']");
      click("button[title='Clone']");
      click("button[title='Delete']");
      click("button.settings-list-editor-add");
    });

    expect(onSelect).toHaveBeenCalledWith("one");
    expect(onClone).toHaveBeenCalledWith("one");
    expect(onDelete).toHaveBeenCalledWith("one");
    expect(onAdd).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Details one");
  });

  it("disables mutations in readonly mode", async () => {
    await act(async () => {
      root.render(
        <CollectionSettingsListEditor
          items={[{ id: "one", label: "One" }]}
          selectedId="one"
          readonly
          onSelect={vi.fn()}
          onAdd={vi.fn()}
          onClone={vi.fn()}
          onDelete={vi.fn()}
          renderDetails={() => null}
        />
      );
    });

    expect(container.querySelector<HTMLButtonElement>("button[title='Clone']")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("button[title='Delete']")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("button.settings-list-editor-add")?.disabled).toBe(true);
  });

  it("flushes a pending debounced value on unmount", async () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    let persistDebounced: ((items: string[]) => void) | undefined;
    function Harness(): null {
      persistDebounced = useCollectionSettingsPersistence<string>({ persist }).persistDebounced;
      return null;
    }

    try {
      await act(async () => root.render(<Harness />));
      persistDebounced?.(["latest"]);
      expect(persist).not.toHaveBeenCalled();

      await act(async () => root.render(null));

      expect(persist).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledWith(["latest"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
