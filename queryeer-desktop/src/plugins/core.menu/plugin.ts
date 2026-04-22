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
    const registerStub = (id: string, title: string, accelerator?: string) => {
      context.commands.registerCommand({
        id,
        title,
        accelerator,
        handler: async () => {
          console.log(`${title} command executed`);
        }
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

    registerStub("core.menu.edit.undo", "Undo", "CmdOrCtrl+Z");
    registerStub("core.menu.edit.redo", "Redo", "CmdOrCtrl+Y");
    registerStub("core.menu.edit.cut", "Cut", "CmdOrCtrl+X");
    registerStub("core.menu.edit.copy", "Copy", "CmdOrCtrl+C");
    registerStub("core.menu.edit.paste", "Paste", "CmdOrCtrl+V");
    registerStub("core.menu.edit.find", "Find", "CmdOrCtrl+F");

    context.menu.registerMenuItem({
      id: "core.menu.edit.undo.item",
      label: "Undo",
      order: 10,
      parentId: "core.menu.edit",
      commandId: "core.menu.edit.undo"
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.redo.item",
      label: "Redo",
      order: 20,
      parentId: "core.menu.edit",
      commandId: "core.menu.edit.redo"
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.cut.item",
      label: "Cut",
      order: 30,
      parentId: "core.menu.edit",
      commandId: "core.menu.edit.cut"
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.copy.item",
      label: "Copy",
      order: 40,
      parentId: "core.menu.edit",
      commandId: "core.menu.edit.copy"
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.paste.item",
      label: "Paste",
      order: 50,
      parentId: "core.menu.edit",
      commandId: "core.menu.edit.paste"
    });
    context.menu.registerMenuItem({
      id: "core.menu.edit.find.item",
      label: "Find",
      order: 60,
      parentId: "core.menu.edit",
      commandId: "core.menu.edit.find"
    });

    registerStub("core.menu.selection.selectAll", "Select All", "CmdOrCtrl+A");
    context.menu.registerMenuItem({
      id: "core.menu.selection.selectAll.item",
      label: "Select All",
      order: 10,
      parentId: "core.menu.selection",
      commandId: "core.menu.selection.selectAll"
    });

    registerStub("core.menu.view.commandPalette", "Command Palette", "Ctrl+Shift+P");
    registerStub("core.menu.view.zoomIn", "Zoom In", "CmdOrCtrl+Plus");
    registerStub("core.menu.view.zoomOut", "Zoom Out", "CmdOrCtrl+-");
    registerStub("core.menu.view.zoomReset", "Reset Zoom", "CmdOrCtrl+0");

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

    registerStub("core.menu.go.quickOpen", "Go to File", "CmdOrCtrl+P");
    context.menu.registerMenuItem({
      id: "core.menu.go.quickOpen.item",
      label: "Go to File...",
      order: 10,
      parentId: "core.menu.go",
      commandId: "core.menu.go.quickOpen"
    });

    registerStub("core.menu.run.start", "Start Debugging", "F5");
    context.menu.registerMenuItem({
      id: "core.menu.run.start.item",
      label: "Start Debugging",
      order: 10,
      parentId: "core.menu.run",
      commandId: "core.menu.run.start"
    });

    registerStub("core.menu.terminal.new", "New Terminal", "Ctrl+Shift+`");
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
