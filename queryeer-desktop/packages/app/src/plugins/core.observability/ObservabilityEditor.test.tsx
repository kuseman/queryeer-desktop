import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendGatewayStatus } from "@queryeer/api/backend";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import type { ContributionKind } from "../../core/plugin-runtime/ContributionOwnership";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { PluginDiagnostics } from "../../core/plugin-runtime/PluginDiagnostics";
import { revealInObservability, resetNavigationForTests } from "./navigation";
import { buildReport, ObservabilityEditor } from "./ObservabilityEditor";
import { setRuntimeDataSource } from "./runtime-data";
import { resetHistoryForTests } from "./use-observability-data";

void React;

function extensions(): ExtensionSnapshot {
  return {
    commands: [
      { id: "one.run", title: "Run things", handler: () => {} },
      { id: "shell.reload", title: "Reload", handler: () => {} }
    ],
    filesystems: [],
    files: [],
    menu: { items: [] },
    keybindings: [],
    layout: {
      toolbarActions: [],
      statusItems: [],
      views: [],
      editors: [],
      welcomes: [],
      tabContextMenus: [],
      tabHeaderStyles: [],
      tabTitles: [],
      panels: [],
      shellDefaults: {} as ExtensionSnapshot["layout"]["shellDefaults"]
    },
    tooltip: { sections: [] },
    settings: { contributions: [], definitions: [], advancedRendererIds: [], advancedValidatorIds: [] }
  };
}

function diagnostics(withProblem: boolean): PluginDiagnostics {
  const manifest = (id: string, name: string) => ({
    id,
    name,
    version: "1.0.0",
    kind: "core",
    modulePath: `./${id}/module`,
    dependencies: [],
    providesCapabilities: [],
    requiredCapabilities: []
  });
  return {
    discoveredManifestIds: ["plugin.one", "plugin.two"],
    activationOrder: withProblem ? ["plugin.one"] : ["plugin.one", "plugin.two"],
    providedCapabilities: [],
    pluginManifests: [manifest("plugin.one", "Plugin One"), manifest("plugin.two", "Plugin Two")],
    pluginProblems: withProblem ? [{ pluginId: "plugin.two", state: "failed", message: "activate threw: boom" }] : [],
    activationDurations: { "plugin.one": 40, "plugin.two": 5 }
  };
}

function status(extra: Partial<BackendGatewayStatus> = {}): BackendGatewayStatus {
  return {
    mode: "prod-jar",
    state: "healthy",
    serverName: "queryeer-backend",
    serverVersion: "1.0",
    supportedCapabilities: ["backend.runtimeStatus"],
    activeExecutionIds: [],
    recentExecutions: [],
    backendLogs: [],
    lastPingRttMs: 3,
    jvmMemory: { heapUsedBytes: 100 * 1024 * 1024, heapMaxBytes: 1024 * 1024 * 1024 },
    runtimeStatus: {
      startedAt: "2026-11-21T10:00:00.000Z",
      pluginStatuses: [
        { pluginId: "backend.jdbc", state: "activated", dependencies: [] },
        { pluginId: "backend.postgres", state: "activated", name: "Postgres dialect", dependencies: ["backend.jdbc"] }
      ],
      activatedPluginIds: []
    },
    ...extra
  };
}

