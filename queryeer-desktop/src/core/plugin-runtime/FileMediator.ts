import type {
  FileExecuteResult,
  FileMediator
} from "../../contracts/files/FileMediator";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";

export type BackendQueryExecutor = (params: {
  queryExecutionId: string;
  engineId: string;
  text: string;
}) => Promise<{ accepted: boolean; queryExecutionId: string }>;

export type FileBackendSync = {
  openFile?: (file: FileEntity, initialText?: string) => void | Promise<void>;
  closeFile?: (file: FileEntity) => void | Promise<void>;
  changeFile?: (file: FileEntity, text: string) => void | Promise<void>;
  bindFile?: (file: FileEntity) => void | Promise<void>;
};

export type FileMediatorOptions = {
  filesRegistry: FilesRegistry;
  executeBackendQuery: BackendQueryExecutor;
  backendSync?: FileBackendSync;
  writeFile?: (uri: string, text: string) => Promise<{ success: boolean }>;
  readFile?: (uri: string) => Promise<{ success: boolean; content: string }>;
  resolveFileContent?: (fileId: string, uri: string) => string | undefined;
  onFileChanged?: (file: FileEntity, text: string) => void;
  changeDebounceMs?: number;
  generateQueryExecutionId?: () => string;
  now?: () => number;
  showSaveDialog?: (options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  muteFileWatcherPath?: (uri: string, durationMs: number) => Promise<void>;
};

let executionCounter = 0;

function defaultExecutionId(): string {
  executionCounter += 1;
  return `qx-${Date.now().toString(36)}-${executionCounter}`;
}

export function createFileMediator(options: FileMediatorOptions): FileMediator {
  const {
    filesRegistry,
    executeBackendQuery,
    backendSync,
    writeFile,
    readFile,
    resolveFileContent,
    onFileChanged,
    generateQueryExecutionId = defaultExecutionId,
    showSaveDialog,
    muteFileWatcherPath
  } = options;

  let activeFileId: string | null = null;
  let contextFileId: string | null = null;

  return {
    async openFile(uri, hint) {
      const existing = filesRegistry
        .listFiles()
        .find((file) => file.uri === uri);
      if (existing) {
        return existing;
      }

      const mimeType =
        hint?.mimeType ??
        filesRegistry.classifyUri(uri, {
          declared: hint?.mimeType,
          extension: hint?.extension
        });

      let editorId = hint?.editorId;
      if (!editorId) {
        const probe: FileEntity = {
          fileId: "probe",
          version: 0,
          uri,
          mimeType,
          dirtyVsBackend: false,
          dirtyVsDisk: false,
          diskState: "inSync",
          openedAt: ""
        };
        editorId = filesRegistry.resolveEditor(probe, {
          uri,
          mimeType,
          openIntent: hint?.openIntent
        });
      }

      const file = filesRegistry.openFile({
        uri,
        mimeType,
        editorId,
        engineBinding: hint?.engineBinding,
        persistentViewState: hint?.persistentViewState
      });

      if (file.engineBinding) {
        await backendSync?.openFile?.(file);
      }

      activeFileId = file.fileId;

      return file;
    },

    async closeFile(fileId, opts) {
      const file = filesRegistry.getFile(fileId);
      if (!file) {
        return;
      }
      if ((file.dirtyVsDisk || file.dirtyVsBackend) && !opts?.discardDirty) {
        throw new Error(
          `Cannot close file '${fileId}' with unsaved changes; pass discardDirty to override.`
        );
      }
      await backendSync?.closeFile?.(file);
      filesRegistry.closeFile(fileId);
      if (activeFileId === fileId) {
        activeFileId = null;
      }
    },

    async saveFile(fileId) {
      const file = filesRegistry.getFile(fileId);
      if (!file) {
        return;
      }

      const isFileUri = file.uri.startsWith("file:");
      const isUntitled = file.uri.startsWith("untitled:");

      if (!isFileUri && !isUntitled) {
        return;
      }

      let targetUri = file.uri;

      if (isUntitled) {
        if (!showSaveDialog) {
          return;
        }
        const dialogResult = await showSaveDialog({
          title: "Save Query",
          defaultPath: file.uri.replace(/^untitled:/, "") || undefined,
          filters: [{ name: "SQL Files", extensions: ["sql"] }]
        });
        if (dialogResult.canceled || !dialogResult.filePath) {
          return;
        }
        let normalizedPath = dialogResult.filePath.replace(/\\/g, "/");
        if (/^[a-zA-Z]:/.test(normalizedPath)) {
          normalizedPath = `/${normalizedPath}`;
        }
        targetUri = `file://${normalizedPath}`;
      }

      const latestText = resolveFileContent?.(fileId, file.uri);
      if (latestText === undefined) {
        return;
      }

      if (writeFile) {
        if (targetUri.startsWith("file:")) {
          await muteFileWatcherPath?.(targetUri, 750);
        }
        const result = await writeFile(targetUri, latestText);
        if (!result.success) {
          throw new Error(`Failed to save file '${targetUri}'`);
        }
      }

      filesRegistry.updateFile(fileId, {
        uri: targetUri,
        dirtyVsDisk: false,
        diskState: "inSync"
      });
    },

    setActiveFileId(fileId) {
      activeFileId = fileId;
    },

    getActiveFileId() {
      return activeFileId;
    },

    setContextFileId(fileId) {
      contextFileId = fileId;
    },

    getContextFileId() {
      return contextFileId;
    },

    async bindEngine(fileId, engineId, connectionId) {
      const existing = filesRegistry.getFile(fileId);
      if (!existing) {
        return undefined;
      }
      const next = filesRegistry.updateFile(fileId, {
        engineBinding: { engineId, connectionId }
      });
      if (!next) {
        return undefined;
      }
      const wasBound = Boolean(existing.engineBinding);
      if (!wasBound) {
        await backendSync?.openFile?.(next);
      } else {
        await backendSync?.bindFile?.(next);
      }
      return next;
    },

    async executeFile(fileId, text): Promise<FileExecuteResult> {
      const file = filesRegistry.getFile(fileId);
      if (!file) {
        throw new Error(`Cannot execute unknown file '${fileId}'`);
      }
      if (!file.engineBinding) {
        throw new Error(
          `Cannot execute file '${fileId}' without an engine binding`
        );
      }
      const queryExecutionId = generateQueryExecutionId();
      const result = await executeBackendQuery({
        queryExecutionId,
        engineId: file.engineBinding.engineId,
        text
      });
      return {
        queryExecutionId: result.queryExecutionId,
        accepted: result.accepted
      };
    },

async reloadFile(fileId) {
      const file = filesRegistry.getFile(fileId);
      if (!file) {
        return undefined;
      }

      if (readFile) {
        try {
          const result = await readFile(file.uri);
          if (result.success && onFileChanged) {
            onFileChanged(file, result.content);
          }
        } catch {
          // Failed to read file, continue with reset
        }
      }

      return filesRegistry.updateFile(fileId, {
        diskState: "inSync",
        dirtyVsDisk: false
      });
    },

    async acceptExternalChange(fileId) {
      const file = filesRegistry.getFile(fileId);
      if (!file) {
        return undefined;
      }
      return filesRegistry.updateFile(fileId, {
        diskState: "inSync",
        dirtyVsDisk: false
      });
    },

    async discardExternalChange(fileId) {
      const file = filesRegistry.getFile(fileId);
      if (!file) {
        return undefined;
      }
      return filesRegistry.updateFile(fileId, {
        diskState: "inSync",
        dirtyVsDisk: true
      });
    }
  };
}
