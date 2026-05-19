import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridComponent } from "./GridComponent";

void React;

type GridColumnLike = {
  id?: string;
  title: string;
  width?: number;
};

type DataEditorProps = {
  rows: number;
  columns: readonly GridColumnLike[];
  getCellContent: (cell: readonly [number, number]) => { displayData?: string; data?: string };
  onVisibleRegionChanged: (range: { x: number; y: number; width: number; height: number }, tx: number, ty: number) => void;
  onCellClicked: (cell: readonly [number, number], event: CellEvent) => void;
  onCellActivated: (cell: readonly [number, number]) => void;
  onCellContextMenu: (cell: readonly [number, number], event: CellEvent) => void;
  onHeaderClicked: (colIndex: number) => void;
  onGridSelectionChange: (selection: GridSelectionLike) => void;
  onColumnMoved?: (startIndex: number, endIndex: number) => void;
  reorderColumns?: boolean;
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
const latestDataEditorRef: { current: { remeasureColumns: ReturnType<typeof vi.fn> } | null } = { current: null };

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
    DataEditor: React.forwardRef((_props: DataEditorProps, _ref: React.Ref<unknown>) => {
      latestDataEditorProps = _props;
      const refObj = { remeasureColumns: vi.fn(), updateCells: vi.fn() };
      if (_ref && typeof _ref === "object" && "current" in _ref) {
        (_ref as React.MutableRefObject<{ remeasureColumns: ReturnType<typeof vi.fn>; updateCells: ReturnType<typeof vi.fn> }>).current = refObj;
        latestDataEditorRef.current = refObj;
      }
      return null;
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

    getRowCount.mockClear();

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
    expect(getRowCount).toHaveBeenCalledTimes(1);
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

    expect(onGridStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ scrollOffset: { x: 0, y: 120 } }));
  });

  it("opens links on single click and non-link cells on double-click or Enter", async () => {
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
    act(() => {
      latestDataEditorProps?.onCellActivated([0, 0]);
    });
    expect(onCellPrimaryAction).not.toHaveBeenCalled();

    act(() => {
      latestDataEditorProps?.onCellClicked([0, 0], createCellEvent());
    });
    act(() => {
      latestDataEditorProps?.onCellClicked([0, 0], createCellEvent());
    });
    act(() => {
      latestDataEditorProps?.onCellActivated([0, 0]);
    });
    expect(onCellPrimaryAction).toHaveBeenCalledTimes(1);

    act(() => {
      latestDataEditorProps?.onCellClicked([0, 0], createCellEvent());
    });
    act(() => {
      latestDataEditorProps?.onCellActivated([0, 0]);
    });
    expect(onCellPrimaryAction).toHaveBeenCalledTimes(1);

    act(() => {
      latestDataEditorProps?.onCellClicked([0, 1], createCellEvent());
    });
    expect(onCellPrimaryAction).toHaveBeenCalledTimes(2);
  });

  it("activates cell via Enter key", async () => {
    const onCellPrimaryAction = vi.fn(() => true);

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "value", title: "Value", type: "string" }]}
          getRowCount={() => 2}
          getRowsRange={(start, end) => [["plain"], ["text"]].slice(start, end)}
          getRow={(index) => [["plain"], ["text"]][index]}
          subscribeRowsChanged={() => () => undefined}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={onCellPrimaryAction}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    const container = rootElement.firstElementChild;
    expect(container).not.toBeNull();
    act(() => {
      container!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    act(() => {
      latestDataEditorProps?.onCellActivated([0, 0]);
    });
    expect(onCellPrimaryAction).toHaveBeenCalledTimes(1);
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

  it("auto-sizes columns when data arrives after mount", async () => {
    vi.useFakeTimers();
    let rowCount = 0;
    let listener: (() => void) | null = null;
    const onGridStateChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          autoSizeColumnThreshold={30}
          getRowCount={() => rowCount}
          getRowsRange={(start, end) => [[42]].slice(start, end)}
          getRow={() => [42]}
          subscribeRowsChanged={(nextListener) => {
            listener = nextListener;
            return () => undefined;
          }}
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

    expect(onGridStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ columnWidths: { id: 60 } }));

    rowCount = 1;
    await act(async () => {
      listener?.();
      vi.advanceTimersByTime(100);
    });

    expect(onGridStateChange).toHaveBeenCalledWith(expect.objectContaining({ columnWidths: { id: 60 } }));
  });

  it("auto-sizes columns on threshold crossing during streaming", async () => {
    vi.useFakeTimers();
    let rowCount = 2;
    let listener: (() => void) | null = null;
    const onGridStateChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          autoSizeColumnThreshold={5}
          getRowCount={() => rowCount}
          getRowsRange={(start, end) => [[1], [2], [3], [4], [5], [6]].slice(start, end)}
          getRow={(index) => [[1], [2], [3], [4], [5], [6]][index]}
          subscribeRowsChanged={(nextListener) => {
            listener = nextListener;
            return () => undefined;
          }}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 2 }, 0, 0);
    });

    onGridStateChange.mockClear();

    rowCount = 6;
    await act(async () => {
      listener?.();
      vi.advanceTimersByTime(100);
    });

    expect(onGridStateChange).toHaveBeenCalledWith(expect.objectContaining({ columnWidths: { id: 60 } }));
  });

  it("auto-sizes columns after debounce when streaming pauses", async () => {
    vi.useFakeTimers();
    let rowCount = 1;
    let listener: (() => void) | null = null;
    const onGridStateChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "id", title: "Id", type: "int" }]}
          autoSizeColumnThreshold={30}
          getRowCount={() => rowCount}
          getRowsRange={(start, end) => [[1], [2]].slice(start, end)}
          getRow={(index) => [[1], [2]][index]}
          subscribeRowsChanged={(nextListener) => {
            listener = nextListener;
            return () => undefined;
          }}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 2 }, 0, 0);
    });

    onGridStateChange.mockClear();

    rowCount = 2;
    await act(async () => {
      listener?.();
      vi.advanceTimersByTime(100);
    });

    expect(onGridStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ columnWidths: { id: 60 } }));

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onGridStateChange).toHaveBeenCalledWith(expect.objectContaining({ columnWidths: { id: 60 } }));
  });

  it("enables column reorder via onColumnMoved callback", async () => {
    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "a", title: "A", type: "int" }, { key: "b", title: "B", type: "string" }]}
          getRowCount={() => 1}
          getRowsRange={(start, end) => [[1, "x"]].slice(start, end)}
          getRow={(index) => [[1, "x"]][index]}
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

    expect(typeof latestDataEditorProps?.onColumnMoved).toBe("function");
  });

  it("persists column order on move via onGridStateChange", async () => {
    const onGridStateChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "a", title: "A", type: "int" }, { key: "b", title: "B", type: "string" }, { key: "c", title: "C", type: "int" }]}
          getRowCount={() => 1}
          getRowsRange={(start, end) => [[1, "x", 2]].slice(start, end)}
          getRow={(index) => [[1, "x", 2]][index]}
          subscribeRowsChanged={() => () => undefined}
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

    act(() => {
      latestDataEditorProps?.onColumnMoved?.(0, 1);
    });

    expect(onGridStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ columnOrder: ["b", "a", "c"] })
    );
  });

  it("returns correct cell content after column reorder", async () => {
    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "a", title: "A", type: "int" }, { key: "b", title: "B", type: "string" }]}
          getRowCount={() => 2}
          getRowsRange={(start, end) => [[1, "hello"], [2, "world"]].slice(start, end)}
          getRow={(index) => [[1, "hello"], [2, "world"]][index]}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 2, height: 2 }, 0, 0);
    });

    act(() => {
      latestDataEditorProps?.onColumnMoved?.(0, 1);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("hello");
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("world");
    expect(latestDataEditorProps?.getCellContent([1, 0]).displayData).toBe("1");
  });

  it("resets column order when columns change", async () => {
    let gridColumns = [{ key: "a", title: "A", type: "int" }, { key: "b", title: "B", type: "string" }];

    await act(async () => {
      root.render(
        <GridComponent
          columns={gridColumns}
          getRowCount={() => 1}
          getRowsRange={(start, end) => [[1, "x"]].slice(start, end)}
          getRow={(index) => [[1, "x"]][index]}
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

    act(() => {
      latestDataEditorProps?.onColumnMoved?.(0, 1);
    });

    gridColumns = [{ key: "x", title: "X", type: "int" }, { key: "y", title: "Y", type: "string" }];
    await act(async () => {
      root.render(
        <GridComponent
          columns={gridColumns}
          getRowCount={() => 2}
          getRowsRange={(start, end) => [[1, "x"], [2, "y"]].slice(start, end)}
          getRow={(index) => [[1, "x"], [2, "y"]][index]}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 2, height: 2 }, 0, 0);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("1");
    expect(latestDataEditorProps?.getCellContent([1, 0]).displayData).toBe("x");
  });

  it("ctrl+click selects correct data index after column reorder", async () => {
    const onSelectionChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "a", title: "A", type: "int" }, { key: "b", title: "B", type: "string" }, { key: "c", title: "C", type: "int" }]}
          getRowCount={() => 3}
          getRowsRange={(start, end) => [[1, "hello", 2], [4, "world", 5], [7, "!", 9]].slice(start, end)}
          getRow={(index) => [[1, "hello", 2], [4, "world", 5], [7, "!", 9]][index]}
          subscribeRowsChanged={() => () => undefined}
          onSelectionChange={onSelectionChange}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onColumnMoved?.(1, 0);
    });

    act(() => {
      latestDataEditorProps?.onCellClicked([0, 0], createCellEvent({ ctrlKey: true }));
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      { rect: null, cells: [{ row: 0, colIndex: 1 }] },
      { row: 0, colIndex: 1 }
    );
  });

  it("drag selection bounding box maps to correct data indices after column reorder", async () => {
    const onSelectionChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "a", title: "A", type: "int" }, { key: "b", title: "B", type: "string" }, { key: "c", title: "C", type: "int" }]}
          getRowCount={() => 3}
          getRowsRange={(start, end) => [[1, "x", 2], [3, "y", 4], [5, "z", 6]].slice(start, end)}
          getRow={(index) => [[1, "x", 2], [3, "y", 4], [5, "z", 6]][index]}
          subscribeRowsChanged={() => () => undefined}
          onSelectionChange={onSelectionChange}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onColumnMoved?.(1, 0);
    });

    act(() => {
      latestDataEditorProps?.onGridSelectionChange(createGridSelection({ x: 0, y: 0, width: 2, height: 2 }));
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      { rect: { rowStart: 0, rowEnd: 1, colIndexStart: 0, colIndexEnd: 1 }, cells: [] },
      { row: 0, colIndex: 0 }
    );
  });

  it("ctrl+c copies selection with correct data indices after column reorder", async () => {
    const onCopySelection = vi.fn();
    const onSelectionChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "a", title: "A", type: "int" }, { key: "b", title: "B", type: "string" }, { key: "c", title: "C", type: "int" }]}
          getRowCount={() => 3}
          getRowsRange={(start, end) => [[1, "hello", 2], [4, "world", 5], [7, "!", 9]].slice(start, end)}
          getRow={(index) => [[1, "hello", 2], [4, "world", 5], [7, "!", 9]][index]}
          subscribeRowsChanged={() => () => undefined}
          onSelectionChange={onSelectionChange}
          onCopySelection={onCopySelection}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 3, height: 3 }, 0, 0);
    });

    act(() => {
      latestDataEditorProps?.onColumnMoved?.(1, 0);
    });

    act(() => {
      latestDataEditorProps?.onCellClicked([0, 0], createCellEvent({ ctrlKey: true }));
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ cells: expect.arrayContaining([{ row: 0, colIndex: 1 }]) }),
      expect.anything()
    );

    const container = rootElement.firstElementChild;
    expect(container).not.toBeNull();
    act(() => {
      container!.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true }));
    });

    expect(onCopySelection).toHaveBeenCalledTimes(1);
    const snapshot = onCopySelection.mock.calls[0]?.[0];
    expect(snapshot).toBeDefined();
    expect(snapshot.model).toEqual(
      expect.objectContaining({ cells: expect.arrayContaining([{ row: 0, colIndex: 1 }]) })
    );

    expect(snapshot.colOrder).toEqual(["b", "a", "c"]);
  });

  it("copy without column reorder has undefined colOrder", async () => {
    const onCopySelection = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "a", title: "A", type: "int" }, { key: "b", title: "B", type: "string" }]}
          getRowCount={() => 2}
          getRowsRange={(start, end) => [[1, "hello"], [2, "world"]].slice(start, end)}
          getRow={(index) => [[1, "hello"], [2, "world"]][index]}
          subscribeRowsChanged={() => () => undefined}
          onCopySelection={onCopySelection}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 2, height: 2 }, 0, 0);
    });

    act(() => {
      latestDataEditorProps?.onGridSelectionChange(createGridSelection({ x: 0, y: 0, width: 2, height: 2 }));
    });

    const container = rootElement.firstElementChild;
    expect(container).not.toBeNull();
    act(() => {
      container!.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true }));
    });

    expect(onCopySelection).toHaveBeenCalledTimes(1);
    const snapshot = onCopySelection.mock.calls[0]?.[0];
    expect(snapshot.colOrder).toBeUndefined();
  });

  it("copy after column reorder carries colOrder matching visual order", async () => {
    const onCopySelection = vi.fn();
    const onSelectionChange = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "x", title: "X", type: "int" }, { key: "y", title: "Y", type: "string" }, { key: "z", title: "Z", type: "int" }]}
          getRowCount={() => 2}
          getRowsRange={(start, end) => [[1, "hello", 2], [4, "world", 5]].slice(start, end)}
          getRow={(index) => [[1, "hello", 2], [4, "world", 5]][index]}
          subscribeRowsChanged={() => () => undefined}
          onSelectionChange={onSelectionChange}
          onCopySelection={onCopySelection}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 3, height: 3 }, 0, 0);
    });

    // Reorder: move Y from index 1 to visual index 0 => visual order [Y, X, Z]
    act(() => {
      latestDataEditorProps?.onColumnMoved?.(1, 0);
    });

    act(() => {
      latestDataEditorProps?.onGridSelectionChange(createGridSelection({ x: 0, y: 0, width: 2, height: 1 }));
    });

    const container = rootElement.firstElementChild;
    expect(container).not.toBeNull();
    act(() => {
      container!.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true }));
    });

    expect(onCopySelection).toHaveBeenCalledTimes(1);
    const snapshot = onCopySelection.mock.calls[0]?.[0];
    expect(snapshot.colOrder).toEqual(["y", "x", "z"]);
  });

  it("ignores header click when isStreaming is true", async () => {
    const getRow = vi.fn((index: number) => [["b"], ["a"]][index]);

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "name", title: "Name", type: "string" }]}
          getRowCount={() => 2}
          getRowsRange={(start, end) => [["b"], ["a"]].slice(start, end)}
          getRow={getRow}
          subscribeRowsChanged={() => () => undefined}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
          isStreaming={true}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("b");
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("a");
  });

  it("sorts rows ascending on header click when streaming is complete", async () => {
    vi.useFakeTimers();
    let rowCount = 2;
    const getRow = vi.fn((index: number) => [["c"], ["a"], ["b"]][index]);
    const getRowsRange = vi.fn((start: number, end: number) => [["c"], ["a"], ["b"]].slice(start, end));

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "name", title: "Name", type: "string" }]}
          getRowCount={() => rowCount}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 3 }, 0, 0);
    });

    rowCount = 3;
    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("a");
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("b");
    expect(latestDataEditorProps?.getCellContent([0, 2]).displayData).toBe("c");
  });

  it("sorts rows descending on second header click", async () => {
    vi.useFakeTimers();
    const rowCount = 3;
    const getRowsRange = vi.fn((start: number, end: number) => [["c"], ["a"], ["b"]].slice(start, end));

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "name", title: "Name", type: "string" }]}
          getRowCount={() => rowCount}
          getRowsRange={getRowsRange}
          getRow={(index) => [["c"], ["a"], ["b"]][index]}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 3 }, 0, 0);
    });

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("c");
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("b");
    expect(latestDataEditorProps?.getCellContent([0, 2]).displayData).toBe("a");
  });

  it("clears sort on third header click restoring original order", async () => {
    vi.useFakeTimers();
    const rowCount = 3;
    const getRowsRange = vi.fn((start: number, end: number) => [["c"], ["a"], ["b"]].slice(start, end));

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "name", title: "Name", type: "string" }]}
          getRowCount={() => rowCount}
          getRowsRange={getRowsRange}
          getRow={(index) => [["c"], ["a"], ["b"]][index]}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 3 }, 0, 0);
    });

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 3 }, 0, 0);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("c");
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("a");
    expect(latestDataEditorProps?.getCellContent([0, 2]).displayData).toBe("b");
  });

  it("sorts numeric columns numerically rather than lexicographically", async () => {
    vi.useFakeTimers();
    const rowCount = 3;
    const getRowsRange = vi.fn((start: number, end: number) => [[100], [20], [3]].slice(start, end));

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "val", title: "Val", type: "int" }]}
          getRowCount={() => rowCount}
          getRowsRange={getRowsRange}
          getRow={(index) => [[100], [20], [3]][index]}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 3 }, 0, 0);
    });

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("3");
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("20");
    expect(latestDataEditorProps?.getCellContent([0, 2]).displayData).toBe("100");
  });

  it("places null rows at the end when sorting ascending", async () => {
    vi.useFakeTimers();
    const rowCount = 3;
    const getRowsRange = vi.fn((start: number, end: number) => [["b"], [null], ["a"]].slice(start, end));

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "name", title: "Name", type: "string" }]}
          getRowCount={() => rowCount}
          getRowsRange={getRowsRange}
          getRow={(index) => [["b"], [null], ["a"]][index]}
          subscribeRowsChanged={() => () => undefined}
          resolveCellDisplayValue={(_type, value) => String(value ?? "")}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          onContextMenuSelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 3 }, 0, 0);
    });

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("a");
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("b");
    expect(latestDataEditorProps?.getCellContent([0, 2]).displayData).toBe("");
  });

  it("displays sort indicator arrow in column header title", async () => {
    vi.useFakeTimers();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "name", title: "Name", type: "string" }]}
          getRowCount={() => 2}
          getRowsRange={(start, end) => [["b"], ["a"]].slice(start, end)}
          getRow={(index) => [["b"], ["a"]][index]}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 2 }, 0, 0);
    });

    const columnsBefore = latestDataEditorProps?.columns;
    expect(columnsBefore?.[0]?.title).toBe("Name");

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });

    act(() => {
      vi.advanceTimersByTime(10);
    });

    const columnsAfterAsc = latestDataEditorProps?.columns;
    expect(columnsAfterAsc?.[0]?.title).toBe("\u25B2 Name");
  });

  it("clears sort when new streaming rows arrive", async () => {
    vi.useFakeTimers();
    const rowCount = 2;
    let listener: (() => void) | null = null;
    const getRowsRange = vi.fn((start: number, end: number) => [["b"], ["a"]].slice(start, end));

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "name", title: "Name", type: "string" }]}
          getRowCount={() => rowCount}
          getRowsRange={getRowsRange}
          getRow={(index) => [["b"], ["a"]][index]}
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

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 2 }, 0, 0);
    });

    act(() => {
      latestDataEditorProps?.onHeaderClicked(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("a");
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("b");

    getRowsRange.mockImplementation((start: number, end: number) => [["x"], ["y"]].slice(start, end));

    await act(async () => {
      listener?.();
      vi.advanceTimersByTime(100);
    });

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 1, height: 2 }, 0, 0);
    });

    expect(latestDataEditorProps?.getCellContent([0, 0]).displayData).toBe("x");
    expect(latestDataEditorProps?.getCellContent([0, 1]).displayData).toBe("y");
  });

  it("passes valid snapshot with row data to onContextMenuSelection right after left-click", async () => {
    const onContextMenuSelection = vi.fn();

    await act(async () => {
      root.render(
        <GridComponent
          columns={[{ key: "a", title: "A", type: "int" }, { key: "b", title: "B", type: "string" }]}
          getRowCount={() => 2}
          getRowsRange={(start, end) => [[1, "hello"], [2, "world"]].slice(start, end)}
          getRow={(index) => [[1, "hello"], [2, "world"]][index]}
          subscribeRowsChanged={() => () => undefined}
          onContextMenuSelection={onContextMenuSelection}
          resolveCellDisplayValue={(_type, value) => String(value)}
          resolveCellLink={() => null}
          onCellPrimaryAction={() => false}
          onCopySelection={() => undefined}
          isDarkTheme={false}
        />
      );
    });

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged({ x: 0, y: 0, width: 2, height: 2 }, 0, 0);
    });

    act(() => {
      latestDataEditorProps?.onGridSelectionChange(createGridSelection({ x: 0, y: 0, width: 1, height: 1 }));
    });

    act(() => {
      latestDataEditorProps?.onCellContextMenu([0, 0], createCellEvent({ button: 2 }));
    });

    expect(onContextMenuSelection).toHaveBeenCalledTimes(1);
    const snapshot = onContextMenuSelection.mock.calls[0]?.[1];
    expect(snapshot).toBeDefined();
    expect(snapshot.model).toBeDefined();
    expect(snapshot.model.rect).not.toBeNull();
    expect(snapshot.rowsByIndex).toBeDefined();
    expect(snapshot.rowsByIndex[0]).toBeDefined();
    expect(snapshot.rowsByIndex[0]?.__values).toEqual([1, "hello"]);
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
