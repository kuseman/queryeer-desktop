import type { Plugin } from "../../contracts/plugin/Plugin";
import type { MimeCapability } from "../../contracts/files/FilesRegistry";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { fileUriToPath } from "../../contracts/files/Resolvers";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../core.settings/service";
import { DocumentIcon } from "./DocumentIcon";
import { NewFileMimeTypesSettingsEditor } from "./NewFileMimeTypesSettingsEditor";

const NEW_FILE_MIME_TYPES_SETTING_ID = "core.files.newFileMimeTypes";
const NEW_FILE_OPEN_LAST_SETTING_ID = "core.files.openNewFilesLast";

const ALL_MIME_CAPABILITIES: MimeCapability[] = [
  "backupable",
  "editable",
  "viewable",
  "queryexecutable"
];

const MIME_EXTENSION_OVERRIDES: Record<string, string> = {
  "application/plbsql": "plbsql",
  "application/sql": "sql",
  "application/json": "json",
  "application/xml": "xml",
  "application/yaml": "yaml",
  "text/markdown": "md",
  "text/plain": "txt",
  "text/html": "html",
  "text/css": "css",
  "text/javascript": "js",
  "text/typescript": "ts"
};

type NewFileMimeTypeOption = {
  mimeType: string;
  extension: string;
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
};

function toFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("//")) {
    return `file:${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file:///${encodeURI(normalized)}`;
}

function renderUnsupportedEditorView(
  file: FileEntity,
  category: string,
  capabilities: MimeCapability[]
): JSX.Element {
  const capabilitySummary = capabilities.join(" ") || "none";
  return (
    <section className="unsupported-editor">
      <header className="unsupported-editor-header">
        <h2>Unsupported File Type</h2>
        <p>
          No editor contribution currently handles this resource. The file is open in a tab so
          you can inspect metadata while we wire dedicated editors.
        </p>
      </header>

      <dl className="unsupported-editor-grid">
        <div>
          <dt>URI</dt>
          <dd title={file.uri}>{file.uri}</dd>
        </div>
        <div>
          <dt>MIME</dt>
          <dd>{file.mimeType}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>
            <span className="unsupported-editor-chip">{category}</span>
          </dd>
        </div>
        <div>
          <dt>Capabilities</dt>
          <dd>
            <span className="unsupported-editor-chip">{capabilitySummary}</span>
          </dd>
        </div>
      </dl>

      <p className="unsupported-editor-help">
        Next step: register an editor contribution with matching `supportedMimeTypes`,
        `supportedContentCategories`, or `requiredCapabilities`.
      </p>
    </section>
  );
}

function fileExtensionForMimeType(mimeType: string): string {
  return MIME_EXTENSION_OVERRIDES[mimeType] ?? "txt";
}

function toMimeLabel(mimeType: string): string {
  const [major, minor] = mimeType.split("/");
  if (!major || !minor) {
    return mimeType;
  }
  if (major === "application") {
    return minor.toUpperCase();
  }
  return `${major} ${minor}`;
}

function listNewFileMimeTypeOptions(context: Parameters<Plugin["activate"]>[0]): NewFileMimeTypeOption[] {
  const mimeTypes = context.files.capabilities.listMimeTypesByCapability("editable");
  return mimeTypes.map((mimeType) => ({
    mimeType,
    extension: fileExtensionForMimeType(mimeType),
    label: context.files.capabilities.getLabel?.(mimeType) ?? toMimeLabel(mimeType),
    icon: context.files.mimeIcons.getMimeIcon(mimeType) ?? DocumentIcon
  }));
}

function listConfiguredNewFileMimeTypeOptions(
  context: Parameters<Plugin["activate"]>[0]
): NewFileMimeTypeOption[] {
  const options = listNewFileMimeTypeOptions(context);
  const optionByMimeType = new Map(options.map((option) => [option.mimeType, option]));
  const settings = getCoreSettingsService();
  const configured = settings?.getValue(NEW_FILE_MIME_TYPES_SETTING_ID);
  if (!Array.isArray(configured)) {
    return options;
  }
  if (configured.length === 0) {
    return options;
  }
  const sorted: NewFileMimeTypeOption[] = [];
  for (const entry of configured) {
    if (typeof entry !== "string") {
      continue;
    }
    const option = optionByMimeType.get(entry);
    if (!option) {
      continue;
    }
    sorted.push(option);
    optionByMimeType.delete(entry);
  }
  return sorted;
}

