import type { PluginManifest } from "./PluginManifest";

export type Plugin = {
  manifest: PluginManifest;
  activate: (context: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
};

export type PluginContext = {
  commands: CommandRegistry;
  panels: PanelRegistry;
  filesystems: FileSystemRegistry;
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

export type PanelRegistry = {
  registerPanel: (panel: {
    id: string;
    title: string;
    placement: "left" | "right" | "bottom" | "center";
    render: () => import("react").ReactNode;
  }) => void;
};

export type FileSystemRegistry = {
  registerFileSystem: (filesystem: {
    id: string;
    title: string;
    schemes: string[];
  }) => void;
};
