import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { FileMediator } from "@queryeer/api/files/FileMediator";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import type { FileWatcherService } from "@queryeer/api/files/FileWatcher";
import type { ComponentType } from "react";
import type { Plugin, PluginContext } from "@queryeer/api/plugin/Plugin";
import type { FrameworkEditorProps } from "@queryeer/api/editor/EditorCapability";
import type { PluginManifestFile } from "@queryeer/api/plugin/PluginManifestFile";
import { ExtensionRegistry } from "./ExtensionRegistry";
import {
  createFileMediator,
  type FileBackendSync
} from "./FileMediator";
import type { PluginDiagnostics, PluginProblem } from "./PluginDiagnostics";
import type { PluginManifest } from "@queryeer/api/plugin/PluginManifest";
import { PluginRegistry } from "./PluginRegistry";
import type { ContextValues } from "../../plugins/core.commands/context-values";
import { planActivation } from "./PluginValidation";
import { getFileStateRegistry } from "./FileStateRegistryImpl";
import { getJdbcTreeContextMenuRegistry } from "../../plugins/core.queryengine.jdbc/jdbc-tree-context-menu-registry";
import { createJdbcDialectRegistry } from "../../plugins/core.queryengine.jdbc/jdbc-dialect-registry";
import { createJdbcTreeActionRegistry } from "../../plugins/core.queryengine.jdbc/tree-action-template-registry";
import { createSymbolActionRegistry } from "../../plugins/core.queryengine/symbol-action-template-registry";
import { createWhenExpressionRegistry } from "../../plugins/core.commands/when-expression-variable-registry";
import { getGraphNodeTypeRegistry } from "../../plugins/core.graph/graph-node-type-registry";
import { registerChangelog } from "../../plugins/core.about/about-service.js";
import { toDisposable } from "./disposables";
import { attributeContext, ContributionOwnership, type ContributionOwners } from "./ContributionOwnership";
import { getNotificationService } from "../../plugins/core.notification/notification-service";
import { createPayloadbuilderCatalogRegistry } from "../../plugins/core.queryengine.payloadbuilder/catalog-contributions";
import { JdbcDriverRegistryHost } from "../../renderer/plugins/jdbc-driver-registry";
import type {
  JdbcDriverSubscriber,
  RegisteredJdbcManagedDriverContribution
} from "@queryeer/api/queryengine/JdbcDriverExtension";
import { createNativeQueryEngineRegistry } from "../../plugins/core.queryengine/engine-registration";
import {
  getAllEffectiveSettings,
  getEffectiveSetting,
  openCoreSettings,
  dropPendingCoreSettingsTasks,
  readCoreSettingsModuleValues,
  refreshCoreSettingsRegistry,
  runCoreSettingsOnce,
  setCoreSetting,
  subscribeEffectiveSettings
} from "../../plugins/core.settings/service";
import { PasswordFieldInput } from "../../plugins/core.settings/PasswordFieldInput";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../../plugins/core.settings/CollectionSettingsListEditor";
import { registerMonacoLanguageIdForMimeType } from "../../plugins/core.editor/texteditor/mime-types";
import { registerEditorLanguage } from "../../plugins/core.editor/texteditor/editor-languages";
import { editorLanguageFeatures } from "../../plugins/core.editor/texteditor/editor-language-features";

/** Dependencies as shown in Observability: `id`, or `id (optional)`. */
function describeDependencies(dependencies: PluginManifest["dependencies"]): string[] {
  return (Array.isArray(dependencies) ? dependencies : []).map((entry) =>
    typeof entry === "string" ? entry : entry && typeof entry === "object" ? `${entry.id}${entry.optional ? " (optional)" : ""}` : String(entry)
  );
}

export type PluginHostState = {
  startedAt: string;
  loadedPluginIds: string[];
};

export type PluginHostOptions = {
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
  getCommandContextValues?: () => ContextValues;
  frameworkEditor?: ComponentType<FrameworkEditorProps>;
};

