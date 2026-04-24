import type { Plugin } from "../../contracts/plugin/Plugin";
import { getExplorerStore } from "./store";
import { ExplorerView } from "./ExplorerView";

export const coreExplorerPlugin: Plugin = {
  manifest: {
    id: "core.explorer",
    name: "Core Explorer",
    version: "0.1.0",
    kind: "core",
    description: "File explorer sidebar for browsing and opening files from added folders"
  },
  activate: (context) => {
    const store = getExplorerStore();

    context.layout.registerView({
      id: "core.explorer.view",
      title: "Explorer",
      defaultZone: "primarySidebar",
      order: 0,
      canMoveZones: true,
      canCollapse: true,
      isOpen: true,
      flex: 1,
      maxHeight: 300,
      panelActions: [
        {
          id: "core.explorer.action.addFolder",
          icon: "+",
          title: "Add Folder",
          commandId: "core.explorer.addFolder"
        },
        {
          id: "core.explorer.action.removeFolder",
          icon: "×",
          title: "Remove Folder",
          commandId: "core.explorer.removeFolder"
        }
      ],
      render: () => (
        <ExplorerView
          context={context}
          filesRegistry={context.files}
          store={store}
          readDir={async (uri) => {
            const appShell = window.appShell;
            if (!appShell?.readDir) {
              return { success: false, items: [] };
            }
            return appShell.readDir({ uri });
          }}
        />
      )
    });

    context.commands.registerCommand({
      id: "core.explorer.addFolder",
      title: "Add Folder to Explorer",
      handler: async () => {
        const result = await context.dialog.showOpenFolder({
          title: "Add Folder to Explorer"
        });
        if (result.canceled || !result.folderPath) {
          return;
        }
        const normalized = result.folderPath.replace(/\\/g, "/");
        const name = normalized.split("/").pop() ?? result.folderPath;
        const uri = normalized.startsWith("//")
          ? `file:${encodeURI(normalized)}`
          : normalized.startsWith("/")
            ? `file://${encodeURI(normalized)}`
            : `file:///${encodeURI(normalized)}`;
        store.addFolder(uri, name);
      }
    });

    context.commands.registerCommand({
      id: "core.explorer.removeFolder",
      title: "Remove Folder from Explorer",
      handler: async () => {
        const selectedId = store.getSelectedFolderId();
        const folderIdToRemove = selectedId ?? store.getFolders().slice(-1)[0]?.id;
        
        if (!folderIdToRemove) {
          return;
        }

        const state = store.getState();
        const folderNode = state.treeNodes.get(folderIdToRemove);
        const folderName = folderNode?.name ?? "this folder";
        
        const result = await context.dialog.showMessage({
          title: "Remove Folder",
          message: `Are you sure you want to remove "${folderName}" from Explorer?`,
          severity: "warning",
          options: [
            { label: "Remove", value: "remove" },
            { label: "Cancel", value: "cancel" }
          ]
        });

        if (result.action === "remove") {
          store.removeFolder(folderIdToRemove);
          if (selectedId === folderIdToRemove) {
            store.setSelectedFolderId(null);
          }
        }
      }
    });
  }
};