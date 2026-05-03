import type {
  LayoutEditorContribution,
  LayoutRegistry,
  LayoutShellDefaults,
  LayoutStatusItemContribution,
  LayoutToolbarContribution,
  TabHeaderStyleContribution,
  LayoutViewContribution,
  LayoutWelcomeContribution,
  TabContextMenuContribution,
  LayoutPanelContribution
} from "../../contracts/extensions/LayoutExtension";
import type { MenuItemContribution, MenuRegistry } from "../../contracts/extensions/MenuExtension";
import type { CommandExtension } from "../../contracts/extensions/CommandExtension";
import type {
  KeybindingContribution,
  KeybindingRegistry
} from "../../contracts/extensions/KeybindingExtension";
import type { FileSystemExtension } from "../../contracts/extensions/FileSystemExtension";
import type { TooltipSectionContribution } from "../../contracts/extensions/TooltipExtension";
import type {
  AdvancedSettingsRenderer,
  AdvancedSettingsValidator,
  SettingDefinition,
  SettingsContribution,
  SettingsRegistry
} from "../../contracts/extensions/SettingsExtension";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type {
  CommandRegistry,
  DialogRegistry,
  FileSystemRegistry
} from "../../contracts/plugin/Plugin";
import type {
  QuickCommandProvider,
  QuickCommandRegistry
} from "../../contracts/extensions/QuickCommandExtension";
import type {
  OutlineProvider,
  OutlineProviderRegistration,
  OutlineRegistry,
  OutlineSymbol,
  SymbolKind
} from "../../contracts/extensions/OutlineExtension";
import type { EditorHandle, EditorRegistry, EditorRegistryHost, EditorContentRepository } from "../../contracts/editor/EditorCapability";
import type { Disposable } from "../../contracts/editor/EditorApi";
import type { ContextValues } from "../../plugins/core.commands/when-evaluator";
import { CommandBus } from "./CommandBus";
import { FileRegistry } from "./FileRegistry";

let outlineRegistryInstance: OutlineRegistry | undefined;
let editorRegistryInstance: EditorRegistryHost | undefined;

export function getOutlineRegistry(): OutlineRegistry {
  if (!outlineRegistryInstance) {
    throw new Error("OutlineRegistry not initialized");
  }
  return outlineRegistryInstance;
}

export function setOutlineRegistry(registry: OutlineRegistry): void {
  outlineRegistryInstance = registry;
}

export function getEditorRegistryHost(): EditorRegistryHost {
  if (!editorRegistryInstance) {
    throw new Error("EditorRegistryHost not initialized");
  }
  return editorRegistryInstance;
}

export type ExtensionSnapshot = {
  commands: CommandExtension[];
  filesystems: FileSystemExtension[];
  files: FileEntity[];
  menu: {
    items: MenuItemContribution[];
  };
  keybindings: KeybindingContribution[];
  layout: {
    toolbarActions: LayoutToolbarContribution[];
    statusItems: LayoutStatusItemContribution[];
    views: LayoutViewContribution[];
    editors: LayoutEditorContribution[];
    welcomes: LayoutWelcomeContribution[];
    tabContextMenus: TabContextMenuContribution[];
    tabHeaderStyles: TabHeaderStyleContribution[];
    panels: LayoutPanelContribution[];
    shellDefaults: LayoutShellDefaults;
  };
  tooltip: {
    sections: TooltipSectionContribution[];
  };
  settings: {
    contributions: SettingsContribution[];
    definitions: SettingDefinition[];
    advancedRendererIds: string[];
    advancedValidatorIds: string[];
  };
};

const DEFAULT_SHELL_DEFAULTS: LayoutShellDefaults = {
  visibleZones: [
    "menuBar",
    "toolBar",
    "statusBar",
    "primarySidebar",
    "mainArea"
  ],
  sidebarWidths: {
    primary: 280,
    secondary: 320
  },
  statusBarHeight: 24
};

class EditorRegistryHostImpl implements EditorRegistryHost {
  private activeEditor: EditorHandle | null = null;
  private readonly listeners: Array<(editor: EditorHandle | null) => void> = [];
  private readonly contentRepositories: EditorContentRepository[] = [];

  setActiveEditor(handle: EditorHandle | null): void {
    this.activeEditor = handle;
    for (const listener of this.listeners) {
      listener(handle);
    }
  }

  getActiveEditor(): EditorHandle | null {
    return this.activeEditor;
  }

