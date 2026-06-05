import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { isPrimaryModifier } from "../../shared/platform-utils";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const WRITE_BATCH_SIZE = 200;

function readCssVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function resolveXtermTheme() {
  const style = getComputedStyle(document.documentElement);
  const background = readCssVar(style, "--input-bg", "#ffffff");
  const foreground = readCssVar(style, "--text-0", "#cccccc");
  const cursor = readCssVar(style, "--accent", "#0e639c");
  const selectionBackground = readCssVar(style, "--state-select-bg", "rgba(0, 120, 215, 0.25)");

  return {
    background,
    foreground,
    cursor,
    selectionBackground,
    black: readCssVar(style, "--bg-0", "#1e1e1e"),
    brightBlack: readCssVar(style, "--text-2", "#6b6b6b"),
    red: "#cd3131",
    brightRed: "#f14c4c",
    green: "#0dbc79",
    brightGreen: "#23d18b",
    yellow: "#e5e510",
    brightYellow: "#f5f543",
    blue: "#2472c8",
    brightBlue: "#3b8eea",
    magenta: "#bc3fbc",
    brightMagenta: "#d670d6",
    cyan: "#11a8cd",
    brightCyan: "#29b8db",
    white: "#e5e5e5",
    brightWhite: "#ffffff"
  };
}

function renderLinesWithFlowControl(
  terminal: Terminal,
  lines: string[],
  scrollLine: number,
  isCancelled: () => boolean
): void {
  terminal.reset();

  let index = 0;
  const writeNext = () => {
    if (isCancelled()) return;
    if (index >= lines.length) {
      const maxBase = terminal.buffer.active.baseY;
      terminal.scrollToLine(Math.max(0, Math.min(scrollLine, maxBase)));
      return;
    }

    const chunk = lines.slice(index, index + WRITE_BATCH_SIZE).join("\n") + "\n";
    index += WRITE_BATCH_SIZE;
    terminal.write(chunk, () => {
      if (typeof queueMicrotask === "function") {
        queueMicrotask(writeNext);
        return;
      }
      setTimeout(writeNext, 0);
    });
  };

  writeNext();
}

function searchBuffer(
  terminal: Terminal,
  regex: RegExp
): Array<{ row: number; col: number; length: number }> {
  const buffer = terminal.buffer.active;
  const matches: Array<{ row: number; col: number; length: number }> = [];

  let flatString = "";
  const rowOffsets: number[] = [];

  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) break;
    rowOffsets.push(flatString.length);
    flatString += line.translateToString(true);
  }

  let m: RegExpExecArray | null;
  while ((m = regex.exec(flatString)) !== null) {
    const offset = m.index;
    let lo = 0;
    let hi = rowOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rowOffsets[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const row = lo;
    matches.push({ row, col: offset - rowOffsets[row], length: m[0].length });
    if (!regex.global) break;
  }

  return matches;
}

export type XtermTextConsoleProps = {
  lines: string[];
  classNamePrefix: string;
  fontSize?: number;
  fontFamily?: string;
  scrollback?: number;
  initialScrollLine?: number;
  onScrollLineChange?: (line: number) => void;
  toolbarContent?: ReactNode;
  findButtonAtEnd?: boolean;
  onLinkActivate?: (url: string) => void;
};

