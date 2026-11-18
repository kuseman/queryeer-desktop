import type {
  LayoutEditorContribution,
  LayoutRegistry,
  LayoutShellDefaults,
  LayoutStatusItemContribution,
  LayoutToolbarContribution,
  TabTitleContribution,
  TabHeaderStyleContribution,
  LayoutViewContribution,
  LayoutWelcomeContribution,
  TabContextMenuContribution,
  LayoutPanelContribution
} from "@queryeer/api/extensions/LayoutExtension";
import type { MenuItemContribution, MenuRegistry } from "@queryeer/api/extensions/MenuExtension";
import type { CommandExtension } from "@queryeer/api/commands/CommandExtension";
import type {
  KeybindingContribution,
  KeybindingRegistry
} from "@queryeer/api/commands/KeybindingExtension";
import type { FileSystemExtension } from "@queryeer/api/files/FileSystemExtension";
import type { TooltipSectionContribution } from "@queryeer/api/extensions/TooltipExtension";
import type {
  AdvancedSettingsRenderer,
  AdvancedSettingsValidator,
  SettingDefinition,
  SettingsContribution,
  SettingsContributionRegistry
} from "@queryeer/api/settings/SettingsExtension";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import type {
  CommandRegistry,
  DialogRegistry,
  FileSystemRegistry
} from "@queryeer/api/plugin/Plugin";
import type {
  QuickCommandProvider,
  QuickCommandRegistry
} from "@queryeer/api/extensions/QuickCommandExtension";
import type {
  OutlineProvider,
  OutlineProviderRegistration,
  OutlineRegistry,
  OutlineSymbol,
  SymbolKind
} from "@queryeer/api/extensions/OutlineExtension";
import type { ContextMenuProvider, ContextMenuRegistry } from "@queryeer/api/extensions/ContextMenuExtension";
import type {
  TableOutputContextMenuProvider,
  TableOutputContextMenuRegistry
} from "@queryeer/api/queryengine/TableOutputContextMenuExtension";
import type { EditorHandle, EditorRegistry, EditorRegistryHost, EditorContentRepository } from "@queryeer/api/editor/EditorCapability";
import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type {
  AssistantContextContribution,
  AssistantContextItem,
  AssistantContextRequest,
  AssistantRegistry,
  AssistantToolContribution,
  AssistantToolInvocation,
  AssistantToolResult
} from "@queryeer/api/assistant/Assistant";
import type { ContextValues } from "../../plugins/core.commands/context-values";
import { getExpressionRuntime } from "../../plugins/core.expressions/runtime";
import { CommandBus } from "./CommandBus";
import { FileRegistry } from "./FileRegistry";
import { pushDisposable, setDisposable, toDisposable } from "./disposables";

let outlineRegistryInstance: OutlineRegistry | undefined;
let editorRegistryInstance: EditorRegistryHost | undefined;
let contextMenuProvidersRef: ContextMenuProvider[] | null = null;
let tableOutputContextMenuProvidersRef: TableOutputContextMenuProvider[] | null = null;

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

export function getContextMenuProviders(): ContextMenuProvider[] {
  return contextMenuProvidersRef ?? [];
}

