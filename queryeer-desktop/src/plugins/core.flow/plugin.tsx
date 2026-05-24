import type { Plugin } from "../../contracts/plugin/Plugin";
import {
  FLOW_DOCUMENT_EDITOR_ID,
  FLOW_DOCUMENT_EXTENSION,
  FLOW_MONACO_LANGUAGE_ID,
  FLOW_DOCUMENT_MIME_TYPE
} from "../../contracts/flow/constants";
import { getEditorRegistryHost, getOutlineRegistry } from "../../core/plugin-runtime/ExtensionRegistry";
import { setFilesRegistry } from "../core.commands/files-registry-accessor";
import { registerMonacoLanguageIdForMimeType } from "../core.editor/texteditor/mime-types";
import { setupQflowLanguage } from "./qflow-language";
import { FlowIcon } from "./FlowIcon";
import { FlowEditorComponent, flowTextRegistry } from "./FlowEditorComponent";
import { FlowContextView } from "./FlowContextView";
import { FLOW_CONTEXT_VIEW_ID } from "./flow-layout-ids";
import {
  DEFAULT_FLOW_ENVIRONMENT_CONFIG,
  FLOW_ENVIRONMENTS_SETTING_ID
} from "./flow-environment";
import { getCoreSettingsService } from "../core.settings/service";

export const coreFlowPlugin: Plugin = {
  manifest: {
    id: "core.flow",
    name: "Core Flow",
    version: "0.1.0",
    kind: "core",
    description: "Queryeer flow authoring and query-service execution for .qflow documents",
    dependencies: ["core.layout", "core.files", "core.editor", "core.commands", "core.expressions", "core.settings"]
  },
  activate: (context) => {
    flowTextRegistry.setFilesRegistry(context.files);
    getEditorRegistryHost().registerContentRepository(flowTextRegistry);
    setFilesRegistry(context.files);

    context.files.capabilities.registerLabel?.(FLOW_DOCUMENT_MIME_TYPE, "Flow");
    context.files.capabilities.registerCapabilities(FLOW_DOCUMENT_MIME_TYPE, [
      "backupable",
      "editable",
      "viewable"
    ]);
    context.files.capabilities.registerContentCategory(FLOW_DOCUMENT_MIME_TYPE, "text");
    context.files.capabilities.registerPreferredExtension?.(FLOW_DOCUMENT_MIME_TYPE, FLOW_DOCUMENT_EXTENSION);
    context.files.capabilities.registerPreferredNewFileMimeType?.(FLOW_DOCUMENT_MIME_TYPE, 15);
    context.files.registerMimeResolver((_uri, hint) => {
      return hint?.extension?.toLowerCase() === FLOW_DOCUMENT_EXTENSION
        ? FLOW_DOCUMENT_MIME_TYPE
        : undefined;
    });
    registerMonacoLanguageIdForMimeType(FLOW_DOCUMENT_MIME_TYPE, FLOW_MONACO_LANGUAGE_ID);
    context.files.mimeIcons.registerMimeIcon({
      moduleId: "core.flow",
      mimeType: FLOW_DOCUMENT_MIME_TYPE,
      icon: FlowIcon
    });

    context.layout.registerEditor({
      id: FLOW_DOCUMENT_EDITOR_ID,
      title: "Flow Editor",
      order: 32,
      supportedMimeTypes: [FLOW_DOCUMENT_MIME_TYPE],
      openIntents: ["view", "edit"],
      priority: 550,
      render: ({ activeFile } = {}) => (
        <FlowEditorComponent
          file={activeFile}
          editorRegistryHost={getEditorRegistryHost()}
          outlineRegistry={getOutlineRegistry()}
          dialog={context.dialog}
        />
      )
    });

    context.layout.registerView({
      id: FLOW_CONTEXT_VIEW_ID,
      title: "Flow Context",
      defaultZone: "primarySidebar",
      order: 45,
      canMoveZones: true,
      canCollapse: true,
      when: "activeFile?.mimeType == 'application/vnd.queryeer.flow+plain'",
      render: () => <FlowContextView />
    });

    context.settings.registerSettings({
      moduleId: "core.flow",
      title: "Flow",
      order: 34,
      settings: [{
        id: FLOW_ENVIRONMENTS_SETTING_ID,
        moduleId: "core.flow",
        title: "Flow Environments",
        description: "Defines local flow environment names used by contribution-owned node configuration.",
        sectionPath: ["Flow", "Environments"],
        tags: ["flow", "environment"],
        type: "json",
        scope: "workspace",
        defaultValue: DEFAULT_FLOW_ENVIRONMENT_CONFIG
      }]
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }

    context.commands.registerCommand({
      id: "core.flow.new",
      title: "New Flow",
      category: "Flow",
      handler: async () => {
        const created = await context.fileMediator.createUntitledFile({
          extension: FLOW_DOCUMENT_EXTENSION,
          mimeType: FLOW_DOCUMENT_MIME_TYPE,
          title: "Flow"
        });
        const seed = [
          "%%queryeer-flow",
          "id: node-1",
          "type: jdbc.query",
          "description: \"First flow node\"",
          "jdbc:",
          "  connection: \"\"",
          "  database: \"\"",
          "%%",
          "select 1 as demo"
        ].join("\n");
        getEditorRegistryHost().applyRecoveredContent(created.fileId, seed);
      }
    });

    void setupQflowLanguage();
  }
};
