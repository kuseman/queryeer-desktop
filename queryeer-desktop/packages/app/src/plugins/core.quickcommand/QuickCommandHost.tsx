import React, { useCallback, useEffect, useRef, useState } from "react";
import type { QuickCommandItem } from "@queryeer/api/extensions/QuickCommandExtension";
import type { FileMediator } from "@queryeer/api/files/FileMediator";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import { getQuickCommandService, type PanelState } from "./service";

void React;

type QuickCommandHostProps = {
  filesRegistry?: FilesRegistry;
  fileMediator?: FileMediator;
};

export function QuickCommandHost({ filesRegistry, fileMediator }: QuickCommandHostProps = {}): JSX.Element | null {
  const service = getQuickCommandService();

  const [panelState, setPanelState] = useState<PanelState>(
    () => service?.getState() ?? { open: false, query: "" }
  );
  const [items, setItems] = useState<QuickCommandItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const resolveCounterRef = useRef(0);

  useEffect(() => {
    if (!service) {
      return;
    }
    return service.subscribe(setPanelState);
  }, [service]);

  // Focus input when panel opens
  useEffect(() => {
    if (panelState.open) {
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [panelState.open]);

  // Resolve items whenever query or open state changes
  useEffect(() => {
    if (!panelState.open || !service) {
      setItems([]);
      return;
    }

    const counter = ++resolveCounterRef.current;
    setLoading(true);

    void (async () => {
      try {
        const activeFileId = fileMediator?.getActiveFileId() ?? null;
        const ctx = {
          activeFile: activeFileId != null ? filesRegistry?.getFile(activeFileId) : undefined,
          openFiles: filesRegistry?.listFiles() ?? []
        };
        const resolved = await service.resolveItems(panelState.query, ctx);
        if (counter === resolveCounterRef.current) {
          setItems(resolved);
          setSelectedIndex(0);
        }
      } finally {
        if (counter === resolveCounterRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [panelState.open, panelState.query, service]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const el = list.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      service?.open(e.target.value);
    },
    [service]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        service?.close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item && service) {
          void service.execute(item);
        }
      } else if (e.key === "Backspace" && panelState.query === "") {
        service?.close();
      }
    },
    [service, items, selectedIndex, panelState.query]
  );

  const handleItemClick = useCallback(
    (item: QuickCommandItem) => {
      if (service) {
        void service.execute(item);
      }
    },
    [service]
  );

  if (!panelState.open) {
    return null;
  }

  return (
    <div className="quick-command-overlay" role="presentation" onClick={() => service?.close()}>
      <div
        className="quick-command-panel"
        role="dialog"
        aria-label="Quick Command"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quick-command-input-row">
          <input
            ref={inputRef}
            type="text"
            className="quick-command-input"
            placeholder="Type a command… (>, #, $, @)"
            value={panelState.query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
            aria-controls="quick-command-list"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <ul
          id="quick-command-list"
          ref={listRef}
          className="quick-command-list"
          role="listbox"
          aria-label="Commands"
        >
          {items.length === 0 && loading && (
            <li className="quick-command-empty quick-command-loading">
              <span className="quick-command-spinner" /> Loading…
            </li>
          )}
          {items.length === 0 && !loading && (
            <li className="quick-command-empty">No results</li>
          )}
          {items.map((item, idx) => (
            <li
              key={item.id}
              role="option"
              aria-selected={idx === selectedIndex}
              className={`quick-command-item ${idx === selectedIndex ? "is-selected" : ""}`}
              onClick={() => handleItemClick(item)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              {item.titleParts ? (
                <span className="quick-command-item-title">
                  {item.titleParts.map((part, partIdx) => (
                    <span key={partIdx} style={part.color ? { color: part.color } : undefined}>{part.text}</span>
                  ))}
                </span>
              ) : (
                <span className="quick-command-item-title">{item.title}</span>
              )}
              {item.description && (
                <span className="quick-command-item-description">{item.description}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
