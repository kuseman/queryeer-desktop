import type {
  LayoutEditorContribution,
  LayoutRegistry,
  LayoutShellDefaults,
  LayoutStatusItemContribution,
  LayoutToolbarActionContribution,
  TabHeaderStyleContribution,
  LayoutViewContribution,
  LayoutWelcomeContribution,
  TabContextMenuContribution
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
import type { ContextValues } from "../../plugins/core.commands/when-evaluator";
import { CommandBus } from "./CommandBus";
import { FileRegistry } from "./FileRegistry";

export type ExtensionSnapshot = {
  commands: CommandExtension[];
  filesystems: FileSystemExtension[];
  files: FileEntity[];
  menu: {
    items: MenuItemContribution[];
  };
  keybindings: KeybindingContribution[];
  layout: {
    toolbarActions: LayoutToolbarActionContribution[];
    statusItems: LayoutStatusItemContribution[];
    views: LayoutViewContribution[];
    editors: LayoutEditorContribution[];
    welcomes: LayoutWelcomeContribution[];
    tabContextMenus: TabContextMenuContribution[];
    tabHeaderStyles: TabHeaderStyleContribution[];
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

export class ExtensionRegistry {
  private readonly commandBus: CommandBus;
  private readonly commands = new Map<string, CommandExtension>();
  private readonly filesystems = new Map<string, FileSystemExtension>();
  private readonly menuItems = new Map<string, MenuItemContribution>();
  private readonly menuRebuildCallbacks: (() => Promise<void>)[] = [];
  private readonly keybindings = new Map<string, KeybindingContribution>();
  private readonly layoutToolbarActions = new Map<string, LayoutToolbarActionContribution>();
  private readonly layoutStatusItems = new Map<string, LayoutStatusItemContribution>();
  private readonly layoutViews = new Map<string, LayoutViewContribution>();
  private readonly layoutEditors = new Map<string, LayoutEditorContribution>();
  private readonly layoutWelcomes = new Map<string, LayoutWelcomeContribution>();
  private readonly tabContextMenus = new Map<string, TabContextMenuContribution>();
  private readonly tabHeaderStyles = new Map<string, TabHeaderStyleContribution>();
  private readonly tooltipSections = new Map<string, TooltipSectionContribution>();
  private readonly settingsContributions = new Map<string, SettingsContribution>();
  private readonly settingsDefinitions = new Map<string, SettingDefinition>();
  private readonly advancedSettingsRenderers = new Map<string, AdvancedSettingsRenderer>();
  private readonly advancedSettingsValidators = new Map<string, AdvancedSettingsValidator>();
  private shellDefaults: LayoutShellDefaults = DEFAULT_SHELL_DEFAULTS;
  private readonly fileRegistry = new FileRegistry({
    getEditors: () => [...this.layoutEditors.values()]
  });

  public constructor(getCommandContextValues?: () => ContextValues) {
    this.commandBus = new CommandBus(() => getCommandContextValues?.() ?? {});
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
