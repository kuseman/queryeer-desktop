import type { FileMediator } from "../files/FileMediator";
import type { FilesRegistry } from "../files/FilesRegistry";
import type { FileWatcherService } from "../files/FileWatcher";
import type { LayoutRegistry } from "../extensions/LayoutExtension";
import type { MenuRegistry } from "../extensions/MenuExtension";
import type { KeybindingRegistry } from "../extensions/KeybindingExtension";
import type { DialogExtension } from "../extensions/DialogExtension";
import type { TooltipRegistry } from "../extensions/TooltipExtension";
import type { PluginManifest } from "./PluginManifest";

export type Plugin = {
  manifest: PluginManifest;
  activate: (context: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
};

export type DialogRegistry = DialogExtension;

export type PluginContext = {
  commands: CommandRegistry;
  filesystems: FileSystemRegistry;
  files: FilesRegistry;
  fileMediator: FileMediator;
  fileWatcher: FileWatcherService;
  layout: LayoutRegistry;
  menu: MenuRegistry;
  keybindings: KeybindingRegistry;
  dialog: DialogRegistry;
  tooltip: TooltipRegistry;
};

export type CommandExecutionResult = {
  commandId: string;
  executed: boolean;
  reason?: string;
};

export type CommandRegistry = {
  registerCommand: (command: {
    id: string;
    title: string;
    category?: string;
    enablement?: string;
    handler: () => void | Promise<void>;
  }) => void;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
};

export type FileSystemRegistry = {
  registerFileSystem: (filesystem: {
    id: string;
    title: string;
    schemes: string[];
  }) => void;
};
