import type { RegisteredJdbcManagedDriverContribution } from "@queryeer/api/queryengine/JdbcDriverExtension";

export type JdbcDriverApprovalText = {
  title: string;
  message: string;
  detail: string;
};

/**
 * The text of the dialog shown before core first installs a plugin's JDBC driver. It names everything core is about
 * to fetch and who asked for it, so the user can judge the download before any code reaches the shared class loader.
 */
export function describeJdbcDriverApproval(contribution: RegisteredJdbcManagedDriverContribution): JdbcDriverApprovalText {
  const lines = [
    `Plugin: ${contribution.ownerPluginId}`,
    `Driver: ${contribution.displayName} (${contribution.driverClassName})`,
    `From Maven Central: ${contribution.groupId}:${contribution.artifactId}`
      + (contribution.compatibleVersionRegex ? `, versions matching ${contribution.compatibleVersionRegex}` : "")
  ];
  for (const companion of contribution.companionArtifacts ?? []) {
    lines.push(`Native library: ${companion.displayName}, from the GitHub releases of ${companion.source.repository} (${companion.source.assetName})`);
  }
  lines.push(contribution.downloadPageUrl
    ? `Licence and downloads: ${contribution.downloadPageUrl}`
    : "The plugin names no licence or download page. Check the driver's licence before installing.");
  lines.push(
    "",
    "Queryeer checks the download's checksum and that it contains the driver class. The driver then runs inside the "
      + "Java backend with the same rights as Queryeer. It becomes active after the Java backend restarts.",
    "You are asked once per plugin, and again if the plugin changes what it downloads."
  );
  return {
    title: "Install database driver",
    message: `Allow the plugin ${contribution.ownerPluginId} to install ${contribution.displayName}?`,
    detail: lines.join("\n")
  };
}
