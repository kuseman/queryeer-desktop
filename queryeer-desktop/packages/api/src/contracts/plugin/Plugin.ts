import type { Disposable } from "../editor/EditorApi.js";
import type { FileMediator } from "../files/FileMediator.js";
import type { FilesRegistry } from "../files/FilesRegistry.js";
import type { FileStateRegistry } from "../files/FileStateRegistry.js";
import type { FileWatcherService } from "../files/FileWatcher.js";
import type { LayoutRegistry } from "../extensions/LayoutExtension.js";
import type { MenuRegistry } from "../extensions/MenuExtension.js";
import type { KeybindingRegistry } from "../commands/KeybindingExtension.js";
import type { DialogExtension } from "../extensions/DialogExtension.js";
import type { TooltipRegistry } from "../extensions/TooltipExtension.js";
import type { SettingsRegistry } from "../settings/SettingsExtension.js";
import type { QuickCommandRegistry } from "../extensions/QuickCommandExtension.js";
import type { OutlineRegistry } from "../extensions/OutlineExtension.js";
import type { ComponentType } from "react";
import type { EditorRegistry, FrameworkEditorProps } from "../editor/EditorCapability.js";
import type { ContextMenuRegistry } from "../extensions/ContextMenuExtension.js";
import type { PayloadbuilderCatalogRegistry } from "../queryengine/PayloadbuilderCatalogExtension.js";
import type { TableOutputContextMenuRegistry } from "../queryengine/TableOutputContextMenuExtension.js";
import type { JdbcTreeContextMenuRegistry } from "../queryengine/JdbcTreeContextMenuExtension.js";
import type { GraphNodeTypeRegistry } from "../graph/GraphNodeTypeExtension.js";
import type { AboutExtension } from "../extensions/AboutExtension.js";
import type { NotificationService } from "../extensions/NotificationExtension.js";
import type { AssistantRegistry } from "../assistant/Assistant.js";
import type { PluginManifest } from "./PluginManifest.js";
import type { JdbcDriverRegistry } from "../queryengine/JdbcDriverExtension.js";
import type { JdbcDialectRegistry } from "../queryengine/JdbcDialectExtension.js";
import type { NativeQueryEngineRegistry } from "../queryengine/NativeQueryEngineExtension.js";
import type { EditorLanguageRegistry } from "../editor/EditorLanguageExtension.js";
import type { WhenExpressionRegistry } from "../commands/WhenExpressionTypes.js";
import type { SymbolActionRegistry } from "../queryengine/SymbolActionTemplateContribution.js";
import type { JdbcTreeActionRegistry } from "../settings/TreeActionTemplateContribution.js";
import type {
  CollectionSettingsListEditorProps,
  PasswordFieldInputProps,
  UseCollectionSettingsPersistence
} from "../settings/SettingsExtension.js";

export type Plugin = {
  manifest: PluginManifest;
  activate: (context: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
};

export type DialogRegistry = DialogExtension;

/** The activating plugin's identity; for an external plugin, from its `plugin.json`. */
export type PluginIdentity = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
};

export type PluginContext = {
  /** This plugin's identity, e.g. for a settings `moduleId` or `activeFile.metadata.<id>` keys, so it isn't hard-coded. */
  plugin: PluginIdentity;
  commands: CommandRegistry;
  filesystems: FileSystemRegistry;
  files: FilesRegistry;
  fileState: FileStateRegistry;
  fileMediator: FileMediator;
  fileWatcher: FileWatcherService;
  layout: LayoutRegistry;
  menu: MenuRegistry;
  keybindings: KeybindingRegistry;
  dialog: DialogRegistry;
  tooltip: TooltipRegistry;
  settings: SettingsRegistry;
  quickcommand: QuickCommandRegistry;
  outline: OutlineRegistry;
  editors: EditorRegistry;
  contextMenu: ContextMenuRegistry;
  tableOutputContextMenu: TableOutputContextMenuRegistry;
  jdbcTreeContextMenu: JdbcTreeContextMenuRegistry;
  jdbcDrivers: JdbcDriverRegistry;
  /** Frontend additions for JDBC dialects: a custom connection form, its subtitle and validation, query plan support. */
  jdbcDialects: JdbcDialectRegistry;
  /** Templates for the user's JDBC tree actions (Settings → Tree Actions). */
  jdbcTreeActions: JdbcTreeActionRegistry;
  /** Templates for the user's symbol actions (Settings → Symbol Actions). */
  symbolActions: SymbolActionRegistry;
  /** Autocompletion variables and ready-made expressions for when-expressions in settings. */
  whenExpressions: WhenExpressionRegistry;
  graphNodeTypes: GraphNodeTypeRegistry;
  about: AboutExtension;
  notifications: NotificationService;
  assistant: AssistantRegistry;
  queryEngines: NativeQueryEngineRegistry;
  payloadbuilderCatalog: PayloadbuilderCatalogRegistry;
  editorLanguages: EditorLanguageRegistry;
  components: {
    FrameworkEditor: ComponentType<FrameworkEditorProps>;
    PasswordFieldInput: ComponentType<PasswordFieldInputProps>;
    CollectionSettingsListEditor: ComponentType<CollectionSettingsListEditorProps>;
    useCollectionSettingsPersistence: UseCollectionSettingsPersistence;
  };
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
  }) => Disposable;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  canExecuteCommand: (commandId: string) => boolean;
};

export type FileSystemRegistry = {
  registerFileSystem: (filesystem: {
    id: string;
    title: string;
    schemes: string[];
  }) => Disposable;
};
