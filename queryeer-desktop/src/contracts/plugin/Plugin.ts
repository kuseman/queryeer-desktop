import type { FileMediator } from "../files/FileMediator.js";
import type { FilesRegistry } from "../files/FilesRegistry.js";
import type { FileWatcherService } from "../files/FileWatcher.js";
import type { LayoutRegistry } from "../extensions/LayoutExtension.js";
import type { MenuRegistry } from "../extensions/MenuExtension.js";
import type { KeybindingRegistry } from "../extensions/KeybindingExtension.js";
import type { DialogExtension } from "../extensions/DialogExtension.js";
import type { TooltipRegistry } from "../extensions/TooltipExtension.js";
import type { PluginManifest } from "./PluginManifest.js";

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