  onActiveEditorChanged(callback: (editor: EditorHandle | null) => void): Disposable {
    this.listeners.push(callback);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(callback);
        if (idx !== -1) this.listeners.splice(idx, 1);
      }
    };
  }

  registerContentRepository(repo: EditorContentRepository): () => void {
    this.contentRepositories.push(repo);
    return () => {
      const idx = this.contentRepositories.indexOf(repo);
      if (idx !== -1) this.contentRepositories.splice(idx, 1);
    };
  }

  resolveFileContent(fileId: string, uri: string): string | undefined {
    for (const repo of this.contentRepositories) {
      const model = repo.getModelForFile(fileId) ?? repo.getModelForUri(uri);
      if (model) {
        return model.getContent();
      }
    }
    return undefined;
  }

  broadcastContentUpdate(uri: string, content: string): void {
    for (const repo of this.contentRepositories) {
      repo.updateModelContent(uri, content);
    }
  }

  applyRecoveredContent(fileId: string, content: string): void {
    for (const repo of this.contentRepositories) {
      repo.applyRecoveredContent(fileId, content);
    }
  }

  onContentDirty(listener: (fileId: string, text: string) => void): () => void {
    const disposables: (() => void)[] = [];
    for (const repo of this.contentRepositories) {
      disposables.push(repo.onContentDirty(listener));
    }
    return () => {
      for (const disposable of disposables) {
        disposable();
      }
    };
  }
}

export class ExtensionRegistry {
  private readonly commandBus: CommandBus;
  private readonly commands = new Map<string, CommandExtension>();
  private readonly filesystems = new Map<string, FileSystemExtension>();
  private readonly menuItems = new Map<string, MenuItemContribution>();
  private readonly menuRebuildCallbacks: (() => Promise<void>)[] = [];
  private readonly keybindings = new Map<string, KeybindingContribution>();
  private readonly layoutToolbarActions = new Map<string, LayoutToolbarContribution>();
  private readonly layoutStatusItems = new Map<string, LayoutStatusItemContribution>();
  private readonly layoutViews = new Map<string, LayoutViewContribution>();
  private readonly layoutEditors = new Map<string, LayoutEditorContribution>();
  private readonly layoutWelcomes = new Map<string, LayoutWelcomeContribution>();
  private readonly tabContextMenus = new Map<string, TabContextMenuContribution>();
  private readonly tabHeaderStyles = new Map<string, TabHeaderStyleContribution>();
  private readonly layoutPanels = new Map<string, LayoutPanelContribution>();
  private readonly tooltipSections = new Map<string, TooltipSectionContribution>();
  private readonly settingsContributions = new Map<string, SettingsContribution>();
  private readonly settingsDefinitions = new Map<string, SettingDefinition>();
  private readonly advancedSettingsRenderers = new Map<string, AdvancedSettingsRenderer>();
  private readonly advancedSettingsValidators = new Map<string, AdvancedSettingsValidator>();
  private shellDefaults: LayoutShellDefaults = DEFAULT_SHELL_DEFAULTS;
  private readonly fileRegistry = new FileRegistry({
    getEditors: () => [...this.layoutEditors.values()]
  });
  private readonly quickCommandProviders: QuickCommandProvider[] = [];
  private readonly outlineProviders = new Map<string, OutlineProviderRegistration>();
  private readonly supplementaryOutlineProviders = new Map<string, OutlineProviderRegistration[]>();
  private readonly editorRegistryHost = new EditorRegistryHostImpl();

  public constructor(getCommandContextValues?: () => ContextValues) {
    this.commandBus = new CommandBus(() => getCommandContextValues?.() ?? {});
    editorRegistryInstance = this.editorRegistryHost;
  }

  public createCommandRegistry(): CommandRegistry {
    return {
      registerCommand: (command) => {
        this.commands.set(command.id, command);
        this.commandBus.register(command.id, command.handler, command.enablement);
      },
      executeCommand: async (commandId) => {
        return this.commandBus.execute(commandId);
      },
      canExecuteCommand: (commandId) => {
        return this.commandBus.canExecute(commandId);
      }
    };
  }

  public canExecuteCommand(commandId: string): boolean {
    return this.commandBus.canExecute(commandId);
  }

  public createFileSystemRegistry(): FileSystemRegistry {
    return {
      registerFileSystem: (filesystem) => {
        this.filesystems.set(filesystem.id, filesystem);
      }
    };
  }

  public createFilesRegistry(): FilesRegistry {
    return this.fileRegistry.createFilesRegistry();
  }

