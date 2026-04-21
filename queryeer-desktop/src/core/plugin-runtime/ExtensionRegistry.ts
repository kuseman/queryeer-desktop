import type {
  LayoutEditorContribution,
  LayoutMenuItemContribution,
  LayoutRegistry,
  LayoutShellDefaults,
  LayoutStatusItemContribution,
  LayoutToolbarActionContribution,
  LayoutViewContribution,
  LayoutWelcomeContribution
} from "../../contracts/extensions/LayoutExtension";
import type { CommandExtension } from "../../contracts/extensions/CommandExtension";
import type { FileSystemExtension } from "../../contracts/extensions/FileSystemExtension";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type {
  CommandRegistry,
  FileSystemRegistry
} from "../../contracts/plugin/Plugin";
import { CommandBus } from "./CommandBus";
import { FileRegistry } from "./FileRegistry";

export type ExtensionSnapshot = {
  commands: CommandExtension[];
  filesystems: FileSystemExtension[];
  files: FileEntity[];
  layout: {
    menuItems: LayoutMenuItemContribution[];
    toolbarActions: LayoutToolbarActionContribution[];
    statusItems: LayoutStatusItemContribution[];
    views: LayoutViewContribution[];
    editors: LayoutEditorContribution[];
    welcomes: LayoutWelcomeContribution[];
    shellDefaults: LayoutShellDefaults;
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
  private readonly commandBus = new CommandBus();
  private readonly commands = new Map<string, CommandExtension>();
  private readonly filesystems = new Map<string, FileSystemExtension>();
  private readonly layoutMenuItems = new Map<string, LayoutMenuItemContribution>();
  private readonly layoutToolbarActions = new Map<string, LayoutToolbarActionContribution>();
  private readonly layoutStatusItems = new Map<string, LayoutStatusItemContribution>();
  private readonly layoutViews = new Map<string, LayoutViewContribution>();
  private readonly layoutEditors = new Map<string, LayoutEditorContribution>();
  private readonly layoutWelcomes = new Map<string, LayoutWelcomeContribution>();
  private shellDefaults: LayoutShellDefaults = DEFAULT_SHELL_DEFAULTS;
  private readonly fileRegistry = new FileRegistry({
    getEditors: () => [...this.layoutEditors.values()]
  });

  public createCommandRegistry(): CommandRegistry {
    return {
      registerCommand: (command) => {
        this.commands.set(command.id, command);
        this.commandBus.register(command.id, command.handler);
      },
      executeCommand: async (commandId) => {
        return this.commandBus.execute(commandId);
      }
    };
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

  public subscribeToFiles(subscriber: (files: FileEntity[]) => void): () => void {
    return this.fileRegistry.createFilesRegistry().subscribe(subscriber);
  }

  public createLayoutRegistry(): LayoutRegistry {
    return {
      registerMenuItem: (contribution) => {
        this.layoutMenuItems.set(contribution.id, contribution);
      },
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

  public snapshot(): ExtensionSnapshot {
    return {
      commands: [...this.commands.values()],
      filesystems: [...this.filesystems.values()],
      files: this.fileRegistry.snapshot(),
      layout: {
        menuItems: [...this.layoutMenuItems.values()],
        toolbarActions: [...this.layoutToolbarActions.values()],
        statusItems: [...this.layoutStatusItems.values()],
        views: [...this.layoutViews.values()],
        editors: [...this.layoutEditors.values()],
        welcomes: [...this.layoutWelcomes.values()],
        shellDefaults: this.shellDefaults
      }
    };
  }

  public async executeCommand(commandId: string) {
    return this.commandBus.execute(commandId);
  }
}
