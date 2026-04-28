import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { Plugin } from "../../contracts/plugin/Plugin";
import type { OutputContext } from "../../contracts/extensions/OutputExtension";
import { getOutputRegistry } from "../core.queryengine/output/OutputRegistry";
import { defineStateKey } from "../../contracts/files/FileStateRegistry";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import {
  TEXT_OUTPUT_FORMATTERS,
  resolveTextOutputFormatter,
  type TextOutputFormatId
} from "./formatters";
import outputTextIconUrl from "./output-text.svg";

type TextOutputViewState = {
  formatter: TextOutputFormatId;
  lines: string[];
  scrollLine: number;
};

const VIEW_STATE_KEY = defineStateKey<TextOutputViewState>("core.queryengine.output.text.viewState");
const MAX_BUFFER_LINES = 10_000;
const WRITE_BATCH_SIZE = 200;

function capLines(lines: string[]): string[] {
  return lines.length > MAX_BUFFER_LINES ? lines.slice(lines.length - MAX_BUFFER_LINES) : lines;
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

function TextOutputView({ context }: { context: OutputContext }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [formatter, setFormatter] = useState<TextOutputFormatId>("plain");
  const [scrollLine, setScrollLine] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const scrollLineRef = useRef(0);
  const renderRevisionRef = useRef(0);

  const activeFormatter = useMemo(() => resolveTextOutputFormatter(formatter), [formatter]);
  const formattedLines = useMemo(() => capLines(activeFormatter.format(context)), [activeFormatter, context]);

  useEffect(() => {
    if (!context.fileId) return;
    const saved = getFileStateRegistry().get(context.fileId, VIEW_STATE_KEY);
    if (!saved) return;
    setFormatter(saved.formatter);
    setScrollLine(saved.scrollLine);
    scrollLineRef.current = saved.scrollLine;
  }, [context.fileId]);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;
    const terminal = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      fontSize: 12,
      scrollback: MAX_BUFFER_LINES
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    return () => {
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
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

    renderRevisionRef.current += 1;
    const revision = renderRevisionRef.current;
    renderLinesWithFlowControl(terminal, formattedLines, scrollLineRef.current, () => revision !== renderRevisionRef.current);
  }, [formattedLines]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "x")) {
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
    if (searchOpen) return;
    const timer = setTimeout(() => {
      terminalRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [searchOpen]);

  const searchOptions = {
    incremental: false,
    caseSensitive: searchCaseSensitive,
    regex: searchRegex,
    wholeWord: searchWholeWord
  };

  const handleFindNext = () => {
    if (!searchText) return;
    searchAddonRef.current?.findNext(searchText, searchOptions);
  };

  const handleFindPrev = () => {
    if (!searchText) return;
    searchAddonRef.current?.findPrevious(searchText, searchOptions);
  };

  useEffect(() => {
    if (!searchText) return;
    searchAddonRef.current?.findNext(searchText, {
      incremental: true,
      caseSensitive: searchCaseSensitive,
      regex: searchRegex,
      wholeWord: searchWholeWord
    });
  }, [searchText, searchCaseSensitive, searchRegex, searchWholeWord]);

  useEffect(() => {
    if (!context.fileId) return;
    getFileStateRegistry().set(context.fileId, VIEW_STATE_KEY, {
      formatter,
      lines: formattedLines,
      scrollLine
    });
  }, [context.fileId, formatter, formattedLines, scrollLine]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !context.fileId) return;
    const disposable = terminal.onScroll((line) => {
      scrollLineRef.current = line;
      setScrollLine(line);
      getFileStateRegistry().set(context.fileId!, VIEW_STATE_KEY, {
        formatter,
        lines: formattedLines,
        scrollLine: line
      });
    });
    return () => disposable.dispose();
  }, [context.fileId, formatter, formattedLines]);

  return (
    <div
      className="query-output-text-root"
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
      <div className="query-output-text-toolbar">
        <label htmlFor="query-output-text-format">Format</label>
        <select
          id="query-output-text-format"
          value={formatter}
          onChange={(e) => setFormatter(e.target.value as TextOutputFormatId)}
        >
          {TEXT_OUTPUT_FORMATTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setSearchOpen((open) => !open)}>Find</button>
      </div>
      {searchOpen && (
        <div className="query-output-text-findbar">
          <input
            id="query-output-text-find"
            ref={searchInputRef}
            value={searchText}
            placeholder="Find"
            onChange={(e) => {
              setSearchText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) {
                  handleFindPrev();
                } else {
                  handleFindNext();
                }
              }
            }}
          />
          <button type="button" onClick={handleFindPrev} disabled={!searchText}>Prev</button>
          <button type="button" onClick={handleFindNext} disabled={!searchText}>Next</button>
          <label>
            <input
              type="checkbox"
              checked={searchCaseSensitive}
              onChange={(e) => setSearchCaseSensitive(e.target.checked)}
            />
            Aa
          </label>
          <label>
            <input type="checkbox" checked={searchRegex} onChange={(e) => setSearchRegex(e.target.checked)} />
            .* 
          </label>
          <label>
            <input
              type="checkbox"
              checked={searchWholeWord}
              onChange={(e) => setSearchWholeWord(e.target.checked)}
            />
            W
          </label>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              terminalRef.current?.focus();
            }}
          >
            Close
          </button>
        </div>
      )}
      <div ref={containerRef} className="query-output-text-terminal" />
    </div>
  );
}

export const coreQueryEngineOutputTextPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.output.text",
    name: "Query Engine Output: Text",
    version: "0.1.0",
    kind: "core",
    description: "xterm.js text output contributor for query results",
    dependencies: ["core.queryengine"],
    requiredCapabilities: ["query.engine"]
  },
  activate: () => {
    getOutputRegistry().register({
      id: "core.queryengine.output.text",
      capability: "rows",
      mode: "primary",
      title: "Text",
      icon: outputTextIconUrl,
      priority: 200,
      render: (context) => <TextOutputView context={context} />
    });
  }
};