  public createMenuRegistry(): MenuRegistry {
    return {
      registerMenuItem: (contribution) => {
        this.menuItems.set(contribution.id, contribution);
      },
      rebuildMenu: async () => {
        await this.rebuildMenu();
        for (const callback of this.menuRebuildCallbacks) {
          await callback();
        }
      },
      onRebuild: (fn) => {
        this.menuRebuildCallbacks.push(fn);
      }
    };
  }

  public async rebuildMenu(): Promise<void> {
    try {
      const dynamicItems: MenuItemContribution[] = [];
      for (const contribution of this.menuItems.values()) {
        if (contribution.dynamicItems) {
          const parentId = contribution.id;
          for (const item of this.menuItems.values()) {
            if (item._generatedBy === parentId) {
              this.menuItems.delete(item.id);
            }
          }
        }
      }
      for (const contribution of this.menuItems.values()) {
        if (contribution.dynamicItems) {
          const items = await contribution.dynamicItems();
          for (const item of items) {
            dynamicItems.push({ ...item, _generatedBy: contribution.id });
          }
        }
      }
      for (const item of dynamicItems) {
        this.menuItems.set(item.id, item);
      }
    } catch {
      // best effort - ignore dynamic menu errors
    }

    for (const callback of this.menuRebuildCallbacks) {
      try {
        await callback();
      } catch {
        // best effort - ignore rebuild callback errors
      }
    }
  }

  public createKeybindingRegistry(): KeybindingRegistry {
    return {
      registerKeybinding: (contribution) => {
        this.keybindings.set(contribution.id, contribution);
      }
    };
  }

  public subscribeToFiles(subscriber: (files: FileEntity[]) => void): () => void {
    return this.fileRegistry.createFilesRegistry().subscribe(subscriber);
  }

  public createLayoutRegistry(): LayoutRegistry {
    return {
      registerToolbarAction: (contribution) => {
        this.layoutToolbarActions.set(contribution.id, contribution);
      },
      registerStatusItem: (contribution) => {
        this.layoutStatusItems.set(contribution.id, contribution);
      },
      registerView: (contribution) => {
        this.layoutViews.set(contribution.id, contribution);
      },
      registerEditor: (contribution) => {
        this.layoutEditors.set(contribution.id, contribution);
      },
      registerWelcome: (contribution) => {
        this.layoutWelcomes.set(contribution.id, contribution);
      },
      registerTabContextMenu: (contribution) => {
        this.tabContextMenus.set(contribution.id, contribution);
      },
      registerTabHeaderStyle: (contribution) => {
        this.tabHeaderStyles.set(contribution.id, contribution);
      },
      registerPanel: (contribution) => {
        this.layoutPanels.set(contribution.id, contribution);
      },
      setShellDefaults: (defaults) => {
        this.shellDefaults = {
          ...this.shellDefaults,
          ...defaults,
          sidebarWidths: {
            ...this.shellDefaults.sidebarWidths,
            ...defaults.sidebarWidths
          }
        };
      }
    };
  }

  public createQuickCommandRegistry(): QuickCommandRegistry {
    return {
      registerProvider: (provider) => {
        this.quickCommandProviders.push(provider);
      }
    };
  }

  public getQuickCommandProviders(): QuickCommandProvider[] {
    return this.quickCommandProviders;
  }

