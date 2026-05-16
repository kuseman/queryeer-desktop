import type { Plugin } from "../../contracts/plugin/Plugin.js";
import { openAboutDialog, setAppMetadata, setDesktopChangelog, setBackendChangelogs } from "./about-service.js";

export const coreAboutPlugin: Plugin = {
  manifest: {
    id: "core.about",
    name: "Core About",
    version: "0.1.0",
    kind: "core",
    description: "About dialog with version info and changelogs"
  },
  activate: (context) => {
    context.commands.registerCommand({
      id: "core.commands.about",
      title: "About Queryeer",
      category: "Help",
      handler: async () => {
        const meta = await window.appShell.getAboutMetadata();
        setAppMetadata(meta);

        const desktopChangelog = await window.appShell.getDesktopChangelog();
        setDesktopChangelog(desktopChangelog);

        const status = await window.appShell.getBackendStatus();
        if (status.state === "healthy") {
          try {
            const result = await window.appShell.fetchBackendPluginChangelogs();
            setBackendChangelogs(result.plugins);
          } catch {
            // backend changelogs unavailable; dialog still opens
          }
        }

        openAboutDialog();
      }
    });

    context.menu.registerMenuItem({
      id: "core.menu.help.about.item",
      label: "About Queryeer",
      order: 10,
      parentId: "core.menu.help",
      commandId: "core.commands.about"
    });
  }
};
