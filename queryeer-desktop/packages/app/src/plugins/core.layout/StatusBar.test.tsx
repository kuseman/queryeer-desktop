import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutStatusItemContribution } from "@queryeer/api/extensions/LayoutExtension";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

  it("does not rerender stable items for unrelated parent renders", () => {
    const renderStableItem = vi.fn(() => <span>Stable</span>);
    const statusItems: LayoutStatusItemContribution[] = [{
      id: "stable",
      alignment: "left",
      render: renderStableItem
    }];
    const executeCommand = vi.fn(async () => ({ commandId: "", executed: true }));
    const canExecuteCommand = vi.fn(() => true);
    let rerenderParent = () => {};

    function Harness(): JSX.Element {
      const [, setVersion] = useState(0);
      rerenderParent = () => setVersion((version) => version + 1);
      return (
        <StatusBar
          statusItemsLeft={statusItems}
          statusItemsRight={[]}
          executeCommand={executeCommand}
          canExecuteCommand={canExecuteCommand}
        />
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    expect(renderStableItem).toHaveBeenCalledTimes(1);

    act(() => {
      rerenderParent();
    });

    expect(renderStableItem).toHaveBeenCalledTimes(1);
  });
});
