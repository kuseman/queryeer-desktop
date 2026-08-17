import { describe, expect, it, vi } from "vitest";
import type { JdbcManagedDriverContribution } from "@queryeer/api/queryengine/JdbcDriverExtension";
import { JdbcDriverRegistryHost } from "./jdbc-driver-registry";

const postgresDriver: JdbcManagedDriverContribution = {
  dialectId: "postgres",
  displayName: "PostgreSQL JDBC Driver",
  groupId: "org.postgresql",
  artifactId: "postgresql",
  driverClassName: "org.postgresql.Driver"
};

describe("JdbcDriverRegistryHost", () => {
  it("stores typed contributions with the registry owner", () => {
    const host = new JdbcDriverRegistryHost();

    host.createRegistry("plugin.postgres").registerDriver(postgresDriver);

    expect(host.listDrivers()).toEqual([{ ...postgresDriver, ownerPluginId: "plugin.postgres" }]);
    expect(host.getDriver("postgres")).toEqual({ ...postgresDriver, ownerPluginId: "plugin.postgres" });
  });

  it("preserves typed companion artifact declarations", () => {
    const host = new JdbcDriverRegistryHost();
    const companion = {
      id: "native-auth",
      displayName: "Windows Native Authentication",
      kind: "nativeLibrary" as const,
      platforms: [{ os: "windows" as const, arch: "x64" as const }],
      source: {
        type: "githubReleaseArchive" as const,
        repository: "microsoft/mssql-jdbc" as const,
        releaseTagTemplate: "v{releaseVersion}",
        assetName: "mssql-jdbc_auth.zip",
        driverVersionToReleaseVersion: { pattern: "\\.jre11$", replacement: "" },
        archiveEntryTemplate: "{arch}/mssql-jdbc_auth-{releaseVersion}.{arch}.dll"
      },
      targetDirectory: "libNative" as const,
      expectedFileExtension: ".dll" as const
    };

    host.createRegistry("plugin.sqlserver").registerDriver({ ...postgresDriver, dialectId: "sqlserver", companionArtifacts: [companion] });

    expect(host.getDriver("sqlserver")?.companionArtifacts).toEqual([companion]);
  });

  it("does not trust owner data passed at runtime", () => {
    const host = new JdbcDriverRegistryHost();
    const contribution = { ...postgresDriver, ownerPluginId: "spoofed.plugin" };

    host.createRegistry("activating.plugin").registerDriver(contribution);

    expect(host.getDriver("postgres")?.ownerPluginId).toBe("activating.plugin");
  });

  it("notifies subscribers and supports unsubscribe", () => {
    const host = new JdbcDriverRegistryHost();
    const subscriber = vi.fn();
    const unsubscribe = host.subscribe(subscriber);

    host.createRegistry("plugin.postgres").registerDriver(postgresDriver);
    unsubscribe();
    host.createRegistry("plugin.sqlite").registerDriver({
      ...postgresDriver,
      dialectId: "sqlite",
      displayName: "SQLite JDBC Driver"
    });

    expect(subscriber).toHaveBeenCalledOnce();
    expect(subscriber).toHaveBeenCalledWith([{ ...postgresDriver, ownerPluginId: "plugin.postgres" }]);
  });

  it("rejects a duplicate dialect from another plugin", () => {
    const host = new JdbcDriverRegistryHost();
    host.createRegistry("plugin.one").registerDriver(postgresDriver);

    expect(() => host.createRegistry("plugin.two").registerDriver(postgresDriver))
      .toThrow("already registered by 'plugin.one'");
  });
});
