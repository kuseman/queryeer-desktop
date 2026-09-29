import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BackendGateway } from "./backend-gateway.js";
import { ProdBackendTransport } from "./backend-transport-prod.js";

const INTEGRATION_STARTUP_TIMEOUT = 30_000;
const releaseResources = resolve(import.meta.dirname, "../../../dist/release-resources");
const builtinPluginsDir = join(releaseResources, "plugins", "builtin");

describe("Packaged backend", () => {
  let gateway: BackendGateway;
  let settingsDirPath: string;
  const previousResourcesDir = process.env.QUERYEER_RESOURCES_DIR;

  beforeAll(async () => {
    settingsDirPath = mkdtempSync(join(tmpdir(), "queryeer-packaged-backend-"));
    process.env.QUERYEER_RESOURCES_DIR = releaseResources;
    gateway = new BackendGateway({
      mode: "prod-jar",
      create: (callbacks) => new ProdBackendTransport(callbacks, { settingsDirPath })
    });
    await gateway.start();
  }, INTEGRATION_STARTUP_TIMEOUT);

  afterAll(async () => {
    if (gateway) {
      await gateway.stop();
    }
    rmSync(settingsDirPath, { recursive: true, force: true });
    if (previousResourcesDir === undefined) {
      delete process.env.QUERYEER_RESOURCES_DIR;
    } else {
      process.env.QUERYEER_RESOURCES_DIR = previousResourcesDir;
    }
  });

  it("starts with every bundled plugin activated", () => {
    const expectedPluginIds = readdirSync(builtinPluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const manifest = JSON.parse(
          readFileSync(join(builtinPluginsDir, entry.name, "plugin.json"), "utf8")
        ) as { id: string };
        return manifest.id;
      })
      .sort();
    const status = gateway.getStatus();
    const pluginStatuses = status.runtimeStatus?.pluginStatuses ?? [];

    if (status.state !== "healthy" || pluginStatuses.some((plugin) => plugin.state !== "activated")) {
      console.log("Backend logs:", status.backendLogs.slice(-30));
    }

    expect(status.state).toBe("healthy");
    expect(pluginStatuses.map((plugin) => plugin.pluginId).sort()).toEqual(expectedPluginIds);
    expect(pluginStatuses).toEqual(
      expect.arrayContaining(
        expectedPluginIds.map((pluginId) => expect.objectContaining({ pluginId, state: "activated" }))
      )
    );
    expect([...status.runtimeStatus!.activatedPluginIds].sort()).toEqual(expectedPluginIds);
  });

});
