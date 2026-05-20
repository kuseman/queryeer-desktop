import type { NotificationService } from "../../contracts/extensions/NotificationExtension";

export const RELEASES_URL = "https://api.github.com/repos/kuseman/queryeer-desktop/releases";
export const RELEASES_PAGE_URL = "https://github.com/kuseman/queryeer-desktop/releases/";

type GithubRelease = {
  tag_name?: string;
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
  html_url?: string;
};

export type CheckForUpdatesOptions = {
  currentVersion: string;
  fetchReleases: () => Promise<{ ok: boolean; releases: unknown }>;
  notifications: NotificationService;
  openExternal: (url: string) => Promise<void>;
};

export async function checkForUpdates(options: CheckForUpdatesOptions): Promise<void> {
  const response = await options.fetchReleases();
  if (!response.ok) {
    return;
  }
  const payload = response.releases;
  if (!Array.isArray(payload)) {
    return;
  }

  const latest = payload.find(isStableRelease);
  if (!latest?.tag_name || compareVersions(latest.tag_name, options.currentVersion) <= 0) {
    return;
  }

  const latestVersion = normalizeVersionLabel(latest.tag_name);
  const releaseUrl = latest.html_url ?? RELEASES_PAGE_URL;
  options.notifications.notify({
    title: "New Queryeer version available",
    message: `Version ${latestVersion} is available. You are running ${options.currentVersion}.`,
    severity: "info",
    actions: [
      {
        id: "core.notification.openReleases",
        label: "Open releases",
        run: () => options.openExternal(releaseUrl)
      }
    ]
  });
}

function isStableRelease(value: unknown): value is GithubRelease {
  if (!value || typeof value !== "object") {
    return false;
  }
  const release = value as GithubRelease;
  return release.draft !== true && release.prerelease !== true && typeof release.tag_name === "string";
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const leftPart = leftParts[i] ?? 0;
    const rightPart = rightParts[i] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

function parseVersion(version: string): number[] {
  const normalized = normalizeVersionLabel(version).split(/[+-]/)[0];
  return normalized.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

function normalizeVersionLabel(version: string): string {
  return version.trim().replace(/^v/i, "");
}
