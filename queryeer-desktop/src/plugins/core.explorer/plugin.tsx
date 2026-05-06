import type { Plugin } from "../../contracts/plugin/Plugin";
import type { FileWatcherEvent, FileWatcherSubscription } from "../../contracts/files/FileWatcher";
import { getExplorerStore } from "./store";
import { ExplorerView } from "./ExplorerView";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../core.settings/service";
import { TrackedFoldersSettingsEditor } from "./TrackedFoldersSettingsEditor";

export const WORKSPACE_OPEN_FILES_ORDER_SETTING_ID = "core.explorer.workspaceOpenFilesOrder";
export const TRACKED_FOLDERS_SETTING_ID = "core.explorer.trackedFolders";
export const FOLDER_INDEX_HARD_CAP_SETTING_ID = "core.explorer.folderIndexHardCap";
export const TRACKED_FOLDERS_RENDERER_ID = "core.explorer.trackedFolders.renderer";
const DEFAULT_FOLDER_FILTER_REGEX = "\\.(sql|plbsql)$";
const DEFAULT_FOLDER_INDEX_HARD_CAP = 10_000;

type IndexedExplorerFile = {
  uri: string;
  name: string;
  folderId: string;
  folderName: string;
};

type PersistedTrackedFolder = {
  uri: string;
  name: string;
  filterRegex: string;
};

function toFileUriFromFolderPath(folderPath: string): { uri: string; name: string } {
  const normalized = folderPath.replace(/\\/g, "/");
  const name = normalized.split("/").pop() ?? folderPath;
  const uri = normalized.startsWith("//")
    ? `file:${encodeURI(normalized)}`
    : normalized.startsWith("/")
      ? `file://${encodeURI(normalized)}`
      : `file:///${encodeURI(normalized)}`;
  return { uri, name };
}

function fileNameFromUri(uri: string): string {
  return decodeURIComponent(uri.split("/").pop() ?? uri);
}