export class PluginHost {
  private readonly options: PluginHostOptions;
  private readonly pluginRegistry = new PluginRegistry();
  private readonly extensionRegistry: ExtensionRegistry;
  private readonly fileMediator: FileMediator;
  private readonly fileWatcher: FileWatcherService;
  private readonly activePlugins: Plugin[] = [];
  private readonly contributionOwnership = new ContributionOwnership();
  private readonly jdbcDriverRegistry = new JdbcDriverRegistryHost();
  private startedAt: Date | null = null;
  private diagnostics: PluginDiagnostics = {
    discoveredManifestIds: [],
    activationOrder: [],
    providedCapabilities: [],
    pluginManifests: []
  };

  constructor(options: PluginHostOptions) {
    this.options = options;
    this.extensionRegistry = new ExtensionRegistry(options.getCommandContextValues);
    this.fileWatcher = options.fileWatcher;
    this.fileMediator = createFileMediator({
      filesRegistry: this.extensionRegistry.createFilesRegistry(),
      backendSync: options.backendSync,
      onFileChanged: options.onFileChanged,
      writeFile: options.writeFile,
      readFile: options.readFile,
      muteFileWatcherPath: options.muteFileWatcherPath,
      resolveFileContent: options.resolveFileContent,
      seedFileContent: (fileId, content) => {
        this.extensionRegistry.getEditorRegistryHost().applyRecoveredContent(fileId, content);
      },
      showSaveDialog: options.showSaveDialog
    });
  }

  public register(plugin: Plugin): void {
    this.pluginRegistry.register(plugin);
  }