async function createNewFileFromMimeType(
  context: Parameters<Plugin["activate"]>[0],
  mimeType: string
): Promise<void> {
  const extension = fileExtensionForMimeType(mimeType);
  await context.fileMediator.createUntitledFile({
    mimeType,
    extension,
    cloneFromFileId: null
  });
}

async function maybeFormatBeforeSave(
  fileId: string,
  editors: { getActiveEditor(): { fileId: string | null; format?: { format(): Promise<void> } } | null }
): Promise<void> {
  const settingsService = getCoreSettingsService();
  const formatOnSave = settingsService?.getValue("core.editor.formatOnSave") === true;
  if (!formatOnSave) {
    return;
  }

  const activeEditor = editors.getActiveEditor();
  if (!activeEditor || activeEditor.fileId !== fileId) {
    return;
  }

  if (!activeEditor.format) {
    return;
  }
  await activeEditor.format.format();
}

export const coreFilesPlugin: Plugin = {
  manifest: {
    id: "core.files",
    name: "Core Files",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["files.registry"],
    description: "Owns the frontend file registry and file entity lifecycle"
  },
  activate: (context) => {
    const availableNewMimeTypes = listNewFileMimeTypeOptions(context).map((option) => option.mimeType);
    const preferredNewMimeTypes =
      context.files.capabilities.listPreferredNewFileMimeTypes
        ? context.files.capabilities
            .listPreferredNewFileMimeTypes()
            .filter((mimeType) => availableNewMimeTypes.includes(mimeType))
        : [];
    const defaultNewMimeTypes = [
      ...preferredNewMimeTypes,
      ...availableNewMimeTypes.filter((mimeType) => !preferredNewMimeTypes.includes(mimeType))
    ];

    context.files.mimeIcons.registerMimeIcon({
      moduleId: "core.files",
      mimeType: "application/octet-stream",
      icon: DocumentIcon
    });

    context.settings.registerAdvancedRenderer({
      id: "core.files.newFileMimeTypes.renderer",
      render: ({ value, setValue, readonly }) => (
        <NewFileMimeTypesSettingsEditor
          value={value}
          setValue={setValue}
          readonly={readonly}
          options={listNewFileMimeTypeOptions(context).map((option) => ({
            mimeType: option.mimeType,
            label: option.label,
            icon: option.icon
          }))}
        />
      )
    });

    context.settings.registerSettings({
      moduleId: "core.files",
      title: "Files",
      order: 20,
      settings: [
        {
          id: NEW_FILE_OPEN_LAST_SETTING_ID,
          moduleId: "core.files",
          title: "Open new files last",
          description: "If true, new tabs open at the end. Otherwise they open after the active tab.",
          sectionPath: ["Files", "New"],
          tags: ["files", "new", "tabs", "order"],
          type: "boolean",
          defaultValue: true
        },
        {
          id: "core.files.recentFilesMaxCount",
          moduleId: "core.files",
          title: "Recent Files",
          description: "Maximum number of recently opened files to remember.",
          sectionPath: ["Files", "Recent"],
          tags: ["recent", "files", "history"],
          type: "number",
          defaultValue: 100,
          constraints: { min: 10, max: 500 }
        },
        {
          id: NEW_FILE_MIME_TYPES_SETTING_ID,
          moduleId: "core.files",
          title: "New File MIME Types",
          description:
            "Controls which editable MIME types are shown in New dropdowns and their order.",
          sectionPath: ["Files", "New"],
          tags: ["files", "new", "mime", "order"],
          type: "json",
          defaultValue: defaultNewMimeTypes,
          advanced: {
            rendererId: "core.files.newFileMimeTypes.renderer"
          }
        }
      ]
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }

    let lastMenuOptionsKey = listConfiguredNewFileMimeTypeOptions(context)
      .map((option) => option.mimeType)
      .join("|");

    const maybeRebuildMenu = () => {
      const nextKey = listConfiguredNewFileMimeTypeOptions(context)
        .map((option) => option.mimeType)
        .join("|");
      if (nextKey === lastMenuOptionsKey) {
        return;
      }
      lastMenuOptionsKey = nextKey;
      void context.menu.rebuildMenu();
    };

    onCoreSettingsServiceInitialized((service) => {
      service.subscribe(() => {
        maybeRebuildMenu();
      });
    });

    context.layout.registerEditor({
      id: "core.files.unsupported",
      title: "Unsupported File",
      order: 9_999,
      supportedMimeTypes: ["*/*"],
      openIntents: ["view", "edit"],
      priority: -1_000,
      render: ({ activeFile } = {}) => {
        if (!activeFile) {
          return (
            <section className="unsupported-editor">
              <header className="unsupported-editor-header">
                <h2>Unsupported File Type</h2>
                <p>No active file selected.</p>
              </header>
            </section>
          );
        }
        const capabilities = ALL_MIME_CAPABILITIES.filter((capability) =>
          context.files.capabilities.hasCapability(activeFile.mimeType, capability)
        );
        const category =
          context.files.capabilities.getContentCategory(activeFile.mimeType) ?? "unknown";
        return renderUnsupportedEditorView(activeFile, category, capabilities);
      }
    });

    context.commands.registerCommand({
      id: "core.files.new",
      title: "New File",
      handler: async () => {
        const activeId = context.fileMediator.getActiveFileId();
        const active = activeId ? context.files.getFile(activeId) : undefined;
        const extension = fileExtensionForMimeType(active?.mimeType ?? "text/plain");
        await context.fileMediator.createUntitledFile({
          extension,
          mimeType: active?.mimeType,
          cloneFromFileId: active?.fileId ?? null
        });
      }
    });

    const mimeTypeOptions = listNewFileMimeTypeOptions(context);
    for (const option of mimeTypeOptions) {
      const commandId = `core.files.new.fromMime.${option.mimeType}`;
      context.commands.registerCommand({
        id: commandId,
        title: `New ${option.label}`,
        handler: async () => {
          await createNewFileFromMimeType(context, option.mimeType);
        }
      });
    }

    context.commands.registerCommand({
      id: "core.files.new.fromToolbar",
      title: "New File (From Toolbar)",
      handler: async () => {
        const option = listConfiguredNewFileMimeTypeOptions(context)[0];
        if (!option) {
          return;
        }
        await createNewFileFromMimeType(context, option.mimeType);
      }
    });

    context.commands.registerCommand({
      id: "core.files.open",
      title: "Open File",
      handler: async () => {
        const result = await context.dialog.showOpenDialog({
          title: "Open File",
          multiSelections: true
        });
        if (result.canceled || result.filePaths.length === 0) {
          return;
        }
        for (const filePath of result.filePaths) {
          const uri = toFileUri(filePath);
          await context.fileMediator.openFile(uri);
          try {
            const settings = getCoreSettingsService();
            const maxCount = settings?.getValue("core.files.recentFilesMaxCount") as
              | number
              | undefined;
            await window.appShell.addRecentFile(uri, maxCount);
          } catch {
            // best effort - recent files may fail
          }
        }
      }
    });

    context.layout.registerToolbarAction({
      id: "core.files.toolbar.open",
      order: 20,
      commandId: "core.files.open",
      icon: "file-open"
    });

    context.layout.registerToolbarAction({
      id: "core.files.toolbar.new.menu",
      order: 30,
      type: "menu",
      title: "New",
      icon: "file-new",
      getItems: () => {
        return listConfiguredNewFileMimeTypeOptions(context).map((option) => ({
          value: option.mimeType,
          label: option.label,
          icon: option.icon
        }));
      },
      onSelect: (mimeType) => {
        void createNewFileFromMimeType(context, mimeType);
      },
      disabled: () => listConfiguredNewFileMimeTypeOptions(context).length === 0,
      isVisible: () => listConfiguredNewFileMimeTypeOptions(context).length > 0
    });

    context.commands.registerCommand({
      id: "core.files.save",
      title: "Save File",
      handler: async () => {
        const activeFileId = context.fileMediator.getActiveFileId();
        if (activeFileId) {
          await maybeFormatBeforeSave(activeFileId, context.editors);
          await context.fileMediator.saveFile(activeFileId);
        }
      }
    });

    context.commands.registerCommand({
      id: "core.files.saveAs",
      title: "Save As",
      handler: async () => {}
    });

    context.layout.registerToolbarAction({
      id: "core.files.toolbar.save",
      order: 40,
      commandId: "core.files.save",
      icon: "file-save",
      when: "hasActiveFile"
    });

    context.keybindings.registerKeybinding({
      id: "core.files.keybinding.new",
      commandId: "core.files.new",
      key: "CmdOrCtrl+N",
      when: "global",
      scope: "global",
      order: 110
    });
    context.keybindings.registerKeybinding({
      id: "core.files.keybinding.open",
      commandId: "core.files.open",
      key: "CmdOrCtrl+O",
      when: "global",
      scope: "global",
      order: 120
    });
    context.keybindings.registerKeybinding({
      id: "core.files.keybinding.save",
      commandId: "core.files.save",
      key: "CmdOrCtrl+S",
      when: "editorFocus",
      scope: "editor",
      order: 130
    });
    context.keybindings.registerKeybinding({
      id: "core.files.keybinding.saveAs",
      commandId: "core.files.saveAs",
      key: "CmdOrCtrl+Shift+S",
      when: "editorFocus",
      scope: "editor",
      order: 140
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.new",
      label: "New",
      type: "submenu",
      order: 11,
      parentId: "core.menu.file",
      commandId: "core.files.new",
      icon: "file-new",
      dynamicItems: async () => {
        const options = listConfiguredNewFileMimeTypeOptions(context);
        if (options.length === 0) {
          return [
            {
              id: "core.files.menu.new.mime.empty",
              label: "No MIME types configured",
              order: 0,
              parentId: "core.files.menu.new",
              type: "normal" as const
            }
          ];
        }
        return options.map((option, index) => ({
          id: `core.files.menu.new.mime.${option.mimeType}`,
          label: option.label,
          order: index,
          parentId: "core.files.menu.new",
          commandId: `core.files.new.fromMime.${option.mimeType}`,
          mimeType: option.mimeType
        }));
      }
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.open",
      label: "Open",
      order: 12,
      parentId: "core.menu.file",
      commandId: "core.files.open",
      icon: "file-open"
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.openRecent",
      label: "Open Recent",
      order: 13,
      parentId: "core.menu.file",
      dynamicItems: async () => {
        const entries = await window.appShell.getRecentFiles();
        const recentFiles = entries.slice(0, 10);

        const items = recentFiles.map((entry, index) => {
          const fileName = entry.uri.split("/").pop() ?? entry.uri;

          return {
            id: `core.files.menu.openRecent.${index}`,
            label: fileName,
            order: index,
            parentId: "core.files.menu.openRecent" as string,
            commandId: `core.files.openRecent.${index}` as string,
            type: "normal" as const
          };
        });

        return items;
      }
    });

    for (let i = 0; i < 10; i++) {
      const index = i;
      context.commands.registerCommand({
        id: `core.files.openRecent.${index}`,
        title: `Open Recent ${index}`,
        handler: async () => {
          const entries = await window.appShell.getRecentFiles();
          const entry = entries[index];
          if (!entry) {
            return;
          }

          const stat = await window.appShell.getStat({ uri: entry.uri });
          if (!stat.success || !stat.stat?.isFile) {
            const result = await context.dialog.showMessage({
              title: "File Not Found",
              message: `The file "${entry.uri.split("/").pop()}" could not be found.`,
              severity: "warning",
              detail: "It may have been moved or deleted. Remove it from recent files?",
              options: [
                { label: "Remove", value: "remove" },
                { label: "Cancel", value: "cancel" }
              ]
            });
            if (result.action === "remove") {
              await window.appShell.removeRecentFile(entry.uri);
            }
            return;
          }

          await context.fileMediator.openFile(entry.uri);
          try {
            const settings = getCoreSettingsService();
            const maxCount = settings?.getValue("core.files.recentFilesMaxCount") as
              | number
              | undefined;
            await window.appShell.addRecentFile(entry.uri, maxCount);
          } catch {
            // best effort
          }
        }
      });
    }

    context.menu.registerMenuItem({
      id: "core.files.menu.save",
      label: "Save",
      order: 14,
      parentId: "core.menu.file",
      commandId: "core.files.save",
      icon: "file-save"
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.saveAs",
      label: "Save As",
      order: 15,
      parentId: "core.menu.file",
      commandId: "core.files.saveAs"
    });

    context.tooltip.registerTooltipSection({
      id: "core.files.tooltip.fileStatus",
      order: 5,
      render: ({ file }) => {
        if (file.diskState === "deletedOnDisk") {
          return {
            label: "Status",
            value: "Deleted on disk",
            severity: "error"
          };
        }
        if (file.diskState === "modifiedOnDisk") {
          return {
            label: "Status",
            value: file.dirtyVsDisk ? "Modified on disk (unsaved changes)" : "Modified on disk",
            severity: "warning"
          };
        }
        return null;
      }
    });

    context.tooltip.registerTooltipSection({
      id: "core.files.tooltip.path",
      order: 10,
      render: ({ file }) => ({
        label: "Path",
        value: fileUriToPath(file.uri)
      })
    });
  }
};