function filePathFromUri(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  const path = decodeURIComponent(uri.slice("file://".length));
  if (/^\/[A-Za-z]:\//.test(path)) {
    return path.slice(1).replace(/\//g, "\\");
  }
  return path;
}

function joinUri(parentUri: string, childName: string): string {
  const parent = parentUri.replace(/\/$/, "");
  return `${parent}/${encodeURIComponent(childName)}`;
}

function normalizeUri(uri: string): string {
  return uri.toLowerCase();
}

function toPersistedFolders(value: unknown): PersistedTrackedFolder[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const next: PersistedTrackedFolder[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const uri = typeof record.uri === "string" ? record.uri : "";
    const name = typeof record.name === "string" ? record.name : "";
    const filterRegex =
      typeof record.filterRegex === "string" && record.filterRegex.length > 0
        ? record.filterRegex
        : DEFAULT_FOLDER_FILTER_REGEX;
    if (!uri || !name) {
      continue;
    }
    next.push({ uri, name, filterRegex });
  }
  return next;
}

export const coreExplorerPlugin: Plugin = {
  manifest: {
    id: "core.explorer",
    name: "Core Explorer",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["explorer.view"],
    description: "File explorer sidebar for browsing and opening files from added folders"
  },
  activate: (context) => {
    const store = getExplorerStore();
    const watcherByFolderId = new Map<string, FileWatcherSubscription>();
    const indexByFolderId = new Map<string, IndexedExplorerFile[]>();
    const reindexTimerByFolderId = new Map<string, ReturnType<typeof setTimeout>>();

    const readDir = async (uri: string) => {
      const appShell = window.appShell;
      if (!appShell?.readDir) {
        return { success: false as const, items: [] };
      }
      return appShell.readDir({ uri });
    };

    const buildFolderIndex = async (
      folderId: string,
      folderUri: string,
      folderName: string,
      filterRegexRaw: string
    ) => {
      const files: IndexedExplorerFile[] = [];
      const queue: string[] = [folderUri];
      const capRaw = getCoreSettingsService()?.getValue(FOLDER_INDEX_HARD_CAP_SETTING_ID);
      const maxFiles =
        typeof capRaw === "number" && capRaw > 0 && Number.isFinite(capRaw)
          ? Math.floor(capRaw)
          : DEFAULT_FOLDER_INDEX_HARD_CAP;
      let filterRegex: RegExp | null = null;
      try {
        filterRegex = new RegExp(filterRegexRaw, "i");
      } catch {
        filterRegex = null;
      }
      while (queue.length > 0 && files.length < maxFiles) {
        const current = queue.shift();
        if (!current) {
          continue;
        }
        const result = await readDir(current);
        if (!result.success) {
          continue;
        }
        for (const item of result.items) {
          const itemUri = joinUri(current, item.name);
          if (item.isDirectory) {
            queue.push(itemUri);
            continue;
          }
          if (!item.isFile) {
            continue;
          }
          if (filterRegex && !filterRegex.test(item.name)) {
            continue;
          }
          files.push({
            uri: itemUri,
            name: item.name,
            folderId,
            folderName
          });
        }
      }
      files.sort((a, b) => a.name.localeCompare(b.name) || a.uri.localeCompare(b.uri));
      indexByFolderId.set(folderId, files);
    };

    const onFolderWatchEvent = (
      folderId: string,
      folderUri: string,
      folderName: string,
      filterRegexRaw: string,
      event: FileWatcherEvent
    ) => {
      const existing = indexByFolderId.get(folderId);
      if (!existing) {
        scheduleReindex(folderId, folderUri, folderName, filterRegexRaw);
        return;
      }
      let filterRegex: RegExp | null = null;
      try {
        filterRegex = new RegExp(filterRegexRaw, "i");
      } catch {
        filterRegex = null;
      }
      const eventUri = normalizeUri(event.uri);
      const isUnderFolder = eventUri.startsWith(normalizeUri(folderUri.replace(/\/$/, "")));
      if (!isUnderFolder) {
        return;
      }

      if (event.type === "delete") {
        indexByFolderId.set(
          folderId,
          existing.filter((item) => normalizeUri(item.uri) !== eventUri)
        );
      } else if (event.type === "rename") {
        scheduleReindex(folderId, folderUri, folderName, filterRegexRaw);
      } else {
        const fileName = fileNameFromUri(event.uri);
        if (filterRegex && !filterRegex.test(fileName)) {
          return;
        }
        const next = existing.filter((item) => normalizeUri(item.uri) !== eventUri);
        next.push({
          uri: event.uri,
          name: fileName,
          folderId,
          folderName
        });
        next.sort((a, b) => a.name.localeCompare(b.name) || a.uri.localeCompare(b.uri));
        const capRaw = getCoreSettingsService()?.getValue(FOLDER_INDEX_HARD_CAP_SETTING_ID);
        const maxFiles =
          typeof capRaw === "number" && capRaw > 0 && Number.isFinite(capRaw)
            ? Math.floor(capRaw)
            : DEFAULT_FOLDER_INDEX_HARD_CAP;
        indexByFolderId.set(folderId, next.slice(0, maxFiles));
      }
      scheduleReindex(folderId, folderUri, folderName, filterRegexRaw);
    };

    const scheduleReindex = (
      folderId: string,
      folderUri: string,
      folderName: string,
      filterRegex: string
    ) => {
      const existing = reindexTimerByFolderId.get(folderId);
      if (existing) {
        clearTimeout(existing);
      }
      const timer = setTimeout(() => {
        reindexTimerByFolderId.delete(folderId);
        void buildFolderIndex(folderId, folderUri, folderName, filterRegex);
      }, 120);
      reindexTimerByFolderId.set(folderId, timer);
    };

    const persistFolders = async () => {
      const settings = getCoreSettingsService();
      if (!settings) {
        return;
      }
      const payload = store.getFolders().map((folder) => ({
        uri: folder.uri,
        name: folder.name,
        filterRegex: folder.filterRegex
      }));
      await settings.setValue(TRACKED_FOLDERS_SETTING_ID, payload);
    };

    const hydrateFoldersFromSettings = () => {
      const settings = getCoreSettingsService();
      const value = settings?.getValue(TRACKED_FOLDERS_SETTING_ID);
      const folders = toPersistedFolders(value);
      store.replaceFolders(folders);
    };

    const syncFolderWatchers = () => {
      const folders = store.getFolders();
      const activeFolderIds = new Set(folders.map((folder) => folder.id));

      for (const [folderId, sub] of watcherByFolderId.entries()) {
        if (activeFolderIds.has(folderId)) {
          continue;
        }
        watcherByFolderId.delete(folderId);
        indexByFolderId.delete(folderId);
        const timer = reindexTimerByFolderId.get(folderId);
        if (timer) {
          clearTimeout(timer);
          reindexTimerByFolderId.delete(folderId);
        }
        void sub.unsubscribe();
      }

      for (const folder of folders) {
        if (watcherByFolderId.has(folder.id)) {
          continue;
        }
        void buildFolderIndex(folder.id, folder.uri, folder.name, folder.filterRegex);
        context.fileWatcher
          .watch(folder.uri, { recursive: true }, (event) => {
            onFolderWatchEvent(folder.id, folder.uri, folder.name, folder.filterRegex, event);
          })
          .then((sub) => {
            watcherByFolderId.set(folder.id, sub);
          })
          .catch(() => {
            // best effort - explorer remains functional without watcher
          });
      }
    };

    store.subscribe(syncFolderWatchers);
    hydrateFoldersFromSettings();
    syncFolderWatchers();
    onCoreSettingsServiceInitialized((service) => {
      hydrateFoldersFromSettings();
      service.subscribe(() => {
        hydrateFoldersFromSettings();
      });
    });

    context.settings.registerAdvancedRenderer({
      id: TRACKED_FOLDERS_RENDERER_ID,
      render: ({ value, setValue, readonly }) => (
        <TrackedFoldersSettingsEditor value={value} setValue={setValue} readonly={readonly} />
      )
    });

    context.settings.registerSettings({
      moduleId: "core.explorer",
      title: "Explorer",
      order: 25,
      settings: [
        {
          id: WORKSPACE_OPEN_FILES_ORDER_SETTING_ID,
          moduleId: "core.explorer",
          title: "Workspace Open Files Order",
          description: "Controls ordering for open files shown in Explorer Workspace section.",
          sectionPath: ["Explorer", "Workspace"],
          tags: ["explorer", "workspace", "open files", "order"],
          type: "enum",
          defaultValue: "tabOrder",
          options: [
            { value: "tabOrder", label: "Current tab order" },
            { value: "alphabetical", label: "Alphabetical" },
            { value: "lastUsed", label: "Most recently used" }
          ]
        },
        {
          id: FOLDER_INDEX_HARD_CAP_SETTING_ID,
          moduleId: "core.explorer",
          title: "Folder Index Hard Cap",
          description: "Maximum number of indexed files per tracked folder for quick command.",
          sectionPath: ["Explorer", "Folders"],
          tags: ["explorer", "index", "performance"],
          type: "number",
          defaultValue: DEFAULT_FOLDER_INDEX_HARD_CAP,
          constraints: { min: 100, max: 100000 }
        },
        {
          id: TRACKED_FOLDERS_SETTING_ID,
          moduleId: "core.explorer",
          title: "Tracked Folders",
          description: "Persisted tracked folders with per-folder file filter regex.",
          sectionPath: ["Explorer", "Folders"],
          tags: ["explorer", "folders", "persist"],
          type: "json",
          defaultValue: [],
          advanced: {
            rendererId: TRACKED_FOLDERS_RENDERER_ID
          }
        }
      ]
    });

    context.commands.registerCommand({
      id: "core.explorer.openTrackedFoldersSettings",
      title: "Open Explorer Tracked Folder Settings",
      category: "Explorer",
      handler: () => {
        const settings = getCoreSettingsService();
        if (settings) {
          settings.openModalForSetting(TRACKED_FOLDERS_SETTING_ID);
          return;
        }
        void context.commands.executeCommand("core.settings.open");
      }
    });

    context.layout.registerView({
      id: "core.explorer.view",
      title: "Explorer",
      defaultZone: "secondarySidebar",
      order: 10,
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
          id: "core.explorer.action.openSettings",
          icon: "⚙",
          title: "Tracked Folder Settings",
          commandId: "core.explorer.openTrackedFoldersSettings"
        }
      ],
      render: () => (
        <ExplorerView
          context={context}
          filesRegistry={context.files}
          store={store}
          readDir={readDir}
        />
      )
    });

    context.quickcommand.registerProvider({
      prefix: "#",
      label: "Explorer Files",
      order: 15,
      getItems: () => {
        const items = [...indexByFolderId.values()].flat();
        return items.slice(0, 2_000).map((item) => ({
          id: `explorer.file.${item.uri}`,
          title: fileNameFromUri(item.uri),
          description: `${item.folderName} - ${filePathFromUri(item.uri)}`,
          action: async () => {
            await context.fileMediator.openFile(item.uri, { openIntent: "edit" });
          }
        }));
      }
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
        const { uri, name } = toFileUriFromFolderPath(result.folderPath);
        const defaultRegex = DEFAULT_FOLDER_FILTER_REGEX;

        let selectedRegex = defaultRegex;
        const inputDialog = context.dialog.showInputDialog;
        if (inputDialog) {
          const input = await inputDialog({
            title: "Folder File Filter",
            message: "Regex for files to track in this folder (example: \\.(sql|plbsql)$)",
            placeholder: defaultRegex
          });
          if (!input.canceled) {
            selectedRegex = input.value?.trim() ? input.value.trim() : defaultRegex;
          }
        }
        try {
          // validate upfront
          // eslint-disable-next-line no-new
          new RegExp(selectedRegex, "i");
        } catch {
          await context.dialog.showMessage({
            title: "Invalid Regex",
            message: `Invalid file filter regex: ${selectedRegex}`,
            severity: "warning"
          });
          return;
        }

        store.addFolder(uri, name, selectedRegex);
        await persistFolders();
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
        if (folderIdToRemove === "workspace-root") {
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
          await persistFolders();
          if (selectedId === folderIdToRemove) {
            store.setSelectedFolderId(null);
          }
        }
      }
    });
  }
};
