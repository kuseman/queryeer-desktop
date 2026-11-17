import { describe, expect, it } from "vitest";
import type { RegisteredJdbcManagedDriverContribution } from "@queryeer/api/queryengine/JdbcDriverExtension";
import { describeJdbcDriverApproval } from "./jdbc-driver-approval";

const mariadb: RegisteredJdbcManagedDriverContribution = {
  ownerPluginId: "com.queryeer.jdbc.mysql",
  dialectId: "mysql",
  displayName: "MariaDB Connector/J",
  groupId: "org.mariadb.jdbc",
  artifactId: "mariadb-java-client",
  driverClassName: "org.mariadb.jdbc.Driver",
  downloadPageUrl: "https://github.com/mariadb-corporation/mariadb-connector-j"
};

describe("describeJdbcDriverApproval", () => {
  it("names the plugin, the Maven coordinates, the driver class and the licence page", () => {
    const text = describeJdbcDriverApproval(mariadb);

    expect(text.message).toBe("Allow the plugin com.queryeer.jdbc.mysql to install MariaDB Connector/J?");
    expect(text.detail).toContain("org.mariadb.jdbc:mariadb-java-client");
    expect(text.detail).toContain("org.mariadb.jdbc.Driver");
    expect(text.detail).toContain("https://github.com/mariadb-corporation/mariadb-connector-j");
  });

  it("lists native companions and says when no licence page is given", () => {
    const { downloadPageUrl: _omitted, ...withoutPage } = mariadb;
    const text = describeJdbcDriverApproval({
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

    expect(text.detail).toContain("Native authentication, from the GitHub releases of example/native-driver (native.zip)");
    expect(text.detail).toContain("names no licence or download page");
  });
});
