import { useCallback, useEffect, useRef, useState } from "react";
import type { OutlineSymbol } from "@queryeer/api/extensions/OutlineExtension";
import type { EditorRegistry } from "@queryeer/api/editor/EditorCapability";
import { OutlineStore } from "./OutlineStore";
import { OutlineHelpDialog } from "./OutlineHelpDialog";
import "./outline.css";

type OutlineViewProps = {
  store: OutlineStore;
  editorRegistry: EditorRegistry;
};

const KIND_SHORTHAND: Record<string, string> = {
  File: "F", Module: "M", Namespace: "N", Package: "P", Class: "C", Method: "M",
  Property: "P", Field: "F", Constructor: "C", Enum: "E", Interface: "I",
  Function: "F", Variable: "V", Constant: "C", String: "S", Number: "N",
  Boolean: "B", Array: "A", Object: "O", Key: "K", Null: "N", EnumMember: "E",
  Struct: "S", Event: "E", Operator: "O", TypeParameter: "T"
};

function flattenVisibleSymbols(symbols: OutlineSymbol[], expandedIds: Set<string>): OutlineSymbol[] {
  const flat: OutlineSymbol[] = [];
  const stack = [...symbols];
  while (stack.length > 0) {
    const symbol = stack.shift()!;
    flat.push(symbol);
    if (symbol.children && symbol.children.length > 0 && expandedIds.has(symbol.id)) {
      stack.unshift(...symbol.children);
    }
  }
  return flat;
}

const OUTLINE_TREE_FOCUS_ID = "outline-tree-focus-target";

function OutlineSymbolNode({
  symbol,
  store,
  depth = 0,
  onFocusTarget,
  onNavigateToSymbol
}: {
  symbol: OutlineSymbol;
  store: OutlineStore;
  depth?: number;
  onFocusTarget: () => void;
  onNavigateToSymbol: (symbol: OutlineSymbol) => void;
}): JSX.Element {
  const isExpanded = store.getState().expandedSymbolIds.has(symbol.id);
  const isSelected = store.getState().selectedSymbolId === symbol.id;
  const hasChildren = symbol.children && symbol.children.length > 0;

  const handleClick = useCallback(() => {
    store.setSelectedSymbolId(symbol.id);
    onNavigateToSymbol(symbol);
    onFocusTarget();
  }, [symbol, store, onFocusTarget, onNavigateToSymbol]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    store.toggleExpanded(symbol.id);
  }, [symbol.id, store]);

  return (
    <div
      className={`outline-symbol${isSelected ? " is-selected" : ""}${symbol.kind === "Event" && symbol.name === "Parse Error" ? " parse-error" : ""}`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      onClick={handleClick}
      data-symbol-id={symbol.id}
    >
      {hasChildren && (
        <span
          className={`outline-chevron${isExpanded ? " expanded" : ""}`}
          onClick={handleToggle}
        >
          {isExpanded ? "▼" : "▶"}
        </span>
      )}
      {!hasChildren && <span className="outline-chevron-spacer" />}
      <span className="outline-symbol-kind">{KIND_SHORTHAND[symbol.kind] ?? "?"}</span>
      <span className="outline-symbol-name">{symbol.name}</span>
      {symbol.detail && <span className="outline-symbol-detail">{symbol.detail}</span>}
    </div>
  );
}

function OutlineSymbolTree({
  symbols,
  store,
  onFocusTarget,
  onNavigateToSymbol
}: {
  symbols: OutlineSymbol[];
  store: OutlineStore;
  onFocusTarget: () => void;
  onNavigateToSymbol: (symbol: OutlineSymbol) => void;
}): JSX.Element {
  const renderSymbols = (symbols: OutlineSymbol[], depth: number): JSX.Element[] => {
    const result: JSX.Element[] = [];
    for (const symbol of symbols) {
      const isExpanded = store.getState().expandedSymbolIds.has(symbol.id);
      const hasChildren = symbol.children && symbol.children.length > 0;
      result.push(
        <OutlineSymbolNode key={symbol.id} symbol={symbol} store={store} depth={depth} onFocusTarget={onFocusTarget} onNavigateToSymbol={onNavigateToSymbol} />
      );
      if (isExpanded && hasChildren) {
        result.push(...renderSymbols(symbol.children!, depth + 1));
      }
    }
    return result;
  };

  return <>{renderSymbols(symbols, 0)}</>;
}