  public createOutlineRegistry(): OutlineRegistry {
    const providers = this.outlineProviders;
    const supplementary = this.supplementaryOutlineProviders;

    const runProvider = async (
      provider: OutlineProvider,
      content: string
    ): Promise<OutlineSymbol[]> => {
      const result = provider(content);
      return Array.isArray(result) ? result : await result;
    };

    const registry: OutlineRegistry = {
      registerOutlineProvider: (registration) => {
        if (providers.has(registration.mimeType)) {
          console.warn(
            `Outline provider for '${registration.mimeType}' already registered; overwriting.`
          );
        }
        providers.set(registration.mimeType, registration);
      },

      registerSupplementaryOutlineProvider: (registration) => {
        const list = supplementary.get(registration.mimeType) ?? [];
        list.push(registration);
        supplementary.set(registration.mimeType, list);
      },

      hasProvider: (mimeType: string) => providers.has(mimeType),

      getProvider: (mimeType: string) => providers.get(mimeType)?.provider,

      getSymbols: async (mimeType: string, content: string) => {
        const mainResult = providers.has(mimeType)
          ? await runProvider(providers.get(mimeType)!.provider, content).catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              return [{
                id: `${mimeType}:error:0`,
                name: "Parse Error",
                detail: message,
                kind: "Event" as SymbolKind,
                range: { startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 },
                selectionRange: { startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 }
              }];
            })
          : [];

        const supps = supplementary.get(mimeType) ?? [];
        const suppResults: OutlineSymbol[] = [];
        for (const reg of supps) {
          try {
            const result = await runProvider(reg.provider, content);
            suppResults.push(...result);
          } catch {
            // Supplementary provider failures are silently ignored
          }
        }

        const mainIds = new Set(mainResult.map((s: OutlineSymbol) => s.id));
        const merged = [
          ...suppResults.filter((s: OutlineSymbol) => !mainIds.has(s.id)),
          ...mainResult
        ];

        return merged;
      }
    };

    outlineRegistryInstance = registry;
    return registry;
  }

  public getEditorRegistryHost(): EditorRegistryHost {
    return this.editorRegistryHost;
  }

  public createEditorRegistry(): EditorRegistry {
    return this.editorRegistryHost;
  }

  public createDialogRegistry(): DialogRegistry {
    return {
      showMessage: async () => {
        return { action: "" };
      },
      showOpenDialog: async () => {
        return { canceled: true, filePaths: [] };
      },
      showOpenFolder: async () => {
        return { canceled: true, folderPath: undefined };
      },
      showSaveDialog: async () => {
        return { canceled: true, filePath: undefined };
      },
      showInputDialog: async () => {
        return { canceled: true, value: undefined };
      }
    };
  }

  public createTooltipRegistry() {
    return {
      registerTooltipSection: (contribution: TooltipSectionContribution) => {
        this.tooltipSections.set(contribution.id, contribution);
      }
    };
  }

  public createSettingsRegistry(): SettingsRegistry {
    return {
      registerSettings: (contribution) => {
        for (const setting of contribution.settings) {
          if (setting.moduleId !== contribution.moduleId) {
            throw new Error(
              `Setting '${setting.id}' must have moduleId '${contribution.moduleId}'`
            );
          }
          if (!setting.id.startsWith(`${contribution.moduleId}.`)) {
            throw new Error(
              `Setting id '${setting.id}' must start with '${contribution.moduleId}.'`
            );
          }
          if (this.settingsDefinitions.has(setting.id)) {
            throw new Error(`Duplicate setting id '${setting.id}'`);
          }
          if (setting.type === "enum" && (!setting.options || setting.options.length === 0)) {
            throw new Error(`Setting '${setting.id}' is enum but has no options`);
          }
          this.settingsDefinitions.set(setting.id, setting);
        }
        this.settingsContributions.set(contribution.moduleId, contribution);
      },
      registerAdvancedRenderer: (renderer) => {
        this.advancedSettingsRenderers.set(renderer.id, renderer);
      },
      registerAdvancedValidator: (validator) => {
        this.advancedSettingsValidators.set(validator.id, validator);
      },
      listSettingsContributions: () => [...this.settingsContributions.values()],
      listSettingsDefinitions: () => [...this.settingsDefinitions.values()],
      getAdvancedRenderer: (id) => this.advancedSettingsRenderers.get(id),
      getAdvancedValidator: (id) => this.advancedSettingsValidators.get(id)
    };
  }

  public snapshot(): ExtensionSnapshot {
    return {
      commands: [...this.commands.values()],
      filesystems: [...this.filesystems.values()],
      files: this.fileRegistry.snapshot(),
menu: {
      items: [...this.menuItems.values()],
      onRebuild: (fn: () => Promise<void>) => {
        this.menuRebuildCallbacks.push(fn);
      }
    } as { items: MenuItemContribution[]; onRebuild: (fn: () => Promise<void>) => void },
      keybindings: [...this.keybindings.values()],
      layout: {
        toolbarActions: [...this.layoutToolbarActions.values()],
        statusItems: [...this.layoutStatusItems.values()],
        views: [...this.layoutViews.values()],
        editors: [...this.layoutEditors.values()],
        welcomes: [...this.layoutWelcomes.values()],
        tabContextMenus: [...this.tabContextMenus.values()],
        tabHeaderStyles: [...this.tabHeaderStyles.values()],
        panels: [...this.layoutPanels.values()],
        shellDefaults: this.shellDefaults
      },
      tooltip: {
        sections: [...this.tooltipSections.values()]
      },
      settings: {
        contributions: [...this.settingsContributions.values()],
        definitions: [...this.settingsDefinitions.values()],
        advancedRendererIds: [...this.advancedSettingsRenderers.keys()],
        advancedValidatorIds: [...this.advancedSettingsValidators.keys()]
      }
    };
  }

  public async executeCommand(commandId: string) {
    return this.commandBus.execute(commandId);
  }
}
