import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BackendLogLevel } from "@queryeer/api/backend";
import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { requestOpenPanel } from "../../renderer/shell/layout-panel-events";
import { XtermTextConsole } from "../../renderer/components/XtermTextConsole";
import {
  getConsolePanelVisible,
  getConsoleNotificationState,
  setConsolePanelVisible,
  subscribeConsoleNotification,
  getConsoleLogEntries,
  ingestBackendLogEntries,
  clearConsoleLogEntries,
} from "./console-state";
import { formatConsoleLogLines } from "./console-format";

export const CONSOLE_PANEL_TAB_ID = "core.panel.console.tab";

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

const POLL_INTERVAL_VISIBLE_MS = 1000;
const POLL_INTERVAL_HIDDEN_MS = 3000;

let pollTimer: number | undefined;
let pollInFlight = false;

/**
 * Pulls the main-process backend log buffer into the console store. Runs continuously
 * (faster while the panel is visible) so entries are captured before the main-process
 * ring buffer evicts them.
 */
async function pollBackendLogs(): Promise<void> {
  if (pollInFlight) {
    // The in-flight poll reschedules itself using the current panel visibility.
    return;
  }
  window.clearTimeout(pollTimer);
  pollInFlight = true;
  try {
    const status = await window.appShell.getBackendStatus();
    ingestBackendLogEntries(status.backendLogs);
  } catch {
    // ignore transient polling errors
  } finally {
    pollInFlight = false;
  }
  pollTimer = window.setTimeout(() => {
    void pollBackendLogs();
  }, getConsolePanelVisible() ? POLL_INTERVAL_VISIBLE_MS : POLL_INTERVAL_HIDDEN_MS);
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
      title: "Toggle Console Panel",
      handler: () => {
        requestOpenPanel({ tabId: CONSOLE_PANEL_TAB_ID, toggle: true });
      }
    });

    void pollBackendLogs();
  }
};

type ConsoleStatusSnapshot = {
  unseenCount: number;
  panelVisible: boolean;
};

function readConsoleStatusSnapshot(): ConsoleStatusSnapshot {
  return {
    unseenCount: getConsoleNotificationState().unseenErrorCount,
    panelVisible: getConsolePanelVisible()
  };
}

function ConsoleStatusItemComponent() {
  const [snapshot, setSnapshot] = useState(readConsoleStatusSnapshot);

  useEffect(() => {
    return subscribeConsoleNotification(() => {
      const next = readConsoleStatusSnapshot();
      setSnapshot((current) => (
        current.unseenCount === next.unseenCount && current.panelVisible === next.panelVisible
          ? current
          : next
      ));
    });
  }, []);

  const showBadge = !snapshot.panelVisible && snapshot.unseenCount > 0;
  return (
    <span>
      Console
      {showBadge && (
        <span className="console-status-error-badge">{snapshot.unseenCount > 99 ? "99+" : snapshot.unseenCount}</span>
      )}
    </span>
  );
}

const ConsoleStatusItem = memo(ConsoleStatusItemComponent);

function ConsolePanel() {
  useEffect(() => {
    setConsolePanelVisible(true);
    void ensureLogFlowConfigured();
    void pollBackendLogs();
    return () => {
      setConsolePanelVisible(false);
    };
  }, []);

  const traceEnabledRef = useRef<boolean | null>(null);
  const levelInitializedRef = useRef(false);
  const [levelFilter, setLevelFilter] = useState<BackendLogLevel>("info");
  const entries = useSyncExternalStore(subscribeConsoleNotification, getConsoleLogEntries);
  const displayedLines = useMemo(() => formatConsoleLogLines(entries, levelFilter), [entries, levelFilter]);

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

  const clearConsole = async () => {
    clearConsoleLogEntries();
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
