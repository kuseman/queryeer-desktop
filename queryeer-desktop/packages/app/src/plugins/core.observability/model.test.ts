import { describe, expect, it } from "vitest";
import type { BackendGatewayStatus } from "@queryeer/api/backend";
import type { ContributionKind } from "../../core/plugin-runtime/ContributionOwnership";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { PluginDiagnostics } from "../../core/plugin-runtime/PluginDiagnostics";
import {
  buildPluginRows,
  collectAttention,
  collectContributions,
  formatAgo,
  formatBytes,
  formatDuration,
  hasEngineMismatch,
  matchesQuery,
  summarize
} from "./model";
import type { RuntimeData } from "./runtime-data";

function emptyExtensions(): ExtensionSnapshot {
  return {
    commands: [],
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

function makeRuntime(overrides: {
  diagnostics?: Partial<PluginDiagnostics>;
  extensions?: Partial<ExtensionSnapshot>;
  owners?: Record<string, string>;
  keybindings?: RuntimeData["keybindingDiagnostics"];
}): RuntimeData {
  return {
    hostState: { startedAt: "2026-11-21T10:00:00.000Z", loadedPluginIds: [] },
    diagnostics: {
      discoveredManifestIds: [],
      activationOrder: [],
      providedCapabilities: [],
      pluginManifests: [],
      ...overrides.diagnostics
    },
    extensions: { ...emptyExtensions(), ...overrides.extensions },
    keybindingDiagnostics: overrides.keybindings ?? { invalidUserBindings: [], duplicateBindings: [] },
    owners: { ownerOf: (kind: ContributionKind, id: string) => overrides.owners?.[`${kind}:${id}`] }
  };
}

function manifest(id: string, extra: Partial<PluginDiagnostics["pluginManifests"][number]> = {}) {
  return { id, name: `Name ${id}`, version: "1.0.0", kind: "core", modulePath: `./${id}/module`, dependencies: [], providesCapabilities: [], requiredCapabilities: [], ...extra };
}

function backend(statuses: NonNullable<BackendGatewayStatus["runtimeStatus"]>["pluginStatuses"], extra: Partial<BackendGatewayStatus> = {}): BackendGatewayStatus {
  return {
    mode: "prod-jar",
    state: "healthy",
    supportedCapabilities: [],
    activeExecutionIds: [],
    recentExecutions: [],
    backendLogs: [],
    runtimeStatus: { startedAt: "2026-11-21T10:00:00.000Z", pluginStatuses: statuses, activatedPluginIds: [] },
    ...extra
  };
}

describe("buildPluginRows", () => {
  it("merges the frontend manifest, activation and backend status of one plugin id into one row", () => {
    const runtime = makeRuntime({
      diagnostics: {
        pluginManifests: [manifest("ext.kafka", { kind: "feature", description: "Kafka" })],
        activationOrder: ["ext.kafka"],
        activationDurations: { "ext.kafka": 12.5 }
      }
    });

    const [row] = buildPluginRows(runtime, backend([{ pluginId: "ext.kafka", state: "activated" }]), []);

    expect(row).toMatchObject({
      id: "ext.kafka",
      name: "Name ext.kafka",
      kind: "feature",
      description: "Kafka",
      frontend: { state: "active", activationIndex: 1, activationMs: 12.5 },
      backend: { state: "activated" },
      health: "ok"
    });
  });

  it("lists backend-only plugins and marks failed or skipped plugins, problems first", () => {
    const runtime = makeRuntime({
      diagnostics: {
        pluginManifests: [manifest("a.ok"), manifest("b.skipped"), manifest("c.warn")],
        activationOrder: ["a.ok", "c.warn"],
        pluginProblems: [
          { pluginId: "b.skipped", state: "skipped", message: "Dependency x was skipped" },
          { pluginId: "c.warn", state: "warning", message: "Optional dependency y is missing" }
        ]
      }
    });

    const rows = buildPluginRows(runtime, backend([{ pluginId: "z.backend", state: "failed", reason: "ClassNotFound" }]), []);

    expect(rows.map((row) => [row.id, row.health])).toEqual([
      ["z.backend", "error"],
      ["b.skipped", "warning"],
      ["c.warn", "warning"],
      ["a.ok", "ok"]
    ]);
    const backendOnly = rows.find((row) => row.id === "z.backend");
    expect(backendOnly?.frontend).toBeUndefined();
    expect(backendOnly?.backend).toEqual({ state: "failed", reason: "ClassNotFound" });
    expect(rows.find((row) => row.id === "b.skipped")?.frontend).toMatchObject({ state: "skipped", messages: ["Dependency x was skipped"] });
    expect(rows.find((row) => row.id === "c.warn")?.frontend).toMatchObject({ state: "warning", messages: ["Optional dependency y is missing"] });
  });

  it("takes a backend-only plugin's identity and relations from its runtime status", () => {
    const runtime = makeRuntime({});

    const [row] = buildPluginRows(
      runtime,
      backend([
        {
          pluginId: "queryengine.jdbc.dialect.postgres",
          state: "activated",
          name: "PostgreSQL JDBC Dialect",
          version: "0.1.0",
          dependencies: ["queryengine.jdbc"],
          optionalDependencies: ["queryengine.sql.parser"],
          providesCapabilities: ["queryengine.jdbc.dialect.postgres"],
          requiredCapabilities: ["queryengine.jdbc.connection"]
        }
      ]),
      []
    );

    expect(row).toMatchObject({
      name: "PostgreSQL JDBC Dialect",
      version: "0.1.0",
      dependencies: ["queryengine.jdbc", "queryengine.sql.parser (optional)"],
      providedCapabilities: ["queryengine.jdbc.dialect.postgres"],
      requiredCapabilities: ["queryengine.jdbc.connection"]
    });
  });

  it("keeps the frontend identity of a plugin with both runtimes and merges their relations", () => {
    const runtime = makeRuntime({
      diagnostics: {
        pluginManifests: [manifest("ext.kafka", { name: "Kafka", dependencies: ["core.queryengine"], requiredCapabilities: ["query.engine"] })],
        activationOrder: ["ext.kafka"]
      }
    });

    const [row] = buildPluginRows(
      runtime,
      backend([{ pluginId: "ext.kafka", state: "activated", name: "Kafka backend", dependencies: ["queryengine.payloadbuilder"], requiredCapabilities: ["query.engine"] }]),
      []
    );

    expect(row.name).toBe("Kafka");
    expect(row.dependencies).toEqual(["core.queryengine", "queryengine.payloadbuilder"]);
    expect(row.requiredCapabilities).toEqual(["query.engine"]);
  });

  it("marks external plugins whose module failed to load as failed", () => {
    const runtime = makeRuntime({
      diagnostics: { externalLoadErrors: [{ pluginId: "ext.broken", modulePath: "/plugins/broken/index.js", message: "SyntaxError" }] }
    });

    const [row] = buildPluginRows(runtime, null, []);

    expect(row).toMatchObject({ id: "ext.broken", modulePath: "/plugins/broken/index.js", health: "error" });
    expect(row.frontend?.messages).toEqual(["Failed to load module: SyntaxError"]);
  });

  it("attaches each contribution to the plugin that registered it", () => {
    const runtime = makeRuntime({
      diagnostics: { pluginManifests: [manifest("p.one")], activationOrder: ["p.one"] },
      extensions: { commands: [{ id: "one.run", title: "Run", handler: () => {} }, { id: "shell.cmd", title: "Shell", handler: () => {} }] },
      owners: { "command:one.run": "p.one" }
    });
    const contributions = collectContributions(runtime);

    const [row] = buildPluginRows(runtime, null, contributions);

    expect(row.contributions.map((contribution) => contribution.id)).toEqual(["one.run"]);
  });
});

describe("collectContributions", () => {
  it("labels contributions and skips generated menu items and toolbar separators", () => {
    const runtime = makeRuntime({
      extensions: {
        commands: [{ id: "q.run", title: "Run", category: "Query", handler: () => {} }],
        keybindings: [{ id: "q.key", commandId: "q.run", key: "F5", when: "editorFocus" }],
        menu: {
          items: [
            { id: "menu.file", label: "File" },
            { id: "menu.recent.1", label: "a.sql", _generatedBy: "menu.recent" } as never
          ]
        },
        layout: {
          ...emptyExtensions().layout,
          toolbarActions: [{ id: "sep", type: "separator" } as never, { id: "tb.run", title: "Run", commandId: "q.run" } as never]
        }
      }
    });

    const contributions = collectContributions(runtime, [{ engineId: "jdbc", mimeTypes: ["text/x-sql"] }]);

    expect(contributions.map(({ kind, id, label, detail }) => ({ kind, id, label, detail }))).toEqual([
      { kind: "command", id: "q.run", label: "Query: Run", detail: undefined },
      { kind: "keybinding", id: "q.key", label: "F5", detail: "q.run · when editorFocus" },
      { kind: "menuItem", id: "menu.file", label: "File", detail: undefined },
      { kind: "toolbarAction", id: "tb.run", label: "Run", detail: "q.run" },
      { kind: "queryEngine", id: "jdbc", label: "jdbc", detail: "text/x-sql" }
    ]);
  });
});

describe("hasEngineMismatch", () => {
  const file = (engineBinding?: { engineId: string; connectionId?: string }) =>
    ({ fileId: "f", uri: "C:/a.sql", mimeType: "text/x-sql", ...(engineBinding ? { engineBinding } : {}) }) as never;

  it("flags only a binding that differs from the matched engine", () => {
    expect(hasEngineMismatch({ file: file(), matchedEngineId: "jdbc" })).toBe(false);
    expect(hasEngineMismatch({ file: file({ engineId: "jdbc", connectionId: "c" }), matchedEngineId: "jdbc" })).toBe(false);
    expect(hasEngineMismatch({ file: file({ engineId: "jdbc" }), matchedEngineId: "payloadbuilder" })).toBe(true);
    expect(hasEngineMismatch({ file: file({ engineId: "jdbc" }) })).toBe(true);
  });

  it("adds a mismatch to the attention list, naming the resolver", () => {
    const runtime = makeRuntime({});
    const items = collectAttention(runtime, [], null, [
      { file: file({ engineId: "jdbc" }), matchedEngineId: "payloadbuilder", matchedByResolver: "queryengine.payloadbuilder.mime" }
    ]);
    expect(items).toEqual([
      {
        severity: "warning",
        title: "a.sql would not run on its bound engine",
        detail: "Bound to jdbc, matched payloadbuilder (by queryengine.payloadbuilder.mime)",
        section: "engines"
      }
    ]);
  });
});

describe("collectAttention", () => {
  it("orders errors before warnings before info, and links each to its section", () => {
    const runtime = makeRuntime({
      diagnostics: {
        pluginManifests: [manifest("p.skipped")],
        pluginProblems: [{ pluginId: "p.skipped", state: "skipped", message: "Missing dependency" }]
      },
      keybindings: {
        invalidUserBindings: [],
        duplicateBindings: [{ key: "F5", winnerCommandId: "a", shadowedCommandId: "b" }]
      }
    });
    const status = backend([{ pluginId: "b.failed", state: "failed", reason: "boom" }], { state: "unavailable", error: "Process exited" });
    const rows = buildPluginRows(runtime, status, []);

    const items = collectAttention(runtime, rows, status);

    expect(items.map(({ severity, title, section, pluginId }) => ({ severity, title, section, pluginId }))).toEqual([
      { severity: "error", title: "Backend is unavailable", section: "backend", pluginId: undefined },
      { severity: "error", title: "b.failed: backend failed", section: "plugins", pluginId: "b.failed" },
      { severity: "warning", title: "Name p.skipped: frontend skipped", section: "plugins", pluginId: "p.skipped" },
      { severity: "info", title: "1 keybinding conflict resolved", section: "contributions", pluginId: undefined }
    ]);
  });

  it("is empty when everything is healthy", () => {
    const runtime = makeRuntime({ diagnostics: { pluginManifests: [manifest("p")], activationOrder: ["p"] } });
    const status = backend([{ pluginId: "b", state: "activated" }]);
    expect(collectAttention(runtime, buildPluginRows(runtime, status, []), status)).toEqual([]);
  });
});

describe("summarize", () => {
  it("counts active plugins per runtime and problems", () => {
    const runtime = makeRuntime({
      diagnostics: {
        pluginManifests: [manifest("a"), manifest("b")],
        activationOrder: ["a"],
        pluginProblems: [{ pluginId: "b", state: "failed", message: "x" }]
      }
    });
    const rows = buildPluginRows(runtime, backend([{ pluginId: "c", state: "loaded" }]), []);
    expect(summarize(rows)).toEqual({ total: 3, frontendActive: 1, backendActive: 1, errors: 1, warnings: 0 });
  });
});

describe("formatting", () => {
  it("matches every term case-insensitively across fields", () => {
    expect(matchesQuery("", "anything")).toBe(true);
    expect(matchesQuery("KAF core", "core.kafka", undefined)).toBe(true);
    expect(matchesQuery("kafka mongo", "core.kafka")).toBe(false);
  });

  it("formats bytes, durations and elapsed time", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
    expect(formatDuration(0.4)).toBe("<1 ms");
    expect(formatDuration(42.4)).toBe("42 ms");
    expect(formatDuration(2500)).toBe("2.5 s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(3 * 3_600_000 + 60_000)).toBe("3h 1m");
    expect(formatAgo("2026-11-21T10:00:00.000Z", Date.parse("2026-11-21T10:00:05.000Z"))).toBe("5.0 s ago");
    expect(formatAgo(undefined, 0)).toBeUndefined();
    expect(formatAgo("not a date", 0)).toBeUndefined();
  });
});
