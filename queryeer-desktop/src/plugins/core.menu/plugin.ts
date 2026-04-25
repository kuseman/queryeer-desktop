import type { Plugin } from "../../contracts/plugin/Plugin";

export const coreMenuPlugin: Plugin = {
  manifest: {
    id: "core.menu",
    name: "Core Menu",
    version: "0.1.0",
    kind: "core",
    description: "Handles native menu bar and menu item registration"
  },
  activate: (context) => {
    const registerStub = (id: string, title: string) => {
      context.commands.registerCommand({
        id,
        title,
        handler: async () => {
          console.log(`${title} command executed`);
        }
      });
    };

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
    context.menu.registerMenuItem({ id: "core.menu.go", label: "Go", order: 50 });
    context.menu.registerMenuItem({ id: "core.menu.run", label: "Run", order: 60 });
    context.menu.registerMenuItem({ id: "core.menu.terminal", label: "Terminal", order: 70 });
    context.menu.registerMenuItem({ id: "core.menu.help", label: "Help", order: 80 });

    context.menu.registerMenuItem({
      id: "core.menu.edit.undo.item",
      label: "Undo",
      order: 10,
      parentId: "core.menu.edit",
      role: "undo",
      accelerator: "CmdOrCtrl+Z"
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.redo.item",
      label: "Redo",
      order: 20,
      parentId: "core.menu.edit",
      role: "redo",
      accelerator: "CmdOrCtrl+Y"
    });

    context.menu.registerMenuItem({
      id: "core.menu.edit.cut.item",
      label: "Cut",
      order: 30,
      parentId: "core.menu.edit",
      role: "cut",
      accelerator: "CmdOrCtrl+X"
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.copy.item",
      label: "Copy",
      order: 40,
      parentId: "core.menu.edit",
      role: "copy",
      accelerator: "CmdOrCtrl+C"
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.paste.item",
      label: "Paste",
      order: 50,
      parentId: "core.menu.edit",
      role: "paste",
      accelerator: "CmdOrCtrl+V"
    });

    context.menu.registerMenuItem({
      id: "core.menu.selection.selectAll.item",
      label: "Select All",
      order: 10,
      parentId: "core.menu.selection",
      role: "selectAll",
      accelerator: "CmdOrCtrl+A"
    });

    registerStub("core.menu.view.commandPalette", "Command Palette");
    registerShortcut(
      "core.menu.view.commandPalette.shortcut",
      "core.menu.view.commandPalette",
      "CmdOrCtrl+Shift+P",
      410
    );
    registerStub("core.menu.view.zoomIn", "Zoom In");
    registerShortcut("core.menu.view.zoomIn.shortcut", "core.menu.view.zoomIn", "CmdOrCtrl+Plus", 420);
    registerStub("core.menu.view.zoomOut", "Zoom Out");
    registerShortcut("core.menu.view.zoomOut.shortcut", "core.menu.view.zoomOut", "CmdOrCtrl+-", 430);
    registerStub("core.menu.view.zoomReset", "Reset Zoom");
    registerShortcut("core.menu.view.zoomReset.shortcut", "core.menu.view.zoomReset", "CmdOrCtrl+0", 440);

    context.menu.registerMenuItem({
      id: "core.menu.view.commandPalette.item",
      label: "Command Palette",
      order: 10,
      parentId: "core.menu.view",
      commandId: "core.menu.view.commandPalette"
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance",
      label: "Appearance",
      order: 20,
      parentId: "core.menu.view"
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance.zoom",
      label: "Zoom",
      order: 10,
      parentId: "core.menu.view.appearance"
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance.zoom.in",
      label: "Zoom In",
      order: 10,
      parentId: "core.menu.view.appearance.zoom",
      commandId: "core.menu.view.zoomIn"
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance.zoom.out",
      label: "Zoom Out",
      order: 20,
      parentId: "core.menu.view.appearance.zoom",
      commandId: "core.menu.view.zoomOut"
    });
    context.menu.registerMenuItem({
      id: "core.menu.view.appearance.zoom.reset",
      label: "Reset Zoom",
      order: 30,
      parentId: "core.menu.view.appearance.zoom",
      commandId: "core.menu.view.zoomReset"
    });

    registerStub("core.menu.go.quickOpen", "Go to File");
    registerShortcut("core.menu.go.quickOpen.shortcut", "core.menu.go.quickOpen", "CmdOrCtrl+P", 510);
    context.menu.registerMenuItem({
      id: "core.menu.go.quickOpen.item",
      label: "Go to File...",
      order: 10,
      parentId: "core.menu.go",
      commandId: "core.menu.go.quickOpen"
    });

    registerStub("core.menu.run.start", "Start Debugging");
    registerShortcut("core.menu.run.start.shortcut", "core.menu.run.start", "F5", 610);
    context.menu.registerMenuItem({
      id: "core.menu.run.start.item",
      label: "Start Debugging",
      order: 10,
      parentId: "core.menu.run",
      commandId: "core.menu.run.start"
    });

    registerStub("core.menu.terminal.new", "New Terminal");
    registerShortcut(
      "core.menu.terminal.new.shortcut",
      "core.menu.terminal.new",
      "CmdOrCtrl+Shift+`",
      710
    );
    context.menu.registerMenuItem({
      id: "core.menu.terminal.new.item",
      label: "New Terminal",
      order: 10,
      parentId: "core.menu.terminal",
      commandId: "core.menu.terminal.new"
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
