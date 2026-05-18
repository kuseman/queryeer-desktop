import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridComponent } from "./GridComponent";

void React;

type DataEditorProps = {
  rows: number;
  getCellContent: (cell: readonly [number, number]) => { displayData?: string; data?: string };
  onVisibleRegionChanged: (range: { x: number; y: number; width: number; height: number }, tx: number, ty: number) => void;
  onCellClicked: (cell: readonly [number, number], event: CellEvent) => void;
  onCellActivated: (cell: readonly [number, number]) => void;
  onCellContextMenu: (cell: readonly [number, number], event: CellEvent) => void;
  onGridSelectionChange: (selection: GridSelectionLike) => void;
  scrollOffsetX?: number;
  scrollOffsetY?: number;
};

type GridSelectionLike = {
  current?: {
    cell: readonly [number, number];
    range: { x: number; y: number; width: number; height: number };
    rangeStack: Array<{ x: number; y: number; width: number; height: number }>;
  };
  columns: Iterable<number>;
  rows: Iterable<number>;
};

type CellEvent = {
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  localEventX: number;
  localEventY: number;
  bounds: { x: number; y: number; width: number; height: number };
  preventDefault: () => void;
};

let latestDataEditorProps: DataEditorProps | null = null;

vi.mock("@glideapps/glide-data-grid", () => {
  class CompactSelectionMock {
    private readonly values: number[];

    private constructor(values: number[] = []) {
      this.values = values;
    }

    static empty(): CompactSelectionMock {
      return new CompactSelectionMock();
    }

    add(value: number): CompactSelectionMock {
      return new CompactSelectionMock([...this.values, value]);
    }

    [Symbol.iterator](): Iterator<number> {
      return this.values[Symbol.iterator]();
    }
  }

  return {
    CompactSelection: CompactSelectionMock,
    GridCellKind: { Text: "text", Uri: "uri" },
    DataEditor: React.forwardRef((_props: DataEditorProps, _ref) => {
      latestDataEditorProps = _props;
      return React.createElement("div", { "data-testid": "glide-data-editor" });
    }),
  };
});

