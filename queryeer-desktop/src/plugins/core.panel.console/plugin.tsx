import { useEffect, useMemo, useRef, useState } from "react";
import type { BackendLogEntry, BackendLogLevel } from "../../contracts/backend";
import type { Plugin } from "../../contracts/plugin/Plugin";
import { requestOpenPanel } from "../../renderer/shell/layout-panel-events";
import { XtermTextConsole } from "../../renderer/components/XtermTextConsole";
import {
  getConsolePanelVisible,
  getConsoleNotificationState,
  notifyConsoleErrorAppended,
  setConsolePanelVisible,
  subscribeConsoleNotification,
  getFrontendLogEntries,
  clearFrontendLogEntries,
  type FrontendLogEntry,
} from "./console-state";

export const CONSOLE_PANEL_TAB_ID = "core.panel.console.tab";

const LOG_LEVEL_ORDER: Record<BackendLogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
};

const LOG_LEVEL_COLOR: Record<BackendLogLevel, string> = {
  trace: "\x1b[2m",    // dim — least prominent
  debug: "\x1b[36m",   // cyan — clearly above trace, below info
  info:  "",           // terminal default
  warn:  "\x1b[33m",   // yellow
  error: "\x1b[91m"    // bright red
};

const ANSI_RESET = "\x1b[0m";

const LOG_LEVEL_OPTIONS: { value: BackendLogLevel; label: string }[] = [
  { value: "trace", label: "TRACE" },
  { value: "debug", label: "DEBUG" },
  { value: "info", label: "INFO" },
  { value: "warn", label: "WARN" },
  { value: "error", label: "ERROR" }
];

const CONSOLE_LOG_LEVEL_STORAGE_KEY = "core.panel.console.logLevel";