export function XtermTextConsole({
  lines,
  classNamePrefix,
  fontSize = 12,
  fontFamily = "JetBrains Mono, Consolas, monospace",
  scrollback = 10_000,
  initialScrollLine = 0,
  onScrollLineChange,
  toolbarContent,
  findButtonAtEnd = false,
  onLinkActivate
}: XtermTextConsoleProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const prevSearchOpenRef = useRef(false);
  const scrollLineRef = useRef(initialScrollLine);
  const renderRevisionRef = useRef(0);
  const lastRenderedSnapshotRef = useRef<string>("");
  const currentMatchIndexRef = useRef(-1);
  const currentSearchTextRef = useRef("");
  const onLinkActivateRef = useRef(onLinkActivate);

  useEffect(() => {
    onLinkActivateRef.current = onLinkActivate;
  }, [onLinkActivate]);

  useEffect(() => {
    scrollLineRef.current = initialScrollLine;
    terminalRef.current?.scrollToLine(initialScrollLine);
  }, [initialScrollLine]);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;
    const terminal = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontFamily,
      fontSize,
      scrollback,
      theme: resolveXtermTheme()
    });
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      onLinkActivateRef.current?.(uri);
      if (uri.startsWith("editor://")) {
        return;
      }
      window.open(uri, "_blank", "noopener,noreferrer");
    });
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    const editorLinkDisposable =
      typeof terminal.registerLinkProvider === "function"
        ? terminal.registerLinkProvider({
            provideLinks: (bufferLineNumber, callback) => {
              const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
              const text = line?.translateToString(true) ?? "";
              const links: Array<{
                range: {
                  start: { x: number; y: number };
                  end: { x: number; y: number };
                };
                text: string;
                activate: () => void;
              }> = [];
              const directUriRegex = /editor:\/\/[^\s)]+/g;
              let match: RegExpExecArray | null;
              while ((match = directUriRegex.exec(text)) !== null) {
                const uri = match[0];
                const startX = match.index + 1;
                const endX = startX + uri.length;
                links.push({
                  range: {
                    start: { x: startX, y: bufferLineNumber },
                    end: { x: endX, y: bufferLineNumber }
                  },
                  text: uri,
                  activate: () => {
                    onLinkActivateRef.current?.(uri);
                  }
                });
              }

              const locationLabelRegex = /\[line\s+(\d+),\s*col\s+(\d+)\]/gi;
              while ((match = locationLabelRegex.exec(text)) !== null) {
                const lineNumber = Number(match[1]);
                const columnNumber = Number(match[2]);
                if (!Number.isFinite(lineNumber) || lineNumber < 1 || !Number.isFinite(columnNumber) || columnNumber < 1) {
                  continue;
                }
                const uri = `editor://open?line=${lineNumber}&column=${columnNumber}`;
                const startX = match.index + 1;
                const endX = startX + match[0].length;
                links.push({
                  range: {
                    start: { x: startX, y: bufferLineNumber },
                    end: { x: endX, y: bufferLineNumber }
                  },
                  text: match[0],
                  activate: () => {
                    onLinkActivateRef.current?.(uri);
                  }
                });
              }
              callback(links);
            }
          })
        : null;
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      terminal.dispose();
      editorLinkDisposable?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fontFamily, fontSize, scrollback]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const applyTheme = () => {
      const optionsTarget = terminal.options as unknown as { theme?: unknown } | undefined;
      if (!optionsTarget) {
        return;
      }
      optionsTarget.theme = resolveXtermTheme();
      if (typeof terminal.refresh === "function" && terminal.rows > 0) {
        terminal.refresh(0, terminal.rows - 1);
      }
    };

    applyTheme();

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      applyTheme();
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["style", "data-theme-id", "class"]
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const fitAddon = fitAddonRef.current;
    if (!root || !fitAddon) return;
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const snapshot = lines.join("\n");
    if (snapshot === lastRenderedSnapshotRef.current) {
      return;
    }
    lastRenderedSnapshotRef.current = snapshot;

    renderRevisionRef.current += 1;
    const revision = renderRevisionRef.current;
    renderLinesWithFlowControl(terminal, lines, scrollLineRef.current, () => revision !== renderRevisionRef.current);
  }, [lines]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const primaryModifier = isPrimaryModifier(e);

      if (primaryModifier && e.key.toLowerCase() === "a") {
        e.preventDefault();
        terminalRef.current?.selectAll();
        return;
      }

      if (primaryModifier && e.key.toLowerCase() === "c") {
        const selectedText = terminalRef.current?.getSelection() ?? "";
        if (!selectedText) {
          return;
        }
        e.preventDefault();
        void navigator.clipboard.writeText(selectedText);
        return;
      }

      if (primaryModifier && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "x")) {
        e.preventDefault();
        if (searchOpen) {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          return;
        }
        setSearchOpen(true);
        return;
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
      }
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [searchOpen]);

  useEffect(() => {
    const wasOpen = prevSearchOpenRef.current;
    prevSearchOpenRef.current = searchOpen;
    if (searchOpen || !wasOpen) return;
    const timer = setTimeout(() => {
      terminalRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [searchOpen]);

  const buildSearchRegex = useCallback((text: string): RegExp | null => {
    try {
      let pattern = text;
      if (!searchRegex) {
        pattern = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      if (searchWholeWord) {
        pattern = `\\b${pattern}\\b`;
      }
      const flags = searchCaseSensitive ? "g" : "gi";
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }, [searchRegex, searchCaseSensitive, searchWholeWord]);

  const findAllMatches = useCallback((text: string): Array<{ row: number; col: number; length: number }> => {
    const terminal = terminalRef.current;
    if (!terminal || !text) return [];

    const regex = buildSearchRegex(text);
    if (!regex) return [];

    return searchBuffer(terminal, regex);
  }, [buildSearchRegex]);

  const matchesRef = useRef<Array<{ row: number; col: number; length: number }>>([]);

  const navigateToMatch = useCallback((match: { row: number; col: number; length: number }) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.select(match.col, match.row, match.length);
    terminal.scrollToLine(match.row);
  }, []);

  function findStartIndex(matches: Array<{ row: number; col: number }>): number {
    const terminal = terminalRef.current;
    if (!terminal || matches.length === 0) return 0;
    const sel = terminal.getSelectionPosition();
    if (sel) {
      const anchorRow = sel.start.y - 1;
      const anchorCol = sel.start.x - 1;
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        if (m.row > anchorRow || (m.row === anchorRow && m.col >= anchorCol)) {
          return i;
        }
      }
      return 0;
    }
    const viewportTop = terminal.buffer.active.viewportY;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].row >= viewportTop) {
        return i;
      }
    }
    return 0;
  }

  const handleFindNext = useCallback(() => {
    if (!searchText) return;
    currentSearchTextRef.current = searchText;
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    const currentIdx = currentMatchIndexRef.current;
    const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % matches.length : 0;
    const match = matches[nextIdx];
    currentMatchIndexRef.current = nextIdx;
    navigateToMatch(match);
  }, [searchText, navigateToMatch]);

  const handleFindPrev = useCallback(() => {
    if (!searchText) return;
    currentSearchTextRef.current = searchText;
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    const currentIdx = currentMatchIndexRef.current;
    const prevIdx = currentIdx >= 0 ? (currentIdx - 1 + matches.length) % matches.length : matches.length - 1;
    const match = matches[prevIdx];
    currentMatchIndexRef.current = prevIdx;
    navigateToMatch(match);
  }, [searchText, navigateToMatch]);

  useEffect(() => {
    if (!searchText) {
      matchesRef.current = [];
      currentMatchIndexRef.current = -1;
      return;
    }
    currentSearchTextRef.current = searchText;
    const matches = findAllMatches(searchText);
    matchesRef.current = matches;
    currentMatchIndexRef.current = -1;
    if (matches.length > 0) {
      const startIndex = findStartIndex(matches);
      currentMatchIndexRef.current = startIndex;
      navigateToMatch(matches[startIndex]);
    }
  }, [searchText, searchCaseSensitive, searchRegex, searchWholeWord, findAllMatches, navigateToMatch]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const disposable = terminal.onScroll((line) => {
      scrollLineRef.current = line;
      onScrollLineChange?.(line);
    });
    return () => disposable.dispose();
  }, [onScrollLineChange]);

  return (
    <div
      className={`${classNamePrefix}-root`}
      data-context="terminal"
      data-output-focus-target="true"
      tabIndex={-1}
      ref={rootRef}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          terminalRef.current?.focus();
        }
      }}
    >
      <div className={`${classNamePrefix}-toolbar`}>
        {!findButtonAtEnd && <button type="button" onClick={() => setSearchOpen((open) => !open)}>Find</button>}
        {toolbarContent}
        {findButtonAtEnd && <button type="button" onClick={() => setSearchOpen((open) => !open)}>Find</button>}
      </div>
      {searchOpen && (
        <div className={`${classNamePrefix}-findbar`}>
          <input
            ref={searchInputRef}
            value={searchText}
            placeholder="Find"
            onChange={(event) => {
              setSearchText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) {
                  handleFindPrev();
                } else {
                  handleFindNext();
                }
              }
            }}
          />
          <button type="button" title="Previous match (Shift+Enter)" onClick={handleFindPrev} disabled={!searchText}>Prev</button>
          <button type="button" title="Next match (Enter)" onClick={handleFindNext} disabled={!searchText}>Next</button>
          <label title="Case sensitive">
            <input
              type="checkbox"
              checked={searchCaseSensitive}
              onChange={(event) => setSearchCaseSensitive(event.target.checked)}
            />
            Aa
          </label>
          <label title="Use regular expression">
            <input
              type="checkbox"
              checked={searchRegex}
              onChange={(event) => setSearchRegex(event.target.checked)}
            />
            .*
          </label>
          <label title="Match whole word only">
            <input
              type="checkbox"
              checked={searchWholeWord}
              onChange={(event) => setSearchWholeWord(event.target.checked)}
            />
            W
          </label>
          <button
            type="button"
            title="Close (Esc)"
            onClick={() => {
              setSearchOpen(false);
              terminalRef.current?.focus();
            }}
          >
            Close
          </button>
        </div>
      )}
      <div ref={containerRef} className={`${classNamePrefix}-terminal`} />
    </div>
  );
}
