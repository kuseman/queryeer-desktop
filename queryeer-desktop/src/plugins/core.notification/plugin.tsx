import type { Plugin } from "../../contracts/plugin/Plugin";
import { getCoreSettingsService } from "../core.settings/service";
import { NotificationStatusItem } from "./NotificationStatusItem";
import { checkForUpdates } from "./update-checker";

const TOASTS_ENABLED_SETTING_ID = "core.notification.toasts.enabled";
const UPDATE_CHECK_ENABLED_SETTING_ID = "core.notification.updateCheck.enabled";

export const coreNotificationPlugin: Plugin = {
  manifest: {
    id: "core.notification",
    name: "Core Notification",
    version: "0.1.0",
    kind: "core",
    dependencies: ["core.layout", "core.settings"],
    providesCapabilities: ["notification"],
    description: "Notification center, toast delivery, and status bar unread indicator"
  },
  activate: (context) => {
    context.settings.registerSettings({
      moduleId: "core.notification",
      title: "Notifications",
      order: 40,
      settings: [
        {
          id: TOASTS_ENABLED_SETTING_ID,
          moduleId: "core.notification",
          title: "Show Toast Notifications",
          description: "Show transient notification toasts in the bottom-right corner.",
          sectionPath: ["Notifications", "Display"],
          tags: ["toast", "notifications"],
          type: "boolean",
          defaultValue: true
        },
        {
          id: UPDATE_CHECK_ENABLED_SETTING_ID,
          moduleId: "core.notification",
          title: "Check For Updates",
          description: "Check GitHub releases for a newer Queryeer version when the app starts.",
          sectionPath: ["Notifications", "Updates"],
          tags: ["updates", "github", "release"],
          type: "boolean",
          defaultValue: true
        }
      ]
    });

    context.commands.registerCommand({
      id: "core.notification.clearAll",
      title: "Clear Notifications",
      category: "Notifications",
      handler: () => context.notifications.clearAll()
    });

    context.layout.registerStatusItem({
      id: "core.notification.status",
      alignment: "right",
      order: 100000,
      render: () => <NotificationStatusItem />
    });

    const settings = getCoreSettingsService();
    settings?.refreshSchemaFromRegistry();
    void settings?.syncRegistryModules();
    if (settings?.getValue(UPDATE_CHECK_ENABLED_SETTING_ID) === false) {
      return;
    }

    void (async () => {
      try {
        const metadata = await window.appShell.getAboutMetadata();
        await checkForUpdates({
          currentVersion: metadata.appVersion,
          fetchReleases: () => window.appShell.fetchQueryeerReleases(),
          notifications: context.notifications,
          openExternal: (url) => window.appShell.openExternal(url)
        });
      } catch {
        // Update checks are best effort and should not affect startup.
      }
    })();
  }
};