function isBackendLogLevel(value: string): value is BackendLogLevel {
  return value === "trace" || value === "debug" || value === "info" || value === "warn" || value === "error";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function formatLocalIsoDateTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }

  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  const milliseconds = pad3(date.getMilliseconds());

  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = pad2(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetRemainderMinutes = pad2(Math.abs(offsetMinutes) % 60);
  const offset = `${offsetSign}${offsetHours}:${offsetRemainderMinutes}`;

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offset}`;
}

let configureLogFlowPromise: Promise<void> | null = null;

function ensureLogFlowConfigured(): Promise<void> {
  if (!configureLogFlowPromise) {
    configureLogFlowPromise = window.appShell.isDev().then((isDev) => {
      return window.appShell.setLogFlow(isDev);
    });
  }
  return configureLogFlowPromise;
}

export const corePanelConsolePlugin: Plugin = {
  manifest: {
    id: "core.panel.console",
    name: "Core Panel Console",
    version: "0.1.0",
    kind: "core",
    description: "Bottom panel console powered by xterm.js for backend and gateway logs"
  },
  activate: (context) => {
    context.layout.registerPanel({
      id: "core.panel.console.panel",
      tabs: [
        {
          id: CONSOLE_PANEL_TAB_ID,
          title: "Console",
          order: 10,
          render: () => <ConsolePanel />
        }
      ],
      defaultHeight: 220,
      minHeight: 120,
      maxHeight: 420
    });

    context.layout.registerStatusItem({
      id: "core.panel.console.status.errorNotification",
      alignment: "left",
      order: 20,
      commandId: "core.panel.console.open",
      render: () => <ConsoleStatusItem />
    });

    context.commands.registerCommand({
      id: "core.panel.console.open",
      title: "Open Console Panel",
      handler: () => {
        requestOpenPanel({ tabId: CONSOLE_PANEL_TAB_ID, toggle: true });
      }
    });

    const logSeenKeys = new Set<string>();
    const pollForErrors = async () => {
      try {
        const status = await window.appShell.getBackendStatus();
        for (const entry of status.backendLogs) {
          const key = `${entry.timestamp}-${entry.level}-${entry.source}-${entry.message}`;
          if (logSeenKeys.has(key)) {
            continue;
          }
          logSeenKeys.add(key);
          if (entry.level === "error" && !getConsolePanelVisible()) {
            notifyConsoleErrorAppended();
          }
        }
      } catch {
        // ignore transient polling errors
      }
      window.setTimeout(() => {
        void pollForErrors();
      }, 3000);
    };
    void pollForErrors();
  }
};

function ConsoleStatusItem() {
  const [unseenCount, setUnseenCount] = useState(() => getConsoleNotificationState().unseenErrorCount);
  const [panelVisible, setPanelVisible] = useState(() => getConsolePanelVisible());

  useEffect(() => {
    return subscribeConsoleNotification(() => {
      setUnseenCount(getConsoleNotificationState().unseenErrorCount);
      setPanelVisible(getConsolePanelVisible());
    });
  }, []);

  const showBadge = !panelVisible && unseenCount > 0;
  return (
    <span>
      Console
      {showBadge && (
        <span className="console-status-error-badge">{unseenCount > 99 ? "99+" : unseenCount}</span>
      )}
    </span>
  );
}

function ConsolePanel() {
  useEffect(() => {
    setConsolePanelVisible(true);
    return () => {
      setConsolePanelVisible(false);
    };
  }, []);

  const renderedKeysRef = useRef<Set<string>>(new Set());
  const clearCutoffMsRef = useRef<number>(0);
  const traceEnabledRef = useRef<boolean | null>(null);
  const levelInitializedRef = useRef(false);
  const [entries, setEntries] = useState<BackendLogEntry[]>([]);
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);
  const [levelFilter, setLevelFilter] = useState<BackendLogLevel>("info");
  const [frontendEntries, setFrontendEntries] = useState<FrontendLogEntry[]>([]);

  useEffect(() => {
    let active = true;
    void window.appShell.isDev().then((isDev) => {
      if (!active) {
        return;
      }
      try {
        const stored = localStorage.getItem(CONSOLE_LOG_LEVEL_STORAGE_KEY);
        if (stored && isBackendLogLevel(stored)) {
          levelInitializedRef.current = true;
          setLevelFilter(stored);
          return;
        }
      } catch {
        // ignore storage read errors
      }
      levelInitializedRef.current = true;
      setLevelFilter(isDev ? "info" : "error");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!levelInitializedRef.current) {
      return;
    }
    try {
      localStorage.setItem(CONSOLE_LOG_LEVEL_STORAGE_KEY, levelFilter);
    } catch {
      // ignore storage write errors
    }
  }, [levelFilter]);

  useEffect(() => {
    const traceEnabled = levelFilter === "trace";
    if (traceEnabledRef.current === traceEnabled) {
      return;
    }
    traceEnabledRef.current = traceEnabled;
    void window.appShell.toggleBackendTrace(traceEnabled);
  }, [levelFilter]);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const status = await window.appShell.getBackendStatus();
      if (!active) {
        return;
      }
      const cutoff = clearCutoffMsRef.current;
      const nextEntries = status.backendLogs.filter((entry) => {
        const timestamp = Date.parse(entry.timestamp);
        return Number.isFinite(timestamp) ? timestamp >= cutoff : true;
      });
      setEntries(nextEntries);
    };

    void ensureLogFlowConfigured();
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  // Subscribe to frontend log entry changes
  useEffect(() => {
    setFrontendEntries(getFrontendLogEntries());
    return subscribeConsoleNotification(() => {
      setFrontendEntries(getFrontendLogEntries());
    });
  }, []);

  const threshold = useMemo(() => LOG_LEVEL_ORDER[levelFilter], [levelFilter]);

  useEffect(() => {
    const nextLines: string[] = [];
    for (const entry of entries) {
      const key = `backend-${entry.timestamp}-${entry.level}-${entry.source}-${entry.message}`;
      if (renderedKeysRef.current.has(key)) {
        continue;
      }
      renderedKeysRef.current.add(key);
      if (LOG_LEVEL_ORDER[entry.level] < threshold) {
        continue;
      }
      const time = formatLocalIsoDateTime(entry.timestamp);
      const color = LOG_LEVEL_COLOR[entry.level];
      const line = `[${time}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`;
      nextLines.push(color ? `${color}${line}${ANSI_RESET}` : line);
    }
    for (const entry of frontendEntries) {
      const key = `frontend-${entry.timestamp}-${entry.level}-${entry.source}-${entry.message}`;
      if (renderedKeysRef.current.has(key)) {
        continue;
      }
      renderedKeysRef.current.add(key);
      if (LOG_LEVEL_ORDER[entry.level] < threshold) {
        continue;
      }
      const time = formatLocalIsoDateTime(entry.timestamp);
      const color = LOG_LEVEL_COLOR[entry.level];
      const line = `[${time}] [${entry.level.toUpperCase()}] [FRONTEND:${entry.source}] ${entry.message}`;
      nextLines.push(color ? `${color}${line}${ANSI_RESET}` : line);
    }
    if (nextLines.length > 0) {
      setDisplayedLines((previous) => [...previous, ...nextLines]);
    }
  }, [entries, frontendEntries, threshold]);

  const clearConsole = async () => {
    clearCutoffMsRef.current = Date.now();
    renderedKeysRef.current.clear();
    setEntries([]);
    setDisplayedLines([]);
    clearFrontendLogEntries();
    setFrontendEntries([]);
    await window.appShell.clearBackendLogs();
  };

  return (
    <XtermTextConsole
      lines={displayedLines}
      classNamePrefix="console-panel"
      fontSize={11}
      findButtonAtEnd={true}
      toolbarContent={(
        <>
          <label htmlFor="console-level-filter" className="console-panel-filter-label">Level</label>
          <select
            id="console-level-filter"
            className="console-panel-filter"
            value={levelFilter}
            onChange={(event) => {
              setLevelFilter(event.target.value as BackendLogLevel);
            }}
          >
            {LOG_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="console-panel-clear"
            onClick={() => {
              void clearConsole();
            }}
          >
            Clear
          </button>
        </>
      )}
    />
  );
}
