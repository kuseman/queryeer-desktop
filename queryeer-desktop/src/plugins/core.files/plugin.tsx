import type { Plugin } from "../../contracts/plugin/Plugin";
import type { MimeCapability } from "../../contracts/files/FilesRegistry";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { fileUriToPath } from "../../contracts/files/Resolvers";
import { getTextEditorRegistry } from "../core.editor/TextEditor/TextEditorRegistry";
import { getCoreSettingsService } from "../core.settings/service";

const EXTENSION_MIME_MAP: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  xml: "application/xml",
  csv: "text/csv",
  log: "text/plain",
  sql: "application/sql",
  plbsql: "application/plbsql"
};

const DEFAULT_CAPABILITIES: MimeCapability[] = [
  "backupable",
  "editable",
  "viewable"
];

const ALL_MIME_CAPABILITIES: MimeCapability[] = [
  "backupable",
  "editable",
  "viewable",
  "queryexecutable"
];

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

async function maybeFormatBeforeSave(fileId: string): Promise<void> {
  const settingsService = getCoreSettingsService();
  const formatOnSave = settingsService?.getValue("core.editor.formatOnSave") === true;
  if (!formatOnSave) {
    return;
  }

  const textEditorRegistry = getTextEditorRegistry();
  const activeFile = textEditorRegistry.getActiveFile();
  if (!activeFile || activeFile.fileId !== fileId) {
    return;
  }

  const editor = textEditorRegistry.getActiveEditor();
  if (!editor) {
    return;
  }
  await editor.format();
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
    context.settings.registerSettings({
      moduleId: "core.files",
      title: "Files",
      order: 20,
      settings: [
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
        }
      ]
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
        console.log("New file command executed");
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
            const settingsService = getCoreSettingsService();
            const maxCount = settingsService?.getValue("core.files.recentFilesMaxCount") as number | undefined;
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
      id: "core.files.toolbar.new",
      order: 30,
      commandId: "core.files.new",
      icon: "file-new"
    });

    context.commands.registerCommand({
      id: "core.files.save",
      title: "Save File",
      handler: async () => {
        const activeFileId = context.fileMediator.getActiveFileId();
        if (activeFileId) {
          await maybeFormatBeforeSave(activeFileId);
          await context.fileMediator.saveFile(activeFileId);
          return;
        }

        const activeFromEditor = getTextEditorRegistry().getActiveFile();
        if (activeFromEditor) {
          await maybeFormatBeforeSave(activeFromEditor.fileId);
          await context.fileMediator.saveFile(activeFromEditor.fileId);
        }
      }
    });

    context.commands.registerCommand({
      id: "core.files.saveAs",
      title: "Save As",
      handler: async () => {
        console.log("Save as command executed");
      }
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
      order: 11,
      parentId: "core.menu.file",
      commandId: "core.files.new",
      icon: "file-new"
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
            const settingsService = getCoreSettingsService();
            const maxCount = settingsService?.getValue("core.files.recentFilesMaxCount") as number | undefined;
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

    context.files.registerMimeResolver((_uri, hint) => {
      const extension = hint?.extension;
      if (!extension) {
        return undefined;
      }
      return EXTENSION_MIME_MAP[extension];
    });

    for (const mimeType of new Set(Object.values(EXTENSION_MIME_MAP))) {
      context.files.capabilities.registerCapabilities(mimeType, DEFAULT_CAPABILITIES);
      context.files.capabilities.registerContentCategory(mimeType, "text");
    }

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