describe("GridComponent", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    latestDataEditorProps = null;
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("feeds Glide row count and cell content from the streaming row accessors", async () => {
    const getRow = vi.fn((index: number) => [["Ada"], ["Grace"]][index]);
    const getRowsRange = vi.fn((start: number, end: number) => [["Ada"], ["Grace"]].slice(start, end));

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "name", title: "Name", type: "string" }]}
          getRowCount={() => 2}
          getRowsRange={getRowsRange}
          getRow={getRow}
          subscribeRowsChanged={() => () => undefined}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    expect(latestDataEditorProps?.rows).toBe(2);
    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 2 }, 0, 0);
    });
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("Grace");
    expect(getRowsRange).toHaveBeenCalledWith(0, 2);
    expect(getRow).not.toHaveBeenCalled();
  });

  it("updates Glide row count when streaming rows are appended", async () => {
    vi.useFakeTimers();
    let rowCount = 1;
    let listener: (() => void) | null = null;

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          getRowCount={() => rowCount}
          getRowsRange={(start, end) => [[1], [2]].slice(start, end)}
          getRow={(index) => [[1], [2]][index]}
          subscribeRowsChanged={(nextListener) => {
            listener = nextListener;
            return () => undefined;
          }}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    expect(latestDataEditorProps?.rows).toBe(1);

    rowCount = 2;
    await act(async () => {
      listener?.();
      vi.advanceTimersByTime(100);
    });

    expect(latestDataEditorProps?.rows).toBe(2);
  });

  it("coalesces frequent streaming row notifications", async () => {
    vi.useFakeTimers();
    let rowCount = 1;
    let listener: (() => void) | null = null;
    const getRowCount = vi.fn(() => rowCount);

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          getRowCount={getRowCount}
          getRowsRange={(start, end) => [[1], [2], [3]].slice(start, end)}
          getRow={(index) => [[1], [2], [3]][index]}
          subscribeRowsChanged={(nextListener) => {
            listener = nextListener;
            return () => undefined;
          }}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    rowCount = 3;
    await act(async () => {
      listener?.();
      listener?.();
      listener?.();
    });

    expect(latestDataEditorProps?.rows).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(latestDataEditorProps?.rows).toBe(3);
    expect(getRowCount).toHaveBeenCalledTimes(2);
  });

  it("restores saved scroll offset and persists scroll changes", async () => {
    const onGridStateChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          getRowCount={() => 1}
          getRowsRange={(start, end) => [[1]].slice(start, end)}
          getRow={(index) => [[1]][index]}
          subscribeRowsChanged={() => () => undefined}
          getInitialGridState={() => ({ columnWidths: {}, scrollOffset: { x: 40, y: 120 } })}
          onGridStateChange={onGridStateChange}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    expect(latestDataEditorProps?.scrollOffsetX).toBe(40);
    expect(latestDataEditorProps?.scrollOffsetY).toBe(120);

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 5, width: 1, height: 1 }, 80, 240);
    });

    expect(onGridStateChange).toHaveBeenLastCalledWith({ columnWidths: {}, scrollOffset: { x: 0, y: 120 } });
  });

  it("opens regular values only on activation and links on single click", async () => {
    const onCellPrimaryAction = vi.fn(() => true);

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "value", title: "Value", type: "string" }]}
          getRowCount={() => 2}
          getRowsRange={(start, end) => [["plain"], ["https://example.test"]].slice(start, end)}
          getRow={(index) => [["plain"], ["https://example.test"]][index]}
          subscribeRowsChanged={() => () => undefined}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={({ value }) => String(value).startsWith("https://") ? { kind: "external" } : null}
          onCellPrimaryAction={onCellPrimaryAction}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    const event = createCellEvent();
    act(() => {
      latestDataEditorProps?.onCellClicked([0, 0], event);
    });
    expect(onCellPrimaryAction).not.toHaveBeenCalled();

    act(() => {
      latestDataEditorProps?.onCellActivated([0, 0]);
    });
    expect(onCellPrimaryAction).toHaveBeenCalledTimes(1);

    act(() => {
      latestDataEditorProps?.onCellClicked([0, 1], createCellEvent());
    });
    expect(onCellPrimaryAction).toHaveBeenCalledTimes(2);
  });

  it("positions context menu from Glide cell screen bounds", async () => {
    const onContextMenuSelection = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          getRowCount={() => 1}
          getRowsRange={(start, end) => [[1]].slice(start, end)}
          getRow={(index) => [[1]][index]}
          subscribeRowsChanged={() => () => undefined}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={onContextMenuSelection}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onCellContextMenu([0, 0], createCellEvent({ bounds: { x: 200, y: 300, width: 80, height: 20 }, localEventX: 12, localEventY: 8 }));
    });

    expect(onContextMenuSelection.mock.calls[0]?.[0]).toMatchObject({ clientX: 212, clientY: 308 });
  });

  it("ctrl-click adds individual cells to selection", async () => {
    const onSelectionChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          getRowCount={() => 1}
          getRowsRange={(start, end) => [[1]].slice(start, end)}
          getRow={(index) => [[1]][index]}
          subscribeRowsChanged={() => () => undefined}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          onSelectionChange={onSelectionChange}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onCellClicked([0, 0], createCellEvent({ ctrlKey: true }));
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({ rect: null, cells: [{ row: 0, colIndex: 0 }] }, { row: 0, colIndex: 0 });
  });

  it("ctrl-click toggles an individually selected cell off", async () => {
    const onSelectionChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          getRowCount={() => 1}
          getRowsRange={(start, end) => [[1]].slice(start, end)}
          getRow={(index) => [[1]][index]}
          subscribeRowsChanged={() => () => undefined}
          getInitialSelection={() => ({ selection: { rect: null, cells: [{ row: 0, colIndex: 0 }] }, anchor: { row: 0, colIndex: 0 } })}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          onSelectionChange={onSelectionChange}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onCellClicked([0, 0], createCellEvent({ ctrlKey: true }));
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({ rect: null, cells: [] }, { row: 0, colIndex: 0 });
  });

  it("ctrl-click after a drag selection preserves the rectangle and adds the cell", async () => {
    const onSelectionChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          getRowCount={() => 3}
          getRowsRange={(start, end) => [[1], [2], [3]].slice(start, end)}
          getRow={(index) => [[1], [2], [3]][index]}
          subscribeRowsChanged={() => () => undefined}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          onSelectionChange={onSelectionChange}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onGridSelectionChange(createGridSelection({ x: 0, y: 0, width: 1, height: 2 }));
      latestDataEditorProps?.onGridSelectionChange(createGridSelection({ x: 0, y: 2, width: 1, height: 1 }));
      latestDataEditorProps?.onCellClicked([0, 2], createCellEvent({ ctrlKey: true }));
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      { rect: { rowStart: 0, rowEnd: 1, colIndexStart: 0, colIndexEnd: 0 }, cells: [{ row: 2, colIndex: 0 }] },
      { row: 2, colIndex: 0 }
    );
  });
});

function createCellEvent(overrides: Partial<CellEvent> = {}): CellEvent {
  return {
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    localEventX: 0,
    localEventY: 0,
    bounds: { x: 0, y: 0, width: 80, height: 20 },
    preventDefault: vi.fn(),
    ...overrides,
  };
}

function createGridSelection(range: { x: number; y: number; width: number; height: number }): GridSelectionLike {
  return {
    current: { cell: [range.x, range.y], range, rangeStack: [] },
    columns: [],
    rows: [],
  };
}
