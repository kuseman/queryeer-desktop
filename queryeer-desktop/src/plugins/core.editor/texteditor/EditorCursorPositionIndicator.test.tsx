import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorCursorPositionIndicator } from "./EditorCursorPositionIndicator";

type CursorListener = (event: { position: { lineNumber: number; column: number } }) => void;

const mocks = vi.hoisted(() => {
  const cursorListeners = new Set<CursorListener>();
  return {
    cursorListeners,
    getPositionMock: vi.fn(),
    getCommandTargetEditorMock: vi.fn(),
    onDidChangeCursorPositionMock: vi.fn((listener: CursorListener) => {
      cursorListeners.add(listener);
      return { dispose: () => cursorListeners.delete(listener) };
    })
  };
});

vi.mock("./TextEditorRegistry", () => ({
  getTextEditorRegistry: () => ({
    getCommandTargetEditor: mocks.getCommandTargetEditorMock
  })
}));

describe("EditorCursorPositionIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    mocks.cursorListeners.clear();
    vi.clearAllMocks();
  });

  it("renders nothing when no editor is active", () => {
    mocks.getCommandTargetEditorMock.mockReturnValue(null);
    act(() => { root.render(<EditorCursorPositionIndicator />); });
    expect(container.textContent).toBe("");
  });

  it("renders cursor position from active editor", () => {
    const mockEditor = {
      getPosition: mocks.getPositionMock,
      onDidChangeCursorPosition: mocks.onDidChangeCursorPositionMock
    };
    mocks.getPositionMock.mockReturnValue({ lineNumber: 42, column: 15 });
    mocks.getCommandTargetEditorMock.mockReturnValue(mockEditor);

    act(() => { root.render(<EditorCursorPositionIndicator />); });

    expect(container.textContent).toBe("Ln 42, Col 15");
  });

  it("updates position on cursor change event", () => {
    const mockEditor = {
      getPosition: mocks.getPositionMock,
      onDidChangeCursorPosition: mocks.onDidChangeCursorPositionMock
    };
    mocks.getPositionMock.mockReturnValue({ lineNumber: 1, column: 1 });
    mocks.getCommandTargetEditorMock.mockReturnValue(mockEditor);

    act(() => { root.render(<EditorCursorPositionIndicator />); });
    expect(container.textContent).toBe("Ln 1, Col 1");

    act(() => {
      for (const listener of mocks.cursorListeners) {
        listener({ position: { lineNumber: 99, column: 7 } });
      }
    });
    expect(container.textContent).toBe("Ln 99, Col 7");
  });
});
