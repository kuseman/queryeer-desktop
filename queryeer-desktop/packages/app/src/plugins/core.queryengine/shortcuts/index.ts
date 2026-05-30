import React from "react";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { ShortcutsSettingsRenderer } from "./ShortcutsSettingsRenderer";
import { getShortcutsService, SHORTCUTS_SETTING_ID } from "./ShortcutsService";

void React;

export function registerShortcuts(context: Pick<PluginContext, "commands" | "keybindings" | "settings">): void {
  context.settings.registerSettings({
    moduleId: "core.queryengine",
    title: "Query Engine",
    order: 20,
    settings: [
      {
        id: SHORTCUTS_SETTING_ID,
        moduleId: "core.queryengine",
        title: "Query Shortcuts",
        description: "Configurable query shortcuts. Each slot holds ordered rules; the first matching rule's query is executed.",
        sectionPath: ["Query Engine", "Text Editor", "Shortcuts"],
        type: "json",
        defaultValue: { shortcuts: [] },
        advanced: { rendererId: "core.queryengine.shortcuts.renderer" }
      }
    ]
  });

  context.settings.registerAdvancedRenderer({
    id: "core.queryengine.shortcuts.renderer",
    render: (props) => React.createElement(ShortcutsSettingsRenderer, props)
  });

  for (let slot = 0; slot <= 9; slot++) {
    const capturedSlot = slot;

    context.commands.registerCommand({
      id: `core.queryengine.shortcut.${slot}`,
      title: `Execute Query Shortcut ${slot}`,
      category: "Query",
      enablement: "backendHealthy && hasActiveQueryExecutableFile && hasActiveTextEditor",
      handler: () => {
        getShortcutsService().executeShortcut(capturedSlot);
      }
    });

    context.keybindings.registerKeybinding({
      id: `core.queryengine.keybinding.shortcut.${slot}`,
      commandId: `core.queryengine.shortcut.${slot}`,
      key: `CmdOrCtrl+${slot}`,
      when: "global",
      scope: "global",
      order: 600
    });
  }
}