describe("ObservabilityEditor", () => {
  const originalAppShell = window.appShell;
  let container: HTMLDivElement;
  let root: Root;

  const install = (withProblem: boolean, backendStatus: BackendGatewayStatus = status()) => {
    setRuntimeDataSource({
      getHostState: () => ({ startedAt: new Date(Date.now() - 65_000).toISOString(), loadedPluginIds: [] }),
      getDiagnostics: () => diagnostics(withProblem),
      getExtensions: extensions,
      getKeybindingDiagnostics: () => ({ invalidUserBindings: [], duplicateBindings: [] }),
      getContributionOwners: () => ({ ownerOf: (kind: ContributionKind, id: string) => (kind === "command" && id === "one.run" ? "plugin.one" : undefined) })
    });
    window.appShell = {
      ...originalAppShell,
      version: "9.9.9",
      platform: "win32",
      getBackendStatus: vi.fn(async () => backendStatus)
    } as typeof window.appShell;
  };

  let openFile: ReturnType<typeof vi.fn<(fileId: string) => void>>;

  const render = async (files: FileEntity[] = []) => {
    await act(async () => {
      root.render(<ObservabilityEditor listFiles={() => files} openFile={openFile} />);
    });
  };

  const file = (fileId: string, uri: string, engineBinding?: FileEntity["engineBinding"]): FileEntity =>
    ({
      fileId,
      uri,
      mimeType: "text/x-sql",
      version: 0,
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync",
      openedAt: new Date(0).toISOString(),
      ...(engineBinding ? { engineBinding } : {})
    }) as FileEntity;

  const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy();
    await act(async () => {
      (element as HTMLElement).click();
    });
  };

  const buttonWithText = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text));

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    openFile = vi.fn<(fileId: string) => void>();
    resetNavigationForTests();
    resetHistoryForTests();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setRuntimeDataSource(null);
    window.appShell = originalAppShell;
  });

  it("shows a healthy overview with backend and plugin stats", async () => {
    install(false);
    await render();

    expect(container.querySelector(".obs-health-banner")?.textContent).toContain("All systems healthy");
    expect(container.textContent).toContain("Queryeer 9.9.9");
    expect(container.textContent).toContain("Nothing needs attention");
    expect(container.querySelector(".obs-stats")?.textContent).toContain("100 MB");
    expect(container.querySelector(".obs-bars")?.textContent).toContain("Plugin One");
  });

  it("surfaces a failed plugin and opens its details from the attention list", async () => {
    install(true);
    await render();

    expect(container.querySelector(".obs-health-banner")?.textContent).toContain("1 problem need attention");
    await click(container.querySelector(".obs-attention-item"));

    const detail = container.querySelector(".obs-plugin-detail");
    expect(detail?.querySelector("h2")?.textContent).toBe("Plugin Two");
    expect(detail?.textContent).toContain("activate threw: boom");
    expect(localStorage.getItem("core.observability.section")).toBe("plugins");
  });

  it("lists a plugin's contributions and links contributions back to their plugin", async () => {
    install(false);
    await render();

    await click(buttonWithText("Contributions"));
    const row = [...container.querySelectorAll("tbody tr")].find((candidate) => candidate.textContent?.includes("one.run"));
    expect(row?.textContent).toContain("plugin.one");
    expect([...container.querySelectorAll("tbody tr")].find((candidate) => candidate.textContent?.includes("shell.reload"))?.textContent).toContain("shell");

    await click(row?.querySelector(".obs-link"));
    const detail = container.querySelector(".obs-plugin-detail");
    expect(detail?.querySelector("h2")?.textContent).toBe("Plugin One");
    expect(detail?.textContent).toContain("Run things");
  });

  it("filters plugins by search text and problem state", async () => {
    install(true);
    await render();
    await click(buttonWithText("Plugins"));

    const names = () => [...container.querySelectorAll(".obs-plugin-item-name")].map((element) => element.textContent);
    expect(names()).toEqual(["Plugin Two", "backend.jdbc", "Plugin One", "Postgres dialect"]);

    await click(container.querySelector('[role="radio"][aria-checked="false"]:nth-child(2)'));
    expect(names()).toEqual(["Plugin Two"]);

    await click(buttonWithText("All"));
    const input = container.querySelector<HTMLInputElement>(".obs-search input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "jdbc");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(names()).toEqual(["backend.jdbc"]);
  });

  it("shows what a backend plugin depends on and what requires it, and follows those links", async () => {
    install(false);
    revealInObservability({ section: "plugins", pluginId: "backend.postgres" });
    await render();

    const relation = (title: string) =>
      [...container.querySelectorAll(".obs-relation")].find((element) => element.querySelector(".obs-relation-title")?.textContent === title);
    expect(relation("Depends on")?.textContent).toContain("backend.jdbc");

    await click(relation("Depends on")?.querySelector(".obs-link-chip"));
    expect(container.querySelector(".obs-plugin-detail h2")?.textContent).toBe("backend.jdbc");
    expect(relation("Required by")?.textContent).toContain("backend.postgres");
  });

  it("navigates when asked to reveal a location, and opens on a pending one", async () => {
    install(true);
    revealInObservability({ section: "plugins", filter: "problems" });
    await render();

    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain("Plugins");
    expect([...container.querySelectorAll(".obs-plugin-item-name")].map((element) => element.textContent)).toEqual(["Plugin Two"]);

    await act(async () => {
      revealInObservability({ section: "backend" });
    });
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain("Backend");
    expect(container.textContent).toContain("queryeer-backend 1.0");
  });

  it("links open files to their tab and shows the bound engine", async () => {
    const unregister = getQueryEngineService().registerEngineResolver(({ fileId }) => (fileId === "f1" ? "jdbc" : undefined), { id: "test.resolver" });
    try {
      install(false);
      await render([file("f1", "C:/work/report.sql", { engineId: "jdbc", connectionId: "conn-prod" })]);
      await click(buttonWithText("Query engines"));

      const row = [...container.querySelectorAll("tbody tr")].find((candidate) => candidate.textContent?.includes("report.sql"));
      expect(row?.className).not.toContain("obs-row-warning");
      expect(row?.textContent).toContain("test.resolver");
      expect(row?.querySelectorAll("td")[4]?.textContent).toBe("jdbc");

      await click(row?.querySelector(".obs-link"));
      expect(openFile).toHaveBeenCalledWith("f1");
    } finally {
      unregister();
    }
  });

  it("highlights a file bound to an engine it would not run on, and lists it under attention", async () => {
    install(false);
    await render([file("f2", "C:/work/orphan.sql", { engineId: "jdbc" })]);

    expect(container.querySelector(".obs-attention")?.textContent).toContain("orphan.sql would not run on its bound engine");

    await click(container.querySelector(".obs-attention-item"));
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain("Query engines");
    const row = [...container.querySelectorAll("tbody tr")].find((candidate) => candidate.textContent?.includes("orphan.sql"));
    expect(row?.className).toContain("obs-row-warning");
  });

  it("shows the backend error and executions on the backend section", async () => {
    install(
      false,
      status({
        state: "unavailable",
        error: "Process exited with code 1",
        recentExecutions: [
          {
            queryExecutionId: "q1",
            engineId: "jdbc",
            state: "failed",
            chunks: 1,
            rows: 1234,
            startedAt: "2026-11-21T10:00:00.000Z",
            updatedAt: "2026-11-21T10:00:02.000Z",
            completedAt: "2026-11-21T10:00:02.000Z",
            error: "Syntax error near FROM"
          }
        ]
      })
    );
    await render();
    await click(buttonWithText("Backend"));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Process exited with code 1");
    expect(container.textContent).toContain("Syntax error near FROM");
    expect(container.textContent).toContain((1234).toLocaleString());
    expect(container.textContent).toContain("2.0 s");
  });
});

describe("buildReport", () => {
  it("summarizes plugin states and problems without backend logs", () => {
    const report = JSON.parse(
      buildReport(
        {
          hostState: { startedAt: "x", loadedPluginIds: [] },
          diagnostics: diagnostics(true),
          extensions: extensions(),
          keybindingDiagnostics: { invalidUserBindings: [], duplicateBindings: [] },
          owners: { ownerOf: () => undefined }
        },
        [{ id: "plugin.two", name: "Plugin Two", dependencies: [], requiredCapabilities: [], providedCapabilities: [], contributions: [], health: "error", frontend: { state: "failed", messages: ["boom"], activationMs: 5.4 } }],
        [{ severity: "error", title: "Plugin Two: frontend failed", section: "plugins" }],
        status({ backendLogs: [{ timestamp: "t", level: "info", source: "backend", message: "secret-ish log line" }] })
      )
    );

    expect(report.plugins).toEqual([{ id: "plugin.two", frontend: "failed", activationMs: 5, messages: ["boom"] }]);
    expect(report.attention).toEqual([{ severity: "error", title: "Plugin Two: frontend failed" }]);
    expect(JSON.stringify(report)).not.toContain("secret-ish log line");
  });
});
