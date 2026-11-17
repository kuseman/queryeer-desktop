import { describe, expect, it, vi } from "vitest";
import type { RegisteredJdbcManagedDriverContribution } from "@queryeer/api/queryengine/JdbcDriverExtension.js";
import { confirmJdbcDriverInstall, describeJdbcDriverInstall } from "./jdbc-driver-install-confirmation.js";

const mariadb: RegisteredJdbcManagedDriverContribution = {
  ownerPluginId: "queryeer.jdbc.mysql",
  dialectId: "mysql",
  displayName: "MariaDB Connector/J",
  groupId: "org.mariadb.jdbc",
  artifactId: "mariadb-java-client",
  driverClassName: "org.mariadb.jdbc.Driver",
  downloadPageUrl: "https://mariadb.com/downloads/connectors/"
};

describe("JDBC driver install confirmation", () => {
  it("names the plugin, the Maven coordinates and the licence page, and defaults to Cancel", () => {
    const options = describeJdbcDriverInstall(mariadb);

    expect(options.message).toContain("queryeer.jdbc.mysql");
    expect(options.detail).toContain("org.mariadb.jdbc:mariadb-java-client");
    expect(options.detail).toContain("org.mariadb.jdbc.Driver");
    expect(options.detail).toContain("https://mariadb.com/downloads/connectors/");
    expect(options.buttons).toEqual(["Install", "Cancel"]);
    expect(options.defaultId).toBe(1);
    expect(options.cancelId).toBe(1);
  });

  it("lists native companions and says when no licence page is given", () => {
    const { downloadPageUrl: _omitted, ...withoutPage } = mariadb;
    const options = describeJdbcDriverInstall({
      ...withoutPage,
      companionArtifacts: [{
        id: "native",
        displayName: "Native authentication",
        kind: "nativeLibrary",
        platforms: [{ os: "windows", arch: "x64" }],
        source: {
          type: "githubReleaseArchive",
          repository: "example/native-driver",
          releaseTagTemplate: "v{releaseVersion}",
          assetName: "native.zip",
          driverVersionToReleaseVersion: { pattern: "^(.*)$", replacement: "$1" },
          archiveEntryTemplate: "{arch}/native-{releaseVersion}.dll"
        },
        targetDirectory: "libNative",
        expectedFileExtension: ".dll"
      }]
    });

    expect(options.detail).toContain("Native authentication, from the GitHub releases of example/native-driver (native.zip)");
    expect(options.detail).toContain("names no licence or download page");
  });

  it("confirms only on the Install button", async () => {
    const install = vi.fn(async () => ({ response: 0, checkboxChecked: false }));
    const cancel = vi.fn(async () => ({ response: 1, checkboxChecked: false }));

    expect(await confirmJdbcDriverInstall(mariadb, install)).toBe(true);
    expect(await confirmJdbcDriverInstall(mariadb, cancel)).toBe(false);
  });
});