export function OutlineView({
  store,
  editorRegistry
}: OutlineViewProps): JSX.Element | null {
  const [, setVersion] = useState(0);
  const symbolsChangeDisposableRef = useRef<{ dispose(): void } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const editorRegistryRef = useRef(editorRegistry);
  editorRegistryRef.current = editorRegistry;

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setVersion((v) => v + 1);
    });
    return unsub;
  }, [store]);

  const navigateToSymbol = useCallback((symbol: OutlineSymbol) => {
    const editor = editorRegistryRef.current.getActiveEditor();
    if (!editor?.outline) return;
    editor.outline.revealSymbol(symbol);
  }, []);

  const loadSymbols = useCallback(async () => {
    const editor = editorRegistry.getActiveEditor();
    if (!editor?.outline) {
      store.clear(true);
      return;
    }
    try {
      const symbols = await editor.outline.getSymbols();
      store.setSymbols(symbols);
    } catch {
      store.clear(true);
    }
  }, [editorRegistry, store]);

  useEffect(() => {
    const unsubEditorChanged = editorRegistry.onActiveEditorChanged(() => {
      symbolsChangeDisposableRef.current?.dispose();
      symbolsChangeDisposableRef.current = null;

      const editor = editorRegistry.getActiveEditor();
      if (editor?.outline) {
        store.setHasOutlineCapability(true);
        loadSymbols();
        symbolsChangeDisposableRef.current = editor.outline.onSymbolsChanged(() => {
          void loadSymbols();
        });
      } else {
        store.clear(true);
      }
    });

    const currentEditor = editorRegistry.getActiveEditor();
    if (currentEditor?.outline) {
      store.setHasOutlineCapability(true);
      loadSymbols();
      symbolsChangeDisposableRef.current = currentEditor.outline.onSymbolsChanged(() => {
        void loadSymbols();
      });
    } else {
      store.clear(true);
    }

    return () => {
      unsubEditorChanged.dispose();
      symbolsChangeDisposableRef.current?.dispose();
      symbolsChangeDisposableRef.current = null;
    };
  }, [editorRegistry, loadSymbols, store]);

  const focusOutlineTree = () => {
    const el = document.getElementById(OUTLINE_TREE_FOCUS_ID);
    el?.focus();
  };

  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent) => {
    const state = store.getState();
    if (state.symbols.length === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const flat = flattenVisibleSymbols(state.symbols, state.expandedSymbolIds);
      if (flat.length === 0) return;

      const currentIndex = state.selectedSymbolId
        ? flat.findIndex((s) => s.id === state.selectedSymbolId)
        : -1;

      let nextIndex: number;
      if (e.key === "ArrowDown") {
        nextIndex = currentIndex < flat.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : flat.length - 1;
      }

      const nextSymbol = flat[nextIndex];
      store.setSelectedSymbolId(nextSymbol.id);
      navigateToSymbol(nextSymbol);

      const el = treeRef.current?.querySelector(`[data-symbol-id="${nextSymbol.id}"]`);
      el?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (!state.selectedSymbolId) return;
      const flat = flattenVisibleSymbols(state.symbols, state.expandedSymbolIds);
      const selected = flat.find((s) => s.id === state.selectedSymbolId);
      if (selected && selected.children && selected.children.length > 0) {
        store.toggleExpanded(selected.id);
      }
    }
  }, [store, navigateToSymbol]);

  const state = store.getState();
  const helpDialog = state.showHelp ? <OutlineHelpDialog onClose={() => store.setShowHelp(false)} /> : null;

  if (!state.hasOutlineCapability) {
    return helpDialog;
  }

  if (state.error) {
    return (
      <>
        <div className="outline-view">
          <div className="outline-tree">
            <div className="outline-symbol parse-error" style={{ paddingLeft: "8px" }}>
              <span className="outline-symbol-kind">E</span>
              <span className="outline-symbol-name">Error</span>
              <span className="outline-symbol-detail">{state.error}</span>
            </div>
          </div>
        </div>
        {helpDialog}
      </>
    );
  }

  if (state.symbols.length === 0) {
    return (
      <>
        <div className="outline-view">
          <div className="outline-empty">No symbols in file</div>
        </div>
        {helpDialog}
      </>
    );
  }

  return (
    <>
      <div className="outline-view">
        <div
          id={OUTLINE_TREE_FOCUS_ID}
          className="outline-tree"
          ref={treeRef}
          tabIndex={0}
          role="tree"
          aria-label="Document outline"
          onKeyDown={handleTreeKeyDown}
        >
          <OutlineSymbolTree symbols={state.symbols} store={store} onFocusTarget={focusOutlineTree} onNavigateToSymbol={navigateToSymbol} />
        </div>
      </div>
      {helpDialog}
    </>
  );
}