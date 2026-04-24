import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { FileWatcherService } from "../../contracts/files/FileWatcher";
import type { Plugin, PluginContext } from "../../contracts/plugin/Plugin";
import type { PluginManifestFile } from "../../contracts/plugin/PluginManifestFile";
import { ExtensionRegistry } from "./ExtensionRegistry";
import {
  createFileMediator,
  type BackendQueryExecutor,
  type FileBackendSync
} from "./FileMediator";
import type { PluginDiagnostics } from "./PluginDiagnostics";
import { PluginRegistry } from "./PluginRegistry";
import {
  orderPluginsByDependencies,
  validateDependencies,
  validateRequiredCapabilities
} from "./PluginValidation";

export type PluginHostState = {
  startedAt: string;
  loadedPluginIds: string[];
};

export type PluginHostOptions = {
  executeBackendQuery: BackendQueryExecutor;
  fileWatcher: FileWatcherService;
  backendSync?: FileBackendSync;
  onFileChanged?: (file: FileEntity, text: string) => void;
  writeFile?: (uri: string, text: string) => Promise<{ success: boolean }>;
  readFile?: (uri: string) => Promise<{ success: boolean; content: string }>;
  muteFileWatcherPath?: (uri: string, durationMs: number) => Promise<void>;
  resolveFileContent?: (fileId: string, uri: string) => string | undefined;
  showSaveDialog?: (options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ canceled: boolean; filePath?: string }>;
};

export class PluginHost {
  private readonly pluginRegistry = new PluginRegistry();
  private readonly extensionRegistry = new ExtensionRegistry();
  private readonly fileMediator: FileMediator;
  private readonly fileWatcher: FileWatcherService;
  private readonly activePlugins: Plugin[] = [];
  private startedAt: Date | null = null;
  private diagnostics: PluginDiagnostics = {
    discoveredManifestIds: [],
    activationOrder: [],
    providedCapabilities: [],
    pluginManifests: []
  };

  constructor(options: PluginHostOptions) {
    this.fileWatcher = options.fileWatcher;
    this.fileMediator = createFileMediator({
      filesRegistry: this.extensionRegistry.createFilesRegistry(),
      executeBackendQuery: options.executeBackendQuery,
      backendSync: options.backendSync,
      onFileChanged: options.onFileChanged,
      writeFile: options.writeFile,
      readFile: options.readFile,
      muteFileWatcherPath: options.muteFileWatcherPath,
      resolveFileContent: options.resolveFileContent,
      showSaveDialog: options.showSaveDialog
    });
  }

  public register(plugin: Plugin): void {
    this.pluginRegistry.register(plugin);
  }

  public async start(discoveredManifests: PluginManifestFile[] = []): Promise<void> {
    const allPlugins = this.pluginRegistry.all();
    validateDependencies(allPlugins);
    validateRequiredCapabilities(allPlugins);
    const orderedPlugins = orderPluginsByDependencies(allPlugins);

    const providedCapabilities = new Set<string>();
    for (const plugin of allPlugins) {
      for (const capability of plugin.manifest.providesCapabilities ?? []) {
        providedCapabilities.add(capability);
      }
    }

    this.diagnostics = {
      discoveredManifestIds: discoveredManifests.map((manifest) => manifest.id),
      activationOrder: orderedPlugins.map((plugin) => plugin.manifest.id),
      providedCapabilities: [...providedCapabilities].sort(),
      pluginManifests: discoveredManifests.map((manifest) => ({
        id: manifest.id,
        modulePath: manifest.modulePath,
        dependencies: manifest.dependencies ?? [],
        providesCapabilities: manifest.providesCapabilities ?? [],
        requiredCapabilities: manifest.requiredCapabilities ?? []
      }))
    };

    const context: PluginContext = {
      commands: this.extensionRegistry.createCommandRegistry(),
      filesystems: this.extensionRegistry.createFileSystemRegistry(),
      files: this.extensionRegistry.createFilesRegistry(),
      fileMediator: this.fileMediator,
      fileWatcher: this.fileWatcher,
      layout: this.extensionRegistry.createLayoutRegistry(),
      menu: this.extensionRegistry.createMenuRegistry(),
      keybindings: this.extensionRegistry.createKeybindingRegistry(),
      dialog: this.extensionRegistry.createDialogRegistry(),
      tooltip: this.extensionRegistry.createTooltipRegistry()
    };

    for (const plugin of orderedPlugins) {
      await plugin.activate(context);
      this.activePlugins.push(plugin);
    }

    this.startedAt = new Date();
  }

  public setExternalLoadErrors(
    errors: {
      pluginId: string;
      modulePath: string;
      message: string;
    }[]
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      externalLoadErrors: errors
    };
  }

  public async stop(): Promise<void> {
    for (const plugin of [...this.activePlugins].reverse()) {
      if (plugin.deactivate) {
        await plugin.deactivate();
      }
    }
    this.activePlugins.length = 0;
  }

  public getState(): PluginHostState {
    return {
      startedAt: this.startedAt?.toISOString() ?? "not-started",
      loadedPluginIds: this.activePlugins.map((plugin) => plugin.manifest.id)
    };
  }

  public getExtensions() {
    return this.extensionRegistry.snapshot();
  }

  public getFilesRegistry(): FilesRegistry {
    return this.extensionRegistry.createFilesRegistry();
  }

  public getFileMediator(): FileMediator {
    return this.fileMediator;
  }

  public getFileWatcher(): FileWatcherService {
    return this.fileWatcher;
  }

  public subscribeToFiles(subscriber: (files: FileEntity[]) => void): () => void {
    return this.extensionRegistry.subscribeToFiles(subscriber);
  }

  public async executeCommand(commandId: string) {
    return this.extensionRegistry.executeCommand(commandId);
  }

  public getDiagnostics(): PluginDiagnostics {
    return this.diagnostics;
  }
}
