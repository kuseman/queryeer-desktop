import type { CommandExtension } from "../../contracts/extensions/CommandExtension";
import type { FileSystemExtension } from "../../contracts/extensions/FileSystemExtension";
import type { PanelExtension } from "../../contracts/extensions/PanelExtension";
import type {
  CommandRegistry,
  FileSystemRegistry,
  PanelRegistry
} from "../../contracts/plugin/Plugin";
import { CommandBus } from "./CommandBus";

export type ExtensionSnapshot = {
  commands: CommandExtension[];
  panels: PanelExtension[];
  filesystems: FileSystemExtension[];
};

export class ExtensionRegistry {
  private readonly commandBus = new CommandBus();
  private readonly commands = new Map<string, CommandExtension>();
  private readonly panels = new Map<string, PanelExtension>();
  private readonly filesystems = new Map<string, FileSystemExtension>();

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

  public createPanelRegistry(): PanelRegistry {
    return {
      registerPanel: (panel) => {
        this.panels.set(panel.id, panel);
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

  public snapshot(): ExtensionSnapshot {
    return {
      commands: [...this.commands.values()],
      panels: [...this.panels.values()],
      filesystems: [...this.filesystems.values()]
    };
  }

  public async executeCommand(commandId: string) {
    return this.commandBus.execute(commandId);
  }
}
