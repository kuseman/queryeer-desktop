import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rename } from "node:fs/promises";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredJdbcManagedDriverContribution } from "@queryeer/api/queryengine/JdbcDriverExtension.js";
import {
  defaultJdbcDriverInventoryPath,
  JdbcDriverArtifactService
} from "./jdbc-driver-artifact-service.js";

const postgres: RegisteredJdbcManagedDriverContribution = {
  ownerPluginId: "core.queryengine.jdbc.postgres",
  dialectId: "postgres",
  displayName: "PostgreSQL JDBC Driver",
  groupId: "org.postgresql",
  artifactId: "postgresql",
  driverClassName: "org.postgresql.Driver"
};

const sqlServer: RegisteredJdbcManagedDriverContribution = {
  ownerPluginId: "core.queryengine.jdbc.sqlserver",
  dialectId: "sqlserver",
  displayName: "Microsoft JDBC Driver for SQL Server",
  groupId: "com.microsoft.sqlserver",
  artifactId: "mssql-jdbc",
  driverClassName: "com.microsoft.sqlserver.jdbc.SQLServerDriver",
  compatibleVersionRegex: "\\.jre11$"
};

let workDir: string;
let appDir: string;
let settingsDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "queryeer-jdbc-drivers-"));
  appDir = join(workDir, "app");
  settingsDir = join(workDir, "settings");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function driverJar(className: string, version?: string): Promise<Buffer> {
  const archive = new JSZip();
  archive.file(`${className.replaceAll(".", "/")}.class`, Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
  if (version) archive.file("META-INF/MANIFEST.MF", `Manifest-Version: 1.0\r\nImplementation-Version: ${version}\r\n`);
  return archive.generateAsync({ type: "nodebuffer" });
}

async function nativeArchive(entry = "x64/mssql-jdbc_auth-13.4.0.x64.dll"): Promise<Buffer> {
  const archive = new JSZip();
  archive.file(entry, Buffer.from([0x4d, 0x5a, 0x01, 0x02]));
  return archive.generateAsync({ type: "nodebuffer" });
}

function sqlServerFetch(
  zip: Buffer,
  jar: Buffer,
  digest = createHash("sha256").update(zip).digest("hex"),
  driverVersion = "13.4.0.jre11",
  releaseVersion = "13.4.0"
): typeof fetch {
  const jarDigest = createHash("sha256").update(jar).digest("hex");
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("maven-metadata.xml")) {
      return new Response(`<metadata><versioning><versions><version>${driverVersion}</version></versions></versioning></metadata>`);
    }
    if (url.endsWith(".jar.sha256")) return new Response(jarDigest);
    if (url.endsWith(".jar")) return new Response(Uint8Array.from(jar));
    if (url === `https://api.github.com/repos/microsoft/mssql-jdbc/releases/tags/v${releaseVersion}`) {
      return Response.json({ assets: [{
        name: "mssql-jdbc_auth.zip",
        browser_download_url: `https://github.com/microsoft/mssql-jdbc/releases/download/v${releaseVersion}/mssql-jdbc_auth.zip`,
        digest: `sha256:${digest}`
      }] });
    }
    if (url.endsWith("/mssql-jdbc_auth.zip")) return new Response(Uint8Array.from(zip));
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

function mavenFetch(versions: string[], jar: Buffer, checksum = createHash("sha256").update(jar).digest("hex")): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("maven-metadata.xml")) {
      return new Response(`<metadata><versioning><versions>${versions.map((version) => `<version>${version}</version>`).join("")}</versions></versioning></metadata>`);
    }
    if (url.endsWith(".jar.sha256")) return new Response(checksum);
    if (url.endsWith(".jar")) return new Response(Uint8Array.from(jar), { headers: { "content-length": String(jar.length) } });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

