import type { Plugin } from "../../contracts/plugin/Plugin";

export const coreMenuPlugin: Plugin = {
  manifest: {
    id: "core.menu",
    name: "Core Menu",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["menu"],
    description: "Handles native menu bar and menu item registration"
  },
  activate: (context) => {
    const registerShortcut = (id: string, commandId: string, key: string, order: number) => {
      context.keybindings.registerKeybinding({
        id,
        commandId,
        key,
        when: "global",
        scope: "global",
        order
      });
    };

    context.menu.registerMenuItem({ id: "core.menu.file", label: "File", order: 10 });
    context.menu.registerMenuItem({ id: "core.menu.edit", label: "Edit", order: 20 });
    context.menu.registerMenuItem({ id: "core.menu.selection", label: "Selection", order: 30 });
    context.menu.registerMenuItem({ id: "core.menu.view", label: "View", order: 40 });
    context.menu.registerMenuItem({ id: "core.menu.tools", label: "Tools", order: 75 });
    context.menu.registerMenuItem({ id: "core.menu.tools.dev", parentId: "core.menu.tools", label: "Dev", order: 10 });
    context.menu.registerMenuItem({ id: "core.menu.window", label: "Window", order: 78 });
    context.menu.registerMenuItem({ id: "core.menu.help", label: "Help", order: 80 });

    context.menu.registerMenuItem({
      id: "core.menu.edit.undo.item",
      label: "Undo",
      order: 10,
      parentId: "core.menu.edit",
      commandId: "core.edit.undo",
      role: "undo",
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.redo.item",
      label: "Redo",
      order: 20,
      parentId: "core.menu.edit",
      commandId: "core.edit.redo",
      role: "redo",
    });

    context.menu.registerMenuItem({
      id: "core.menu.edit.cut.item",
      label: "Cut",
      order: 30,
      parentId: "core.menu.edit",
      commandId: "core.edit.cut",
      role: "cut",
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.copy.item",
      label: "Copy",
      order: 40,
      parentId: "core.menu.edit",
      commandId: "core.edit.copy",
      role: "copy",
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.paste.item",
      label: "Paste",
      order: 50,
      parentId: "core.menu.edit",
      commandId: "core.edit.paste",
      role: "paste",
    });

    context.menu.registerMenuItem({
      id: "core.menu.selection.selectAll.item",
      label: "Select All",
      order: 10,
      parentId: "core.menu.selection",
      commandId: "core.edit.selectAll",
      role: "selectAll",
    });

    context.commands.registerCommand({
      id: "core.commands.reloadWindow",
      title: "Reload Window",
      handler: async () => {
        await window.appShell.reloadWindow();
      }
    });
    context.commands.registerCommand({
      id: "core.commands.forceReloadWindow",
      title: "Force Reload Window",
      handler: async () => {
        await window.appShell.forceReloadWindow();
      }
    });
    context.commands.registerCommand({
      id: "core.commands.toggleFullScreen",
      title: "Toggle Full Screen",
      handler: async () => {
        await window.appShell.toggleFullScreen();
      }
    });
    context.commands.registerCommand({
      id: "core.commands.zoomIn",
      title: "Zoom In",
      handler: async () => {
        await window.appShell.zoomIn();
      }
    });
    context.commands.registerCommand({
      id: "core.commands.zoomOut",
      title: "Zoom Out",
      handler: async () => {
        await window.appShell.zoomOut();
      }
    });
    context.commands.registerCommand({
      id: "core.commands.zoomReset",
      title: "Reset Zoom",
      handler: async () => {
        await window.appShell.zoomReset();
      }
    });

    context.menu.registerMenuItem({
      id: "core.menu.tools.dev.reload",
      label: "Reload",
      order: 16,
      parentId: "core.menu.tools.dev",
      commandId: "core.commands.reloadWindow",
      role: "reload",
    });
    context.menu.registerMenuItem({
      id: "core.menu.tools.dev.forceReload",
      label: "Force Reload",
      order: 17,
      parentId: "core.menu.tools.dev",
      commandId: "core.commands.forceReloadWindow",
      role: "forceReload",
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance",
      label: "Appearance",
      order: 20,
      parentId: "core.menu.view"
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance.zoomIn",
      label: "Zoom In",
      order: 10,
      parentId: "core.menu.view.appearance",
      commandId: "core.commands.zoomIn",
      role: "zoomIn",
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance.zoomOut",
      label: "Zoom Out",
      order: 20,
      parentId: "core.menu.view.appearance",
      commandId: "core.commands.zoomOut",
      role: "zoomOut",
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance.zoomReset",
      label: "Reset Zoom",
      order: 30,
      parentId: "core.menu.view.appearance",
      commandId: "core.commands.zoomReset",
      role: "resetZoom",
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance.toggleFullScreen",
      label: "Toggle Full Screen",
      order: 40,
      parentId: "core.menu.view.appearance",
      commandId: "core.commands.toggleFullScreen",
      role: "togglefullscreen"
    });

    context.commands.registerCommand({
      id: "core.commands.toggleDevTools",
      title: "Toggle Developer Tools",
      handler: async () => {
        await window.appShell.toggleDevTools();
      }
    });
    context.commands.registerCommand({
      id: "core.commands.windowMinimize",
      title: "Minimize Window",
      handler: async () => {
        window.appShell.windowMinimize();
      }
    });
    context.commands.registerCommand({
      id: "core.commands.windowZoom",
      title: "Zoom Window",
      handler: async () => {
        window.appShell.windowMaximize();
      }
    });
    context.commands.registerCommand({
      id: "core.commands.windowClose",
      title: "Close Window",
      handler: async () => {
        window.appShell.windowClose();
      }
    });
    registerShortcut(
      "core.commands.toggleDevTools.shortcut",
      "core.commands.toggleDevTools",
      "F12",
      900
    );

    context.menu.registerMenuItem({
      id: "core.menu.tools.toggleDevTools",
      label: "Toggle Developer Tools",
      order: 10,
      parentId: "core.menu.tools.dev",
      commandId: "core.commands.toggleDevTools",
      role: "toggleDevTools",
    });

    context.menu.registerMenuItem({
      id: "core.menu.window.minimize",
      label: "Minimize",
      order: 10,
      parentId: "core.menu.window",
      commandId: "core.commands.windowMinimize",
      role: "minimize",
    });
    context.menu.registerMenuItem({
      id: "core.menu.window.zoom",
      label: "Zoom",
      order: 20,
      parentId: "core.menu.window",
      commandId: "core.commands.windowZoom",
      role: "zoom"
    });
    context.menu.registerMenuItem({
      id: "core.menu.window.separator1",
      type: "separator",
      order: 30,
      parentId: "core.menu.window"
    });
    context.menu.registerMenuItem({
      id: "core.menu.window.close",
      label: "Close Window",
      order: 40,
      parentId: "core.menu.window",
      commandId: "core.commands.windowClose",
    });

    context.menu.registerMenuItem({
      id: "core.menu.file.closeActive",
      label: "Close",
      order: 15,
      parentId: "core.menu.file",
      commandId: "core.closeActive",
    });
  }
};
