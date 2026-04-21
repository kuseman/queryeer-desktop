import type { FileMediator } from "../files/FileMediator";
import type { FilesRegistry } from "../files/FilesRegistry";
import type { FileWatcherService } from "../files/FileWatcher";
import type { LayoutRegistry } from "../extensions/LayoutExtension";
import type { PluginManifest } from "./PluginManifest";

export type Plugin = {
  manifest: PluginManifest;
  activate: (context: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
};

export type PluginContext = {
  commands: CommandRegistry;
  filesystems: FileSystemRegistry;
  files: FilesRegistry;
  fileMediator: FileMediator;
  fileWatcher: FileWatcherService;
  layout: LayoutRegistry;
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