describe("JdbcDriverArtifactService", () => {
  it("selects the numerically latest compatible non-SNAPSHOT version", async () => {
    const jar = await driverJar(sqlServer.driverClassName);
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: mavenFetch([
        "12.9.0.jre11",
        "12.10.0.jre8",
        "12.10.0.jre11",
        "13.0.0-rc1.jre11",
        "13.0.0.jre11-SNAPSHOT"
      ], jar),
      now: () => new Date("2026-08-15T12:00:00.000Z")
    });
    await service.initialize();

    const [status] = await service.check([sqlServer]);

    expect(status.latestVersion).toBe("12.10.0.jre11");
    expect(status.lastCheckedAt).toBe("2026-08-15T12:00:00.000Z");
    expect(JSON.parse(readFileSync(defaultJdbcDriverInventoryPath(settingsDir), "utf8")).drivers[0].latestVersion)
      .toBe("12.10.0.jre11");
    expect(readdirSync(settingsDir).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("lists but rejects automatic management for an unsupported contribution", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const service = new JdbcDriverArtifactService({ appDir, settingsDir, fetch: fetchMock });
    await service.initialize();
    const external = { ...postgres, ownerPluginId: "external.postgres" };

    expect((await service.list([external]))[0].managementAvailable).toBe(false);
    const result = await service.install(external);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("not available");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the main-owned compatibility policy for trusted contributions", async () => {
    const jar = await driverJar(postgres.driverClassName);
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: mavenFetch(["42.6.0", "42.7.7"], jar)
    });
    await service.initialize();

    const [status] = await service.check([{ ...postgres, compatibleVersionRegex: "^42\\.6\\." }]);

    expect(status.latestVersion).toBe("42.7.7");
    expect(status.contribution.compatibleVersionRegex).toBeUndefined();
  });

  it("cleans staging and rejects a checksum mismatch", async () => {
    const jar = await driverJar(postgres.driverClassName);
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: mavenFetch(["42.7.7"], jar, "0".repeat(64))
    });
    await service.initialize();

    const result = await service.install(postgres);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("checksum mismatch");
    expect(readdirSync(join(appDir, "libShared", ".jdbc-staging"))).toEqual([]);
    expect(readdirSync(join(appDir, "libShared")).filter((name) => name.endsWith(".jar"))).toEqual([]);
  });

  it("falls back to Maven SHA-1 when a SHA-256 sidecar is unavailable", async () => {
    const jar = await driverJar(postgres.driverClassName);
    const sha1 = createHash("sha1").update(jar).digest("hex");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("maven-metadata.xml")) {
        return new Response("<metadata><versioning><versions><version>42.7.7</version></versions></versioning></metadata>");
      }
      if (url.endsWith(".jar.sha256")) return new Response(null, { status: 404 });
      if (url.endsWith(".jar.sha1")) return new Response(sha1);
      if (url.endsWith(".jar")) return new Response(Uint8Array.from(jar));
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const service = new JdbcDriverArtifactService({ appDir, settingsDir, fetch: fetchMock });
    await service.initialize();

    const result = await service.install(postgres);

    expect(result.accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\.jar\.sha1$/), expect.anything());
  });

  it("stages a verified install and applies it without touching other jars", async () => {
    const jar = await driverJar(postgres.driverClassName, "42.7.7");
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: mavenFetch(["42.7.7"], jar)
    });
    await service.initialize();
    const manualPath = join(appDir, "libShared", "unrelated.jar");
    writeFileSync(manualPath, "manual");

    const result = await service.install(postgres);

    expect(result).toMatchObject({
      accepted: true,
      status: { source: "managed", installedVersion: "42.7.7", restartRequired: true, pendingOperation: "install" }
    });
    expect(readdirSync(join(appDir, "libShared")).filter((name) => name.startsWith("000-"))).toEqual([]);

    await service.applyPending();

    const managed = readdirSync(join(appDir, "libShared")).filter((name) => name.startsWith("000-"));
    expect(managed).toEqual(["000-queryeer-managed-postgresql-42.7.7.jar"]);
    expect(existsSync(manualPath)).toBe(true);
    expect((await service.list([postgres]))[0]).toMatchObject({
      source: "managed",
      installedVersion: "42.7.7",
      restartRequired: false
    });
  });

  it("detects a top-level manual driver and reads its manifest version", async () => {
    const service = new JdbcDriverArtifactService({ appDir, settingsDir, fetch: vi.fn() as unknown as typeof fetch });
    await service.initialize();
    writeFileSync(join(appDir, "libShared", "custom-driver.jar"), await driverJar(postgres.driverClassName, "42.6.2"));

    const [status] = await service.list([postgres]);

    expect(status).toMatchObject({ source: "manual", installedVersion: "42.6.2", managementAvailable: true });
  });

  it("recovers when a staged jar was promoted before inventory was committed", async () => {
    const jar = await driverJar(postgres.driverClassName, "42.7.7");
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: mavenFetch(["42.7.7"], jar)
    });
    await service.initialize();
    await service.install(postgres);
    const inventoryPath = defaultJdbcDriverInventoryPath(settingsDir);
    const pending = JSON.parse(readFileSync(inventoryPath, "utf8")).drivers[0].pending;
    renameSync(pending.stagedFile, pending.finalFile);

    const restarted = new JdbcDriverArtifactService({ appDir, settingsDir, fetch: vi.fn() as unknown as typeof fetch });
    await restarted.initialize();

    expect((await restarted.list([postgres]))[0]).toMatchObject({
      source: "managed",
      installedVersion: "42.7.7",
      restartRequired: false
    });
  });

  it("stages, applies, detects, and removes only the managed SQL Server native library", async () => {
    const zip = await nativeArchive();
    const jar = await driverJar(sqlServer.driverClassName, "13.4.0.jre11");
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: sqlServerFetch(zip, jar),
      platform: "win32",
      arch: "x64"
    });
    await service.initialize();
    const manual = join(appDir, "libNative", "mssql-jdbc_auth-12.6.0.x64.dll");
    writeFileSync(manual, Buffer.from([0x4d, 0x5a]));

    const manualStatus = (await service.check([sqlServer]))[0].artifacts?.find((artifact) => artifact.id === "native-auth");
    expect(manualStatus).toMatchObject({ applicable: true, source: "manual", installedVersion: "12.6.0", latestVersion: "13.4.0", updateAvailable: true });

    const install = await service.install(sqlServer, "native-auth");
    expect(install.accepted).toBe(true);
    expect(install.status.artifacts?.find((artifact) => artifact.id === "native-auth"))
      .toMatchObject({ source: "managed", installedVersion: "13.4.0", restartRequired: true, pendingOperation: "install" });
    const pendingInventory = JSON.parse(readFileSync(defaultJdbcDriverInventoryPath(settingsDir), "utf8")).drivers[0];
    expect(pendingInventory.pending).toMatchObject({ version: "13.4.0.jre11", bundleId: expect.any(String) });
    expect(pendingInventory.companions[0].pending).toMatchObject({
      version: "13.4.0",
      bundleId: pendingInventory.pending.bundleId
    });
    expect(readdirSync(join(appDir, "libShared", ".jdbc-staging"))).toHaveLength(2);
    const stale = join(appDir, "libNative", "mssql-jdbc_auth-11.2.0.x64.queryeer-managed.dll");
    writeFileSync(stale, Buffer.from([0x4d, 0x5a]));
    // Simulate a crash after one bundle member was promoted but before inventory was committed.
    renameSync(pendingInventory.pending.stagedFile, pendingInventory.pending.finalFile);
    await service.applyPending();
    expect(readdirSync(join(appDir, "libShared"))).toContain("000-queryeer-managed-mssql-jdbc-13.4.0.jre11.jar");
    expect(readdirSync(join(appDir, "libNative"))).toContain("mssql-jdbc_auth-13.4.0.x64.queryeer-managed.dll");
    expect(readFileSync(join(appDir, "libNative", "mssql-jdbc_auth-13.4.0.x64.queryeer-managed.dll")).subarray(0, 2))
      .toEqual(Buffer.from([0x4d, 0x5a]));
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(manual)).toBe(false);
    expect((await service.list([sqlServer]))[0].disabledSets).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifacts: [expect.objectContaining({ fileName: "mssql-jdbc_auth-12.6.0.x64.dll" })] })
    ]));

    writeFileSync(stale, Buffer.from([0x4d, 0x5a]));
    const restarted = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await restarted.initialize();
    expect(existsSync(stale)).toBe(false);

    expect((await restarted.remove(sqlServer, "native-auth")).accepted).toBe(true);
    await restarted.applyPending();
    expect(existsSync(manual)).toBe(false);
    const disabledManual = JSON.parse(readFileSync(defaultJdbcDriverInventoryPath(settingsDir), "utf8")).disabledSets
      .flatMap((set: { artifacts: Array<{ originalFile: string; disabledFile: string }> }) => set.artifacts)
      .find((artifact: { originalFile: string }) => artifact.originalFile === manual);
    expect(existsSync(disabledManual.disabledFile)).toBe(true);
    expect(readdirSync(join(appDir, "libShared")).filter((name) => name.startsWith("000-queryeer-managed-mssql"))).toEqual([]);
    expect(readdirSync(join(appDir, "libNative")).filter((name) => name.includes("queryeer-managed"))).toEqual([]);
  });

  it("keeps one manual SQL Server pair active and can restore a disabled version", async () => {
    const provision = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await provision.initialize();
    const oldJarPath = join(appDir, "libShared", "mssql-jdbc-12.6.0.jre11.jar");
    const newJarPath = join(appDir, "libShared", "mssql-jdbc-13.4.0.jre11.jar");
    const oldNativePath = join(appDir, "libNative", "mssql-jdbc_auth-12.6.0.x64.dll");
    const newNativePath = join(appDir, "libNative", "mssql-jdbc_auth-13.4.0.x64.dll");
    writeFileSync(oldJarPath, await driverJar(sqlServer.driverClassName, "12.6.0.jre11"));
    writeFileSync(newJarPath, await driverJar(sqlServer.driverClassName, "13.4.0.jre11"));
    writeFileSync(oldNativePath, Buffer.from([0x4d, 0x5a, 0x12]));
    writeFileSync(newNativePath, Buffer.from([0x4d, 0x5a, 0x13]));

    const service = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await service.initialize();

    expect(existsSync(newJarPath)).toBe(true);
    expect(existsSync(newNativePath)).toBe(true);
    expect(existsSync(oldJarPath)).toBe(false);
    expect(existsSync(oldNativePath)).toBe(false);
    let status = (await service.list([sqlServer]))[0];
    expect(status).toMatchObject({ source: "manual", installedVersion: "13.4.0.jre11" });
    expect(status.disabledSets).toEqual([expect.objectContaining({
      version: "12.6.0",
      restorable: true,
      artifacts: expect.arrayContaining([
        expect.objectContaining({ fileName: "mssql-jdbc-12.6.0.jre11.jar" }),
        expect.objectContaining({ fileName: "mssql-jdbc_auth-12.6.0.x64.dll" })
      ])
    })]);

    const disabledSetId = status.disabledSets![0].id;
    expect((await service.restore(sqlServer, disabledSetId)).accepted).toBe(true);
    expect((await service.list([sqlServer]))[0].restartRequired).toBe(true);
    await service.applyPending();

    expect(existsSync(oldJarPath)).toBe(true);
    expect(existsSync(oldNativePath)).toBe(true);
    expect(existsSync(newJarPath)).toBe(false);
    expect(existsSync(newNativePath)).toBe(false);
    status = (await service.list([sqlServer]))[0];
    expect(status).toMatchObject({ source: "manual", installedVersion: "12.6.0.jre11", restartRequired: false });
    expect(status.disabledSets).toEqual([expect.objectContaining({ version: "13.4.0", restorable: true })]);

    expect((await service.restore(sqlServer, status.disabledSets![0].id)).accepted).toBe(true);
    await service.applyPending();
    status = (await service.list([sqlServer]))[0];
    expect(status).toMatchObject({ source: "manual", installedVersion: "13.4.0.jre11", restartRequired: false });
    expect(status.disabledSets).toEqual([expect.objectContaining({ version: "12.6.0", restorable: true })]);
  });

  it("finishes a journaled restore after a crash between bundle moves", async () => {
    const provision = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await provision.initialize();
    const oldJarPath = join(appDir, "libShared", "mssql-jdbc-12.6.0.jre11.jar");
    const newJarPath = join(appDir, "libShared", "mssql-jdbc-13.4.0.jre11.jar");
    const oldNativePath = join(appDir, "libNative", "mssql-jdbc_auth-12.6.0.x64.dll");
    const newNativePath = join(appDir, "libNative", "mssql-jdbc_auth-13.4.0.x64.dll");
    writeFileSync(oldJarPath, await driverJar(sqlServer.driverClassName, "12.6.0.jre11"));
    writeFileSync(newJarPath, await driverJar(sqlServer.driverClassName, "13.4.0.jre11"));
    writeFileSync(oldNativePath, Buffer.from([0x4d, 0x5a, 0x12]));
    writeFileSync(newNativePath, Buffer.from([0x4d, 0x5a, 0x13]));
    const service = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await service.initialize();
    const oldSetId = (await service.list([sqlServer]))[0].disabledSets![0].id;
    await service.restore(sqlServer, oldSetId);

    const inventoryPath = defaultJdbcDriverInventoryPath(settingsDir);
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    const oldSet = inventory.disabledSets.find((set: { id: string }) => set.id === oldSetId);
    const displacedId = "sqlserver-crash-displaced";
    const disabledJar = join(appDir, "libShared", "disabled", "sqlserver", displacedId, "mssql-jdbc-13.4.0.jre11.jar");
    const disabledNative = join(appDir, "libNative", "disabled", "sqlserver", displacedId, "mssql-jdbc_auth-13.4.0.x64.dll");
    mkdirSync(join(appDir, "libShared", "disabled", "sqlserver", displacedId), { recursive: true });
    mkdirSync(join(appDir, "libNative", "disabled", "sqlserver", displacedId), { recursive: true });
    const displaced = {
      id: displacedId,
      ownerPluginId: sqlServer.ownerPluginId,
      dialectId: sqlServer.dialectId,
      version: "13.4.0",
      disabledAt: "2026-08-16T10:00:00.000Z",
      reason: "Restore move journal",
      pendingDisable: true,
      artifacts: [{
        artifactId: sqlServer.artifactId,
        kind: "driver",
        source: "manual",
        version: "13.4.0.jre11",
        sha256: createHash("sha256").update(readFileSync(newJarPath)).digest("hex"),
        originalFile: newJarPath,
        disabledFile: disabledJar
      }, {
        artifactId: "native-auth",
        kind: "nativeLibrary",
        source: "manual",
        version: "13.4.0",
        sha256: createHash("sha256").update(readFileSync(newNativePath)).digest("hex"),
        originalFile: newNativePath,
        disabledFile: disabledNative
      }]
    };
    oldSet.restoreDisplacedSetIds = [displacedId];
    inventory.disabledSets.push(displaced);
    writeFileSync(inventoryPath, `${JSON.stringify(inventory)}\n`);
    renameSync(newJarPath, disabledJar);

    const restarted = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await restarted.initialize();

    expect(existsSync(oldJarPath)).toBe(true);
    expect(existsSync(oldNativePath)).toBe(true);
    expect(existsSync(newJarPath)).toBe(false);
    expect(existsSync(newNativePath)).toBe(false);
    expect(existsSync(disabledJar)).toBe(true);
    expect(existsSync(disabledNative)).toBe(true);
    const status = (await restarted.list([sqlServer]))[0];
    expect(status).toMatchObject({ source: "manual", installedVersion: "12.6.0.jre11", restartRequired: false });
    expect(status.disabledSets).toEqual([expect.objectContaining({ id: displacedId, version: "13.4.0", pendingRestore: false })]);
  });

  it("fails closed when multiple manual provider jars have unknown versions", async () => {
    const provision = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await provision.initialize();
    writeFileSync(join(appDir, "libShared", "sqlserver-a.jar"), await driverJar(sqlServer.driverClassName));
    writeFileSync(join(appDir, "libShared", "sqlserver-b.jar"), await driverJar(sqlServer.driverClassName));

    const service = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await service.initialize();

    expect(readdirSync(join(appDir, "libShared")).filter((name) => name.endsWith(".jar"))).toEqual([]);
    const status = (await service.list([sqlServer]))[0];
    expect(status.source).toBe("missing");
    expect(status.disabledSets).toHaveLength(2);
    expect(status.disabledSets?.every((set) => set.reason.includes("could not be resolved safely"))).toBe(true);
  });

  it("moves retained files to the Recycle Bin and records partial failures", async () => {
    const provision = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await provision.initialize();
    const oldJarPath = join(appDir, "libShared", "mssql-jdbc-12.6.0.jre11.jar");
    const newJarPath = join(appDir, "libShared", "mssql-jdbc-13.4.0.jre11.jar");
    const oldNativePath = join(appDir, "libNative", "mssql-jdbc_auth-12.6.0.x64.dll");
    const newNativePath = join(appDir, "libNative", "mssql-jdbc_auth-13.4.0.x64.dll");
    writeFileSync(oldJarPath, await driverJar(sqlServer.driverClassName, "12.6.0.jre11"));
    writeFileSync(newJarPath, await driverJar(sqlServer.driverClassName, "13.4.0.jre11"));
    writeFileSync(oldNativePath, Buffer.from([0x4d, 0x5a, 0x12]));
    writeFileSync(newNativePath, Buffer.from([0x4d, 0x5a, 0x13]));
    let failNative = true;
    const trashed: string[] = [];
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      platform: "win32",
      arch: "x64",
      trashArtifact: async (path) => {
        if (path.endsWith(".dll") && failNative) throw new Error("simulated Recycle Bin failure");
        trashed.push(path);
        rmSync(path);
      }
    });
    await service.initialize();
    let status = (await service.list([sqlServer]))[0];
    const disabledSetId = status.disabledSets![0].id;

    const failed = await service.discardRetainedSet(sqlServer, disabledSetId);

    expect(failed).toMatchObject({ accepted: false, reason: expect.stringContaining("simulated Recycle Bin failure") });
    expect(trashed).toHaveLength(1);
    expect(existsSync(newJarPath)).toBe(true);
    expect(existsSync(newNativePath)).toBe(true);
    status = (await service.list([sqlServer]))[0];
    expect(status.disabledSets).toEqual([expect.objectContaining({
      id: disabledSetId,
      restorable: false,
      artifacts: [expect.objectContaining({ fileName: "mssql-jdbc_auth-12.6.0.x64.dll" })]
    })]);

    failNative = false;
    expect((await service.discardRetainedSet(sqlServer, disabledSetId)).accepted).toBe(true);
    status = (await service.list([sqlServer]))[0];
    expect(status.disabledSets).toBeUndefined();
    expect(existsSync(newJarPath)).toBe(true);
    expect(existsSync(newNativePath)).toBe(true);
  });

  it("rolls back a partially promoted version-locked bundle", async () => {
    const zip = await nativeArchive();
    const jar = await driverJar(sqlServer.driverClassName, "13.4.0.jre11");
    let failNativePromotion = true;
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: sqlServerFetch(zip, jar),
      platform: "win32",
      arch: "x64",
      moveArtifact: async (source, target) => {
        const sourcePath = String(source);
        if (failNativePromotion && sourcePath.endsWith(".dll") && sourcePath.includes(".jdbc-staging")) {
          failNativePromotion = false;
          throw new Error("simulated native promotion failure");
        }
        await rename(source, target);
      }
    });
    await service.initialize();
    await service.install(sqlServer);
    const inventory = JSON.parse(readFileSync(defaultJdbcDriverInventoryPath(settingsDir), "utf8")).drivers[0];
    // Simulate a crash after the first member was promoted, then fail the next restart attempt.
    renameSync(inventory.pending.stagedFile, inventory.pending.finalFile);

    await expect(service.applyPending()).rejects.toThrow("simulated native promotion failure");

    expect(readdirSync(join(appDir, "libShared")).filter((name) => name.startsWith("000-queryeer-managed-mssql"))).toEqual([]);
    expect(readdirSync(join(appDir, "libNative")).filter((name) => name.includes("queryeer-managed"))).toEqual([]);
    expect(readdirSync(join(appDir, "libShared", ".jdbc-staging"))).toHaveLength(2);
    const pending = JSON.parse(readFileSync(defaultJdbcDriverInventoryPath(settingsDir), "utf8")).drivers[0];
    expect(pending.pending.operation).toBe("install");
    expect(pending.companions[0].pending.operation).toBe("install");

    await service.applyPending();
    expect(readdirSync(join(appDir, "libShared"))).toContain("000-queryeer-managed-mssql-jdbc-13.4.0.jre11.jar");
    expect(readdirSync(join(appDir, "libNative"))).toContain("mssql-jdbc_auth-13.4.0.x64.queryeer-managed.dll");
  });

  it("rolls back a partially removed version-locked bundle", async () => {
    const zip = await nativeArchive();
    const jar = await driverJar(sqlServer.driverClassName, "13.4.0.jre11");
    let failNativeRemoval = false;
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: sqlServerFetch(zip, jar),
      platform: "win32",
      arch: "x64",
      moveArtifact: async (source, target) => {
        if (failNativeRemoval && String(source).endsWith(".queryeer-managed.dll")) {
          failNativeRemoval = false;
          throw new Error("simulated native removal failure");
        }
        await rename(source, target);
      }
    });
    await service.initialize();
    await service.install(sqlServer);
    await service.applyPending();
    await service.remove(sqlServer);
    failNativeRemoval = true;

    await expect(service.applyPending()).rejects.toThrow("simulated native removal failure");

    expect(readdirSync(join(appDir, "libShared"))).toContain("000-queryeer-managed-mssql-jdbc-13.4.0.jre11.jar");
    expect(readdirSync(join(appDir, "libNative"))).toContain("mssql-jdbc_auth-13.4.0.x64.queryeer-managed.dll");
    const pending = JSON.parse(readFileSync(defaultJdbcDriverInventoryPath(settingsDir), "utf8")).drivers[0];
    expect(pending.pending.operation).toBe("remove");
    expect(pending.companions[0].pending.operation).toBe("remove");

    await service.applyPending();
    expect(readdirSync(join(appDir, "libShared")).filter((name) => name.startsWith("000-queryeer-managed-mssql"))).toEqual([]);
    expect(readdirSync(join(appDir, "libNative")).filter((name) => name.includes("queryeer-managed"))).toEqual([]);
  });

  it("restores the previous bundle when quarantining an old update member fails", async () => {
    const oldZip = await nativeArchive();
    const oldJar = await driverJar(sqlServer.driverClassName, "13.4.0.jre11");
    const installed = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: sqlServerFetch(oldZip, oldJar),
      platform: "win32",
      arch: "x64"
    });
    await installed.initialize();
    await installed.install(sqlServer);
    await installed.applyPending();

    const newZip = await nativeArchive("x64/mssql-jdbc_auth-13.5.0.x64.dll");
    const newJar = await driverJar(sqlServer.driverClassName, "13.5.0.jre11");
    let failOldNativeQuarantine = true;
    const updating = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: sqlServerFetch(newZip, newJar, undefined, "13.5.0.jre11", "13.5.0"),
      platform: "win32",
      arch: "x64",
      moveArtifact: async (source, target) => {
        const sourcePath = String(source);
        if (failOldNativeQuarantine && sourcePath.includes("13.4.0") && sourcePath.endsWith(".queryeer-managed.dll")) {
          failOldNativeQuarantine = false;
          throw new Error("simulated old native quarantine failure");
        }
        await rename(source, target);
      }
    });
    await updating.initialize();
    expect((await updating.update(sqlServer)).accepted).toBe(true);

    await expect(updating.applyPending()).rejects.toThrow("simulated old native quarantine failure");

    expect(readdirSync(join(appDir, "libShared")).filter((name) => name.startsWith("000-queryeer-managed-mssql")))
      .toEqual(["000-queryeer-managed-mssql-jdbc-13.4.0.jre11.jar"]);
    expect(readdirSync(join(appDir, "libNative")).filter((name) => name.includes("queryeer-managed")))
      .toEqual(["mssql-jdbc_auth-13.4.0.x64.queryeer-managed.dll"]);

    await updating.applyPending();
    expect(readdirSync(join(appDir, "libShared")).filter((name) => name.startsWith("000-queryeer-managed-mssql")))
      .toEqual(["000-queryeer-managed-mssql-jdbc-13.5.0.jre11.jar"]);
    expect(readdirSync(join(appDir, "libNative")).filter((name) => name.includes("queryeer-managed")))
      .toEqual(["mssql-jdbc_auth-13.5.0.x64.queryeer-managed.dll"]);
  });

  it("rejects a wrong GitHub digest and a missing exact native archive entry", async () => {
    const zip = await nativeArchive();
    const jar = await driverJar(sqlServer.driverClassName, "13.4.0.jre11");
    const wrongDigestService = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: sqlServerFetch(zip, jar, "0".repeat(64)),
      platform: "win32",
      arch: "x64"
    });
    await wrongDigestService.initialize();
    expect((await wrongDigestService.install(sqlServer, "native-auth")).reason).toContain("checksum mismatch");
    expect(readdirSync(join(appDir, "libShared", ".jdbc-staging"))).toEqual([]);
    expect(JSON.parse(readFileSync(defaultJdbcDriverInventoryPath(settingsDir), "utf8")).drivers[0].pending).toBeUndefined();

    const otherAppDir = join(workDir, "other-app");
    const missingEntryZip = await nativeArchive("x64/not-the-auth-library.dll");
    const missingEntryService = new JdbcDriverArtifactService({
      appDir: otherAppDir,
      settingsDir: join(workDir, "other-settings"),
      fetch: sqlServerFetch(missingEntryZip, jar),
      platform: "win32",
      arch: "x64"
    });
    await missingEntryService.initialize();
    expect((await missingEntryService.install(sqlServer, "native-auth")).reason).toContain("archive entry");
  });

  it("flags a missing or mismatched version-locked native companion", async () => {
    const zip = await nativeArchive();
    const jar = await driverJar(sqlServer.driverClassName, "13.4.0.jre11");
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: sqlServerFetch(zip, jar),
      platform: "win32",
      arch: "x64"
    });
    await service.initialize();
    await service.install(sqlServer);
    await service.applyPending();
    const inventory = JSON.parse(readFileSync(defaultJdbcDriverInventoryPath(settingsDir), "utf8"));
    rmSync(inventory.drivers[0].companions[0].managedFile);

    let status = (await service.list([sqlServer]))[0];
    expect(status).toMatchObject({ versionMismatch: true });
    expect(status.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mssql-jdbc", managedWithPrimary: true, versionMismatch: true }),
      expect.objectContaining({ id: "native-auth", managedWithPrimary: true, versionMismatch: true, source: "missing" })
    ]));

    writeFileSync(inventory.drivers[0].companions[0].managedFile, Buffer.from([0x4d, 0x5a]));
    inventory.drivers[0].companions[0].installedVersion = "12.6.0";
    writeFileSync(defaultJdbcDriverInventoryPath(settingsDir), `${JSON.stringify(inventory)}\n`);
    const reloaded = new JdbcDriverArtifactService({ appDir, settingsDir, platform: "win32", arch: "x64" });
    await reloaded.initialize();
    status = (await reloaded.list([sqlServer]))[0];
    expect(status.artifacts?.find((artifact) => artifact.id === "native-auth"))
      .toMatchObject({ source: "missing", versionMismatch: true });
    expect(status.disabledSets).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifacts: [expect.objectContaining({ artifactId: "native-auth", source: "managed" })] })
    ]));
  });

  it("marks the Windows native companion non-applicable on other platforms", async () => {
    const service = new JdbcDriverArtifactService({
      appDir,
      settingsDir,
      fetch: vi.fn() as unknown as typeof fetch,
      platform: "linux",
      arch: "x64"
    });
    await service.initialize();

    const native = (await service.list([sqlServer]))[0].artifacts?.find((artifact) => artifact.id === "native-auth");

    expect(native).toMatchObject({ applicable: false, managementAvailable: false, source: "missing" });
  });
});