export function getTableOutputContextMenuProviders(): TableOutputContextMenuProvider[] {
  return tableOutputContextMenuProvidersRef ?? [];
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
    tabTitles: TabTitleContribution[];
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
    return pushDisposable(this.listeners, callback);
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

class AssistantRegistryImpl implements AssistantRegistry {
  private readonly contextContributions = new Map<string, AssistantContextContribution>();
  private readonly toolContributions = new Map<string, AssistantToolContribution>();

  registerContextContribution(contribution: AssistantContextContribution): Disposable {
    return setDisposable(this.contextContributions, contribution.id, contribution);
  }

  registerToolContribution(contribution: AssistantToolContribution): Disposable {
    return setDisposable(this.toolContributions, contribution.id, contribution);
  }

  async collectContext(request: AssistantContextRequest): Promise<AssistantContextItem[]> {
    const items: AssistantContextItem[] = [];
    for (const contribution of this.sorted(this.contextContributions.values())) {
      if (!isApplicable(contribution.when, request.contextValues)) {
        continue;
      }
      const collected = await contribution.collect(request);
      items.push(...collected);
    }
    return items;
  }

  listTools(request: AssistantContextRequest): AssistantToolContribution[] {
    return this.sorted(this.toolContributions.values())
      .filter((tool) => isApplicable(tool.when, request.contextValues));
  }

  async invokeTool(invocation: AssistantToolInvocation): Promise<AssistantToolResult> {
    const tool = this.toolContributions.get(invocation.toolId);
    if (!tool) {
      return { ok: false, message: `Assistant tool '${invocation.toolId}' is not registered` };
    }
    if (!isApplicable(tool.when, invocation.contextValues)) {
      return { ok: false, message: `Assistant tool '${invocation.toolId}' is not applicable` };
    }
    return tool.invoke(invocation);
  }

  private sorted<T extends { id: string; order?: number }>(values: Iterable<T>): T[] {
    return [...values].sort((left, right) => {
      const order = (left.order ?? 0) - (right.order ?? 0);
      return order !== 0 ? order : left.id.localeCompare(right.id);
    });
  }
}

function isApplicable(when: string | undefined, contextValues: Record<string, unknown>): boolean {
  const expression = when?.trim();
  if (!expression || expression === "global") {
    return true;
  }
  if (contextValues[expression] === true) {
    return true;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(expression)) {
    return false;
  }
  try {
    return getExpressionRuntime().evaluateBooleanSync(expression, contextValues, {
      mode: "when",
      source: `assistant:when:${expression}`,
      timeoutMs: 50
    });
  } catch (error) {
    console.error(`[ExpressionRuntime][assistant] when failed :: ${expression}`, error);
    return false;
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
  private readonly tabTitles = new Map<string, TabTitleContribution>();
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
  private readonly assistantRegistry = new AssistantRegistryImpl();
  private contextMenuProviders: ContextMenuProvider[] = [];
  private tableOutputContextMenuProviders: TableOutputContextMenuProvider[] = [];

  public constructor(getCommandContextValues?: () => ContextValues) {
    this.commandBus = new CommandBus(() => getCommandContextValues?.() ?? {});
    editorRegistryInstance = this.editorRegistryHost;
    contextMenuProvidersRef = this.contextMenuProviders;
    tableOutputContextMenuProvidersRef = this.tableOutputContextMenuProviders;
  }

  public createCommandRegistry(): CommandRegistry {
    return {
      registerCommand: (command) => {
        const registration = setDisposable(this.commands, command.id, command);
        const unregister = this.commandBus.register(command.id, command.handler, command.enablement);
        return toDisposable(() => {
          registration.dispose();
          unregister();
        });
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
      registerFileSystem: (filesystem) => setDisposable(this.filesystems, filesystem.id, filesystem)
    };
  }

  public createFilesRegistry(): FilesRegistry {
    return this.fileRegistry.createFilesRegistry();
  }

  public createMenuRegistry(): MenuRegistry {
    return {
      registerMenuItem: (contribution) => setDisposable(this.menuItems, contribution.id, contribution),
      rebuildMenu: async () => {
        await this.rebuildMenu();
        for (const callback of this.menuRebuildCallbacks) {
          await callback();
        }
      },
      onRebuild: (fn) => pushDisposable(this.menuRebuildCallbacks, fn)
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
        if (import.meta.env.DEV) {
          const key = contribution.key;
          if (/\bCtrl(?:\+|$)/.test(key) && !/\bCmdOrCtrl(?:\+|$)/.test(key)) {
            console.warn(
              `[ExtensionRegistry] Keybinding "${contribution.id}" uses "Ctrl" directly. ` +
              `Use "CmdOrCtrl" instead so the shortcut works on both Windows and macOS. ` +
              `Key: "${key}"`
            );
          }
          if (/\bCmd(?:\+|$)/.test(key) && !/\bCmdOrCtrl(?:\+|$)/.test(key)) {
            console.warn(
              `[ExtensionRegistry] Keybinding "${contribution.id}" uses "Cmd" directly. ` +
              `Use "CmdOrCtrl" instead so the shortcut works on both Windows and macOS. ` +
              `Key: "${key}"`
            );
          }
        }
        return setDisposable(this.keybindings, contribution.id, contribution);
      }
    };
  }

  public subscribeToFiles(subscriber: (files: FileEntity[]) => void): () => void {
    const subscription = this.fileRegistry.createFilesRegistry().subscribe(subscriber);
    return () => subscription.dispose();
  }

  public createLayoutRegistry(): LayoutRegistry {
    return {
      registerToolbarAction: (contribution) => setDisposable(this.layoutToolbarActions, contribution.id, contribution),
      registerStatusItem: (contribution) => setDisposable(this.layoutStatusItems, contribution.id, contribution),
      registerView: (contribution) => setDisposable(this.layoutViews, contribution.id, contribution),
      registerEditor: (contribution) => setDisposable(this.layoutEditors, contribution.id, contribution),
      registerWelcome: (contribution) => setDisposable(this.layoutWelcomes, contribution.id, contribution),
      registerTabContextMenu: (contribution) => setDisposable(this.tabContextMenus, contribution.id, contribution),
      registerTabHeaderStyle: (contribution) => setDisposable(this.tabHeaderStyles, contribution.id, contribution),
      registerTabTitle: (contribution) => setDisposable(this.tabTitles, contribution.id, contribution),
      registerPanel: (contribution) => setDisposable(this.layoutPanels, contribution.id, contribution),
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
      registerProvider: (provider) => pushDisposable(this.quickCommandProviders, provider)
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
        return setDisposable(providers, registration.mimeType, registration);
      },

      registerSupplementaryOutlineProvider: (registration) => {
        const list = supplementary.get(registration.mimeType) ?? [];
        supplementary.set(registration.mimeType, list);
        return pushDisposable(list, registration);
      },

      hasProvider: (mimeType: string) => providers.has(mimeType),

      getProvider: (mimeType: string) => providers.get(mimeType)?.provider,

      getSymbols: async (mimeType: string, content: string) => {
        const MAX_OUTLINE_CONTENT_LENGTH = 500_000;
        if (content.length > MAX_OUTLINE_CONTENT_LENGTH) {
          return [];
        }

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

  public createAssistantRegistry(): AssistantRegistry {
    return this.assistantRegistry;
  }

  public createContextMenuRegistry(): ContextMenuRegistry {
    return {
      registerProvider: (provider: ContextMenuProvider) => {
        const existing = this.contextMenuProviders.findIndex((p) => p.id === provider.id);
        if (existing !== -1) {
          console.warn(`Context menu provider '${provider.id}' already registered; overwriting.`);
          this.contextMenuProviders.splice(existing, 1, provider);
        } else {
          this.contextMenuProviders.push(provider);
        }
        return toDisposable(() => {
          const index = this.contextMenuProviders.indexOf(provider);
          if (index !== -1) {
            this.contextMenuProviders.splice(index, 1);
          }
        });
      },
      unregisterProvider: (id: string) => {
        const idx = this.contextMenuProviders.findIndex((p) => p.id === id);
        if (idx !== -1) {
          this.contextMenuProviders.splice(idx, 1);
        }
      }
    };
  }

  public createTableOutputContextMenuRegistry(): TableOutputContextMenuRegistry {
    return {
      registerProvider: (provider: TableOutputContextMenuProvider) => {
        const existing = this.tableOutputContextMenuProviders.findIndex((p) => p.id === provider.id);
        if (existing !== -1) {
          console.warn(`Table output context menu provider '${provider.id}' already registered; overwriting.`);
          this.tableOutputContextMenuProviders.splice(existing, 1, provider);
        } else {
          this.tableOutputContextMenuProviders.push(provider);
        }
        return {
          dispose: () => {
            const idx = this.tableOutputContextMenuProviders.indexOf(provider);
            if (idx !== -1) {
              this.tableOutputContextMenuProviders.splice(idx, 1);
            }
          }
        };
      },
      unregisterProvider: (id: string) => {
        const idx = this.tableOutputContextMenuProviders.findIndex((p) => p.id === id);
        if (idx !== -1) {
          this.tableOutputContextMenuProviders.splice(idx, 1);
        }
      }
    };
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
      },
      showValuePreview: async () => {
        return;
      },
      closeActiveValuePreview: () => {
        return false;
      }
    };
  }

  public createTooltipRegistry() {
    return {
      registerTooltipSection: (contribution: TooltipSectionContribution) =>
        setDisposable(this.tooltipSections, contribution.id, contribution),
      listTooltipSections: () => {
        return [...this.tooltipSections.values()];
      }
    };
  }

  public createSettingsRegistry(): SettingsContributionRegistry {
    return {
      registerSettings: (contribution) => {
        const ids = new Set<string>();
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
          if (this.settingsDefinitions.has(setting.id) || ids.has(setting.id)) {
            throw new Error(`Duplicate setting id '${setting.id}'`);
          }
          if (setting.type === "enum" && (!setting.options || setting.options.length === 0)) {
            throw new Error(`Setting '${setting.id}' is enum but has no options`);
          }
          ids.add(setting.id);
        }
        // Validated first, so a contribution that throws leaves nothing behind
        const definitions = contribution.settings.map((setting) => setDisposable(this.settingsDefinitions, setting.id, setting));
        const registration = setDisposable(this.settingsContributions, contribution.moduleId, contribution);
        return toDisposable(() => {
          registration.dispose();
          for (const definition of definitions) {
            definition.dispose();
          }
        });
      },
      registerAdvancedRenderer: (renderer) => setDisposable(this.advancedSettingsRenderers, renderer.id, renderer),
      registerAdvancedValidator: (validator) => setDisposable(this.advancedSettingsValidators, validator.id, validator),
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
        tabTitles: [...this.tabTitles.values()],
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
