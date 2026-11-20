import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeTerminal = { written: string; disposed: boolean };

const mocks = vi.hoisted(() => ({ terminals: [] as FakeTerminal[] }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public buffer = { active: { baseY: 0, getLine: () => undefined } };
    public options = {};
    public rows = 0;
    private readonly state: FakeTerminal = { written: "", disposed: false };

    constructor() {
      mocks.terminals.push(this.state);
    }

    loadAddon() {}
    open() {}
    focus() {}
    reset() {
      this.state.written = "";
    }
    write(chunk: string, cb?: () => void) {
      this.state.written += chunk;
      cb?.();
    }
    scrollToLine() {}
    onScroll() {
      return { dispose() {} };
    }
    dispose() {
      this.state.disposed = true;
    }
  }
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  }
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext() {}
    findPrevious() {}
  }
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {}
}));

import { XtermTextConsole } from "./XtermTextConsole";

function liveTerminal(): FakeTerminal {
  const live = mocks.terminals.filter((terminal) => !terminal.disposed);
  expect(live).toHaveLength(1);
  return live[0];
}

describe("XtermTextConsole", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.terminals.length = 0;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("writes lines present at mount into the terminal that survives StrictMode remounting", async () => {
    // Regression: StrictMode disposes the first terminal and creates a second one; the second
    // stayed empty because the identical lines were skipped as "already rendered".
    await act(async () => {
      root.render(
        <React.StrictMode>
          <XtermTextConsole lines={["first line", "second line"]} classNamePrefix="test" />
        </React.StrictMode>
      );
    });

    expect(mocks.terminals.length).toBeGreaterThan(1);
    expect(liveTerminal().written).toContain("first line");
    expect(liveTerminal().written).toContain("second line");
  });

  it("re-renders existing lines when the terminal is recreated", async () => {
    await act(async () => {
      root.render(<XtermTextConsole lines={["kept line"]} classNamePrefix="test" fontSize={11} />);
    });

    await act(async () => {
      root.render(<XtermTextConsole lines={["kept line"]} classNamePrefix="test" fontSize={13} />);
    });

    expect(liveTerminal().written).toContain("kept line");
  });

  it("does not rewrite the terminal when lines are unchanged", async () => {
    await act(async () => {
      root.render(<XtermTextConsole lines={["same"]} classNamePrefix="test" />);
    });
    const terminal = liveTerminal();
    terminal.written = "sentinel";

    await act(async () => {
      root.render(<XtermTextConsole lines={["same"]} classNamePrefix="test" />);
    });

    expect(terminal.written).toBe("sentinel");
  });
});
