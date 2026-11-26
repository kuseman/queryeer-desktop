import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ManagedPluginInventoryEntry } from "@queryeer/api/plugin/PluginInventory";
import { installedPluginLoads, recordPluginLoads } from "./plugin-load-history.js";

function plugin(id: string, overrides: Partial<ManagedPluginInventoryEntry> = {}): ManagedPluginInventoryEntry {
  return {
    id,
    name: id.toUpperCase(),
    version: "1.0.0",
    enabled: true,
    sourcePath: `/plugins/${id}`,
    sourceType: "folder",
    status: "available",
    hasFrontend: true,
    hasBackend: true,
    ...overrides
  };
}

describe("installedPluginLoads", () => {
  it("counts a plugin as loaded when every half it has loaded", () => {
    const loads = installedPluginLoads(
      [plugin("both"), plugin("frontend-only", { hasBackend: false }), plugin("broken"), plugin("unseen")],
      [
        { pluginId: "both", frontend: { loaded: true }, backend: { loaded: true } },
        { pluginId: "frontend-only", frontend: { loaded: true } },
        { pluginId: "broken", frontend: { loaded: false, reason: "Needs Queryeer >=0.25.0" }, backend: { loaded: true } }
      ],
      new Set()
    );

    expect(loads).toEqual([
      { pluginId: "both", name: "BOTH", loaded: true },
      { pluginId: "frontend-only", name: "FRONTEND-ONLY", loaded: true },
      { pluginId: "broken", name: "BROKEN", loaded: false, reason: "Needs Queryeer >=0.25.0" },
      { pluginId: "unseen", name: "UNSEEN", loaded: false, reason: "Its frontend didn't load; Its backend didn't load" }
    ]);
  });

  it("checks only the halves a plugin has", () => {
    expect(installedPluginLoads([plugin("backend-only", { hasFrontend: false })], [{ pluginId: "backend-only", backend: { loaded: true } }], new Set())).toEqual([
      { pluginId: "backend-only", name: "BACKEND-ONLY", loaded: true }
    ]);
  });

  it("leaves out disabled, uninstalling, missing, changed-since-start and developer-replaced plugins", () => {
    const loads = installedPluginLoads(
      [
        plugin("off", { enabled: false }),
        plugin("leaving", { uninstallPending: true }),
        plugin("gone", { status: "missing" }),
        plugin("just-installed", { restartRequired: true }),
        plugin("dev")
      ],
      [],
      new Set(["dev"])
    );

    expect(loads).toEqual([]);
  });
});

describe("recordPluginLoads", () => {
  let root: string;
  let historyPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "queryeer-load-history-"));
    historyPath = join(root, "settings", "plugin-load-history.json");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const loaded = (pluginId: string) => ({ pluginId, name: pluginId, loaded: true });
  const broken = (pluginId: string, reason = "Needs Java 26") => ({ pluginId, name: pluginId, loaded: false, reason });

  it("reports nothing while the version stays the same, and records each start", () => {
    expect(recordPluginLoads({ historyPath, appVersion: "0.24.0", loads: [loaded("a")], bundled: [] })).toBeNull();
    expect(recordPluginLoads({ historyPath, appVersion: "0.24.0", loads: [broken("a")], bundled: [] })).toBeNull();
    expect(JSON.parse(readFileSync(historyPath, "utf8"))).toEqual({ appVersion: "0.24.0", loaded: [] });
  });

  it("reports the plugins a new version broke, not those that were broken before", () => {
    recordPluginLoads({ historyPath, appVersion: "0.24.0", loads: [loaded("worked"), broken("never"), loaded("still")], bundled: [] });

    const report = recordPluginLoads({ historyPath, appVersion: "0.25.0", loads: [broken("worked"), broken("never"), loaded("still")], bundled: [] });

    expect(report).toEqual({ appVersion: "0.25.0", previousVersion: "0.24.0", plugins: [{ pluginId: "worked", name: "worked", reason: "Needs Java 26" }] });
    // Reported once: a later start of the same version doesn't repeat it
    expect(recordPluginLoads({ historyPath, appVersion: "0.25.0", loads: [broken("worked")], bundled: [] })).toBeNull();
  });

  it("reports a plugin the new version bundled that doesn't load, and bundled plugins it couldn't install", () => {
    recordPluginLoads({ historyPath, appVersion: "0.24.0", loads: [], bundled: [] });

    const report = recordPluginLoads({
      historyPath,
      appVersion: "0.25.0",
      loads: [broken("bundled", "Its backend is failed"), broken("waiting")],
      bundled: [
        { id: "bundled", version: "1.0.0", result: "installed" },
        { id: "bad", version: "2.0.0", result: "failed", reason: "bad.zip doesn't match its sha256" },
        { id: "waiting", version: "1.1.0", previousVersion: "1.0.0", result: "pending" }
      ]
    });

    expect(report?.plugins).toEqual([
      { pluginId: "bundled", name: "bundled", reason: "Its backend is failed" },
      { pluginId: "bad", reason: "Its bundled version 2.0.0 wasn't installed: bad.zip doesn't match its sha256" },
      { pluginId: "waiting", reason: "Its bundled version 1.1.0 is installed on the next start: its files were in use" }
    ]);
  });

  it("adds a failed bundled upgrade to the plugin it lists, and says when the bundle itself couldn't be read", () => {
    recordPluginLoads({ historyPath, appVersion: "0.24.0", loads: [loaded("old")], bundled: [] });

    const report = recordPluginLoads({
      historyPath,
      appVersion: "0.25.0",
      loads: [broken("old", "Needs Queryeer >=0.26.0")],
      bundled: [
        { id: "old", version: "2.0.0", previousVersion: "1.0.0", result: "failed", reason: "locked" },
        { id: "bundled-plugins.lock.json", version: "", result: "failed", reason: "Unexpected end of JSON input" }
      ]
    });

    expect(report?.plugins).toEqual([
      { pluginId: "old", name: "old", reason: "Needs Queryeer >=0.26.0. Its bundled version 2.0.0 wasn't installed: locked" },
      { pluginId: "bundled-plugins.lock.json", reason: "The bundled plugins weren't installed: Unexpected end of JSON input" }
    ]);
  });

  it("reports every plugin that doesn't load when the version before recorded nothing", () => {
    const report = recordPluginLoads({ historyPath, appVersion: "0.24.0", loads: [loaded("fine"), broken("old")], bundled: [] });

    expect(report).toEqual({ appVersion: "0.24.0", plugins: [{ pluginId: "old", name: "old", reason: "Needs Java 26" }] });
  });

  it("reports nothing when the new version broke nothing", () => {
    recordPluginLoads({ historyPath, appVersion: "0.24.0", loads: [loaded("a")], bundled: [] });

    expect(recordPluginLoads({ historyPath, appVersion: "0.25.0", loads: [loaded("a")], bundled: [{ id: "a", version: "1.0.0", result: "unchanged" }] })).toBeNull();
  });
});