  /**
   * Activates the registered plugins in dependency order. One plugin never stops the others: a plugin that can't be
   * activated (see `planActivation`) is skipped, one whose `activate` throws is marked failed, and plugins that require
   * it are skipped. All of them are listed in `getDiagnostics().pluginProblems`.
   */
  public async start(discoveredManifests: PluginManifestFile[] = []): Promise<void> {
    const allPlugins = this.pluginRegistry.all();
    const plan = planActivation(allPlugins);
    const problems: PluginProblem[] = [];
    for (const [pluginId, reason] of plan.skipped) {
      problems.push({ pluginId, state: "skipped", message: reason });
    }
    for (const [pluginId, messages] of plan.warnings) {
      for (const message of messages) {
        problems.push({ pluginId, state: "warning", message });
      }
    }

    this.diagnostics = {
      discoveredManifestIds: discoveredManifests.map((manifest) => manifest.id),
      activationOrder: [],
      providedCapabilities: [],
      pluginManifests: discoveredManifests.map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        kind: manifest.kind,
        ...(manifest.description !== undefined ? { description: manifest.description } : {}),
        modulePath: manifest.modulePath,
        dependencies: describeDependencies(manifest.dependencies),
        providesCapabilities: manifest.providesCapabilities ?? [],
        requiredCapabilities: manifest.requiredCapabilities ?? []
      })),
      pluginProblems: problems
    };

    const settingsContributions = this.extensionRegistry.createSettingsRegistry();
    const sharedContext: Omit<PluginContext, "jdbcDrivers" | "plugin" | "isDependencyActive"> = {
      commands: this.extensionRegistry.createCommandRegistry(),
      filesystems: this.extensionRegistry.createFileSystemRegistry(),
      files: this.extensionRegistry.createFilesRegistry(),
      fileState: getFileStateRegistry(),
      fileMediator: this.fileMediator,
      fileWatcher: this.fileWatcher,
      layout: this.extensionRegistry.createLayoutRegistry(),
      menu: this.extensionRegistry.createMenuRegistry(),
      keybindings: this.extensionRegistry.createKeybindingRegistry(),
      dialog: this.extensionRegistry.createDialogRegistry(),
      tooltip: this.extensionRegistry.createTooltipRegistry(),
      settings: {
        ...settingsContributions,
        registerSettings: (contribution) => {
          const registration = settingsContributions.registerSettings(contribution);
          refreshCoreSettingsRegistry();
          return toDisposable(() => {
            registration.dispose();
            refreshCoreSettingsRegistry();
          });
        },
        getValue: getEffectiveSetting,
        getAllValues: getAllEffectiveSettings,
        subscribe: (listener) => toDisposable(subscribeEffectiveSettings(listener)),
        open: openCoreSettings,
        setValue: setCoreSetting,
        readModuleValues: readCoreSettingsModuleValues,
        runOnce: () => {
          throw new Error("runOnce is per plugin");
        }
      },
      quickcommand: this.extensionRegistry.createQuickCommandRegistry(),
      outline: this.extensionRegistry.createOutlineRegistry(),
      editors: this.extensionRegistry.createEditorRegistry(),
      contextMenu: this.extensionRegistry.createContextMenuRegistry(),
      tableOutputContextMenu: this.extensionRegistry.createTableOutputContextMenuRegistry(),
      jdbcTreeContextMenu: getJdbcTreeContextMenuRegistry(),
      jdbcDialects: createJdbcDialectRegistry(),
      jdbcTreeActions: createJdbcTreeActionRegistry(),
      symbolActions: createSymbolActionRegistry(),
      whenExpressions: createWhenExpressionRegistry(),
      graphNodeTypes: getGraphNodeTypeRegistry(),
      about: { registerChangelog },
      notifications: getNotificationService(),
      assistant: this.extensionRegistry.createAssistantRegistry(),
      queryEngines: createNativeQueryEngineRegistry(this.extensionRegistry.createFilesRegistry()),
      payloadbuilderCatalog: createPayloadbuilderCatalogRegistry(),
      editorLanguages: {
        registerMimeType: registerMonacoLanguageIdForMimeType,
        registerLanguage: registerEditorLanguage,
        ...editorLanguageFeatures
      },
      components: {
        FrameworkEditor: this.options.frameworkEditor ?? (() => null) as unknown as ComponentType<FrameworkEditorProps>,
        PasswordFieldInput,
        CollectionSettingsListEditor,
        useCollectionSettingsPersistence
      }
    };

    const activationDurations: Record<string, number> = {};
    const activatedIds = new Set<string>();
    const notActivatedIds = new Set<string>();
    const failedIds = new Set<string>();
    const providedCapabilities = new Set<string>();
    // Capabilities don't order activation, so a capability is gone only once every planned provider didn't activate
    const providersOf = new Map<string, string[]>();
    for (const plugin of plan.order) {
      for (const capability of plan.capabilities.get(plugin.manifest.id)?.provides ?? []) {
        providersOf.set(capability, [...(providersOf.get(capability) ?? []), plugin.manifest.id]);
      }
    }
    for (const plugin of plan.order) {
      const pluginId = plugin.manifest.id;
      // A dependency or capability provider that failed to activate leaves this plugin without it
      const failedDependency = (plan.requiredDependencies.get(pluginId) ?? []).find((dependencyId) => !activatedIds.has(dependencyId));
      const missingCapability = (plan.capabilities.get(pluginId)?.requires ?? []).find((capability) =>
        (providersOf.get(capability) ?? []).every((providerId) => providerId !== pluginId && notActivatedIds.has(providerId))
      );
      if (failedDependency !== undefined || missingCapability !== undefined) {
        problems.push({
          pluginId,
          state: "skipped",
          message:
            failedDependency !== undefined
              ? `Dependency ${failedDependency} ${failedIds.has(failedDependency) ? "failed to activate" : "was skipped"}`
              : `Requires capability '${missingCapability}', whose providers failed to activate`
        });
        notActivatedIds.add(pluginId);
        continue;
      }
      const activeDependencies = new Set([...(plan.dependencies.get(pluginId) ?? [])].filter((dependencyId) => activatedIds.has(dependencyId)));
      const context: PluginContext = attributeContext({
        ...sharedContext,
        plugin: Object.freeze({
          id: pluginId,
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          ...(plugin.manifest.description !== undefined ? { description: plugin.manifest.description } : {})
        }),
        isDependencyActive: (dependencyId: string) => activeDependencies.has(dependencyId),
        // One-time task ids are per plugin
        settings: { ...sharedContext.settings, runOnce: (id, run) => runCoreSettingsOnce(`${pluginId}/${id}`, run) },
        jdbcDrivers: this.jdbcDriverRegistry.createRegistry(pluginId)
      }, pluginId, this.contributionOwnership);
      const activationStart = performance.now();
      try {
        await plugin.activate(context);
        activationDurations[pluginId] = performance.now() - activationStart;
      } catch (error) {
        activationDurations[pluginId] = performance.now() - activationStart;
        // What the plugin registered before it failed stays registered
        console.error(`[plugins] ${pluginId} failed to activate`, error);
        problems.push({ pluginId, state: "failed", message: error instanceof Error ? error.message : String(error) });
        notActivatedIds.add(pluginId);
        failedIds.add(pluginId);
        // Its one-time tasks (e.g. a migration into settings it no longer registers) don't run
        dropPendingCoreSettingsTasks(`${pluginId}/`);
        // Let it undo what it registered before it threw
        try {
          await plugin.deactivate?.();
        } catch (deactivateError) {
          console.error(`[plugins] ${pluginId} failed to deactivate after failing to activate`, deactivateError);
        }
        continue;
      }
      this.activePlugins.push(plugin);
      activatedIds.add(pluginId);
      for (const capability of plan.capabilities.get(pluginId)?.provides ?? []) {
        providedCapabilities.add(capability);
      }
    }

    this.diagnostics = {
      ...this.diagnostics,
      activationOrder: this.activePlugins.map((plugin) => plugin.manifest.id),
      providedCapabilities: [...providedCapabilities].sort(),
      activationDurations
    };
    this.startedAt = new Date();
  }

  /** Plugins that were skipped or failed to activate, and warnings for those that activated. */
  public getPluginProblems(): readonly PluginProblem[] {
    return this.diagnostics.pluginProblems ?? [];
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
        try {
          await plugin.deactivate();
        } catch (error) {
          console.error(`[plugins] ${plugin.manifest.id} failed to deactivate`, error);
        }
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

  public async rebuildMenu(): Promise<void> {
    return this.extensionRegistry.rebuildMenu();
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

  public getJdbcDrivers(): readonly RegisteredJdbcManagedDriverContribution[] {
    return this.jdbcDriverRegistry.listDrivers();
  }

  public getJdbcDriver(dialectId: string): RegisteredJdbcManagedDriverContribution | undefined {
    return this.jdbcDriverRegistry.getDriver(dialectId);
  }

  public subscribeToJdbcDrivers(subscriber: JdbcDriverSubscriber): () => void {
    const subscription = this.jdbcDriverRegistry.subscribe(subscriber);
    return () => subscription.dispose();
  }

  public subscribeToFiles(subscriber: (files: FileEntity[]) => void): () => void {
    return this.extensionRegistry.subscribeToFiles(subscriber);
  }

  public getQuickCommandProviders() {
    return this.extensionRegistry.getQuickCommandProviders();
  }

  public async executeCommand(commandId: string) {
    return this.extensionRegistry.executeCommand(commandId);
  }

  public canExecuteCommand(commandId: string): boolean {
    return this.extensionRegistry.canExecuteCommand(commandId);
  }

  public getDiagnostics(): PluginDiagnostics {
    return this.diagnostics;
  }

  /** Which plugin registered each contribution. */
  public getContributionOwners(): ContributionOwners {
    return this.contributionOwnership;
  }
}
