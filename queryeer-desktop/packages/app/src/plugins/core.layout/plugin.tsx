import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { confirmCloseDirtyFile } from "../../renderer/shell/close-file-guard";
import { requestToggleZone } from "../../renderer/shell/layout-zone-events";
import { fileUriToPath } from "@queryeer/api/files/Resolvers";
import { getCoreSettingsService } from "../core.settings/service";
import { closeAboutDialog, isAboutDialogOpen } from "../core.about/about-service";
import { getQuickCommandService } from "../core.quickcommand/service";
import { resolveActiveMessageDialog } from "../core.dialog/message-dialog-service";
import { resolveActiveInputDialog } from "../core.dialog/input-dialog-service";

export const coreLayoutPlugin: Plugin = {
  manifest: {
    id: "core.layout",
    name: "Core Layout",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["layout.panels"],
    description: "Registers baseline panel layout capabilities"
  },
  activate: (context) => {
    context.commands.registerCommand({
      id: "core.layout.openEditor",
      title: "Open Editor",
      handler: async () => {
        console.log("Editor open command executed");
      }
    });

    context.commands.registerCommand({
      id: "core.closeActive",
      title: "Close Active",
      handler: async () => {
        // Close the topmost open overlay/dialog
        getQuickCommandService()?.close();
        if (getCoreSettingsService()?.isModalOpen()) {
          getCoreSettingsService()?.closeModal();
          return;
        }
        if (isAboutDialogOpen()) {
          closeAboutDialog();
          return;
        }
        if (context.dialog.closeActiveValuePreview?.()) {
          return;
        }
        resolveActiveMessageDialog({ action: "" });
        resolveActiveInputDialog({ canceled: true, value: undefined });

        const activeFileId = context.fileMediator.getActiveFileId();
        if (!activeFileId) {
          return;
        }
        const file = context.files.getFile(activeFileId);
        if (!file) {
          return;
        }

        const isDirty = file.dirtyVsDisk || file.dirtyVsBackend;
        if (isDirty) {
          const shouldClose = await confirmCloseDirtyFile(file, (options) =>
            context.dialog.showMessage(options)
          );
          if (!shouldClose) {
            return;
          }
        }

        await context.fileMediator.closeFile(activeFileId, { discardDirty: true });
      }
    });

    context.commands.registerCommand({
      id: "core.layout.closeEditor",
      title: "Close Editor",
      handler: async () => {
        await context.commands.executeCommand("core.closeActive");
      }
    });

    context.commands.registerCommand({
      id: "core.layout.togglePrimarySidebar",
      title: "Toggle Primary Sidebar",
      handler: async () => {
        requestToggleZone("primarySidebar");
      }
    });

    context.commands.registerCommand({
      id: "core.layout.toggleSecondarySidebar",
      title: "Toggle Secondary Sidebar",
      handler: async () => {
        requestToggleZone("secondarySidebar");
      }
    });

    context.commands.registerCommand({
      id: "core.layout.togglePanel",
      title: "Toggle Panel",
      handler: async () => {
        requestToggleZone("panel");
      }
    });

    context.keybindings.registerKeybinding({
      id: "core.layout.keybinding.closeActive",
      commandId: "core.closeActive",
      key: "CmdOrCtrl+W",
      when: "global",
      scope: "global",
      order: 850
    });

    context.keybindings.registerKeybinding({
      id: "core.layout.keybinding.togglePrimarySidebar",
      commandId: "core.layout.togglePrimarySidebar",
      key: "CtrlOrCmd+B",
      when: "global",
      scope: "global",
      order: 100
    });

    context.layout.setShellDefaults({
      visibleZones: [
        "menuBar",
        "toolBar",
        "statusBar",
        "primarySidebar",
        "mainArea",
        "panel"
      ],
      sidebarWidths: {
        primary: 280,
        secondary: 320
      },
      statusBarHeight: 24
    });

    context.layout.registerToolbarAction({
      id: "core.layout.toolbar.togglePrimarySidebar",
      order: 0,
      alignment: "west",
      commandId: "core.layout.togglePrimarySidebar",
      icon: "sidebar-primary"
    });

    context.layout.registerToolbarAction({
      id: "core.layout.toolbar.separator.sidebar",
      type: "separator",
      order: 10,
      alignment: "west"
    });

    context.layout.registerToolbarAction({
      id: "core.layout.toolbar.toggleSecondarySidebar",
      order: 30,
      alignment: "east",
      commandId: "core.layout.toggleSecondarySidebar",
      icon: "sidebar-secondary"
    });

    context.layout.registerToolbarAction({
      id: "core.layout.toolbar.togglePanel",
      order: 50,
      alignment: "east",
      commandId: "core.layout.togglePanel",
      icon: "panel"
    });

    context.layout.registerWelcome({
      id: "core.layout.welcome",
      order: 10,
      render: () => (
        <div className="panel-card">
          <h3>Workspace ready</h3>
          <p>
            Shell zones are active: menu, toolbar, status bar, sidebars, and main area.
          </p>
        </div>
      )
    });

    context.layout.registerTabContextMenu({
      id: "core.layout.tabContextMenu.default",
      order: 10,
      actions: [
        { id: "core.layout.tab.close", label: "Close", order: 10 },
        { id: "core.layout.tab.closeOthers", label: "Close Others", order: 20 },
        { id: "core.layout.tab.closeAll", label: "Close All", order: 30 },
        { id: "core.layout.tab.copyPath", label: "Copy Path", order: 40, enabledWhen: "uri.startsWith('file://')" },
        { id: "core.layout.tab.openInExplorer", label: "Open in System Explorer", order: 50, enabledWhen: "uri.startsWith('file://')" }
      ]
    });

    context.layout.registerTabTitle({
      id: "core.layout.tabTitle.dirty",
      order: 10,
      render: ({ file }) => {
        const isDirty = file.dirtyVsDisk || file.dirtyVsBackend;
        return isDirty ? { prefix: "• " } : null;
      }
    });

    context.commands.registerCommand({
      id: "core.layout.tab.close",
      title: "Close Tab",
      handler: async () => {
        const fileId = context.fileMediator.getContextFileId();
        if (!fileId) return;
        const file = context.files.getFile(fileId);
        if (!file) return;
        const isDirty = file.dirtyVsDisk || file.dirtyVsBackend;
        if (isDirty) {
          const shouldClose = await confirmCloseDirtyFile(file, (options) =>
            context.dialog.showMessage(options)
          );
          if (!shouldClose) return;
        }
        await context.fileMediator.closeFile(fileId, { discardDirty: true });
      }
    });

    context.commands.registerCommand({
      id: "core.layout.tab.closeOthers",
      title: "Close Other Tabs",
      handler: async () => {
        const fileId = context.fileMediator.getContextFileId();
        if (!fileId) return;
        const allFiles = context.files.listFiles();
        for (const file of allFiles) {
          if (file.fileId === fileId) continue;
          const isDirty = file.dirtyVsDisk || file.dirtyVsBackend;
          if (isDirty) {
            const shouldClose = await confirmCloseDirtyFile(file, (options) =>
              context.dialog.showMessage(options)
            );
            if (!shouldClose) return;
          }
          await context.fileMediator.closeFile(file.fileId, { discardDirty: true });
        }
      }
    });

    context.commands.registerCommand({
      id: "core.layout.tab.closeAll",
      title: "Close All Tabs",
      handler: async () => {
        const allFiles = context.files.listFiles();
        for (const file of allFiles) {
          const isDirty = file.dirtyVsDisk || file.dirtyVsBackend;
          if (isDirty) {
            const shouldClose = await confirmCloseDirtyFile(file, (options) =>
              context.dialog.showMessage(options)
            );
            if (!shouldClose) return;
          }
          await context.fileMediator.closeFile(file.fileId, { discardDirty: true });
        }
      }
    });

    context.commands.registerCommand({
      id: "core.layout.tab.copyPath",
      title: "Copy Tab Path",
      handler: async () => {
        const fileId = context.fileMediator.getContextFileId();
        if (!fileId) return;
        const file = context.files.getFile(fileId);
        if (!file) return;
        const path = fileUriToPath(file.uri);
        await navigator.clipboard.writeText(path);
      }
    });

    context.commands.registerCommand({
      id: "core.layout.tab.openInExplorer",
      title: "Open in System Explorer",
      handler: async () => {
        const fileId = context.fileMediator.getContextFileId();
        if (!fileId) return;
        const file = context.files.getFile(fileId);
        if (!file) return;
        await window.appShell.showItemInFolder(file.uri);
      }
    });
  }
};
