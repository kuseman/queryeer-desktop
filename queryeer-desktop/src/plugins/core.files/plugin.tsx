import type { Plugin } from "../../contracts/plugin/Plugin";
import type { MimeCapability } from "../../contracts/files/FilesRegistry";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { fileUriToPath } from "../../contracts/files/Resolvers";
import { getTextEditorRegistry } from "../core.editor/TextEditor/TextEditorRegistry";

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
  "executable"
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

export const coreFilesPlugin: Plugin = {
  manifest: {
    id: "core.files",
    name: "Core Files",
    version: "0.1.0",
    kind: "core",
    description: "Owns the frontend file registry and file entity lifecycle"
  },
  activate: (context) => {
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
          await context.fileMediator.openFile(toFileUri(filePath));
        }
      }
    });

    context.commands.registerCommand({
      id: "core.files.save",
      title: "Save File",
      handler: async () => {
        const activeFileId = context.fileMediator.getActiveFileId();
        if (activeFileId) {
          await context.fileMediator.saveFile(activeFileId);
          return;
        }

        const activeFromEditor = getTextEditorRegistry().getActiveFile();
        if (activeFromEditor) {
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
      commandId: "core.files.new"
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.open",
      label: "Open",
      order: 12,
      parentId: "core.menu.file",
      commandId: "core.files.open"
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.save",
      label: "Save",
      order: 13,
      parentId: "core.menu.file",
      commandId: "core.files.save"
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.saveAs",
      label: "Save As",
      order: 14,
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
      id: "core.files.tooltip.path",
      order: 10,
      render: ({ file }) => ({
        label: "Path",
        value: fileUriToPath(file.uri)
      })
    });
  }
};
