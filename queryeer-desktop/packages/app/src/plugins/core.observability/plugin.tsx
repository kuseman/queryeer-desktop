import { useEffect, useState } from "react";
import type { BackendGatewayStatus } from "@queryeer/api/backend";
import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { BACKEND_STATE_TONES } from "./BackendSection";
import { StatusDot } from "./components";
import { MemoryIndicator } from "./MemoryIndicator";
import { formatDuration } from "./model";
import { revealInObservability } from "./navigation";
import { ObservabilityEditor } from "./ObservabilityEditor";
import { ObservabilityNav } from "./ObservabilityNav";
import { watchBackendPluginProblems } from "./plugin-status-notifications";

export const OBSERVABILITY_MIME_TYPE = "application/x-observability";
export const OBSERVABILITY_URI = "observability://system";
export const OBSERVABILITY_EDITOR_ID = "core.observability.editor";

let stopWatchingPluginProblems: (() => void) | undefined;

export const coreObservabilityPlugin: Plugin = {
  manifest: {
    id: "core.observability",
    name: "Core Observability",
    version: "0.1.0",
    kind: "core",
    description: "System observability: runtime diagnostics, plugin status, and backend status"
  },
  activate: (context) => {
    context.layout.registerEditor({
      id: OBSERVABILITY_EDITOR_ID,
      title: "Observability",
      order: 1,
      supportedMimeTypes: [OBSERVABILITY_MIME_TYPE],
      render: () => (
        <ObservabilityEditor
          listFiles={() => context.files.listFiles()}
          openFile={(fileId) => context.fileMediator.setActiveFileId(fileId)}
        />
      )
    });

    // The sections, in the sidebar while the Observability tab is active, so the editor keeps its whole width
    context.layout.registerView({
      id: "core.observability.navigation",
      title: "Observability",
      defaultZone: "primarySidebar",
      order: 5,
      canMoveZones: true,
      canCollapse: true,
      when: `activeFile?.mimeType == '${OBSERVABILITY_MIME_TYPE}'`,
      render: () => <ObservabilityNav listFiles={() => context.files.listFiles()} />
    });

    context.layout.registerStatusItem({
      id: "core.observability.statusItem",
      alignment: "right",
      order: 100,
      commandId: "core.observability.open",
      render: () => <BackendStatusIndicator />
    });

    context.layout.registerStatusItem({
      id: "core.observability.memoryStatusItem",
      alignment: "right",
      order: 85,
      render: () => <MemoryIndicator />
    });

    const open = async () => {
      await context.fileMediator.openFile(OBSERVABILITY_URI, {
        mimeType: OBSERVABILITY_MIME_TYPE,
        editorId: OBSERVABILITY_EDITOR_ID
      });
    };

    context.commands.registerCommand({
      id: "core.observability.open",
      title: "Open Observability",
      category: "Developer",
      handler: open
    });

    context.commands.registerCommand({
      id: "core.observability.openPluginProblems",
      title: "Show Plugin Problems",
      category: "Developer",
      handler: async () => {
        revealInObservability({ section: "plugins", filter: "problems" });
        await open();
      }
    });

    context.menu.registerMenuItem({
      id: "core.menu.tools.observability",
      label: "Observability",
      order: 25,
      parentId: "core.menu.tools",
      commandId: "core.observability.open"
    });

    context.files.capabilities.registerCapabilities(OBSERVABILITY_MIME_TYPE, ["viewable"]);
    context.files.capabilities.registerContentCategory(OBSERVABILITY_MIME_TYPE, "binary");
    context.files.capabilities.registerLabel?.(OBSERVABILITY_MIME_TYPE, "Observability");

    const appShell = typeof window !== "undefined" ? window.appShell : undefined;
    if (appShell?.getBackendStatus && appShell.onBackendStatusChanged) {
      stopWatchingPluginProblems = watchBackendPluginProblems({
        getStatus: () => appShell.getBackendStatus(),
        onStatusChanged: (listener) => appShell.onBackendStatusChanged(listener),
        notify: (notification) => context.notifications.notify(notification),
        openObservability: () => {
          context.commands.executeCommand("core.observability.openPluginProblems").catch(() => undefined);
        },
        storage: safeSessionStorage()
      });
    }
  },
  deactivate: () => {
    stopWatchingPluginProblems?.();
    stopWatchingPluginProblems = undefined;
  }
};

function safeSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function BackendStatusIndicator() {
  const [status, setStatus] = useState<BackendGatewayStatus | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const next = await window.appShell.getBackendStatus().catch((): BackendGatewayStatus | null => null);
      if (active) {
        setStatus(next);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const state = status?.state;
  const tooltip = !status
    ? "Backend status loading"
    : [
        `Backend ${status.state}`,
        status.serverName ? `${status.serverName} ${status.serverVersion ?? ""}`.trim() : undefined,
        status.lastPingRttMs !== undefined ? `Round trip ${formatDuration(status.lastPingRttMs)}` : undefined,
        status.error,
        "Click to open Observability"
      ]
        .filter(Boolean)
        .join("\n");

  return (
    <span className="obs-status-item" title={tooltip}>
      <StatusDot tone={state ? BACKEND_STATE_TONES[state] : "neutral"} pulse={state === "starting"} />
      Backend{state && state !== "healthy" ? `: ${state}` : ""}
    </span>
  );
}
