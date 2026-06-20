import React from "react";
import type { LayoutToolbarContext } from "@queryeer/api/extensions/LayoutExtension";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getQueryEngineService } from "./QueryEngineService";
import { getQueryPlanArtifactStore, queryCompletedArtifacts, isPlanGraphArtifact } from "./query-plan/artifact-store";
import { clearGraphViewState } from "../core.graph/graph-view-state-store";
import { queryTextRegistry } from "./QueryTextEditorRegistry";
import { QueryEditorComponent } from "./QueryEditorComponent";
import { QueryRunIcon, QueryStopIcon } from "./query-toolbar-icons";
import { getOutputRegistry } from "./output/OutputRegistry";
import { getQueryOutputFormatRegistry } from "./QueryOutputFormatRegistry";
import { getQueryViewStateStore, TEXT_OUTPUT_PRIMARY_ID } from "./QueryViewStateStore";
import { registerQueryPlanOutput } from "./query-plan/output";
import { getEditorRegistryHost } from "../../core/plugin-runtime/ExtensionRegistry";
import { getOutlineRegistry } from "../../core/plugin-runtime/ExtensionRegistry";
import { registerShortcuts } from "./shortcuts";
import { setFilesRegistry } from "../core.commands/files-registry-accessor";
import { setupSqlCompletionLanguage } from "./sql-completion-language";
import { setupSqlHoverLanguage } from "./sql-hover-language";
import { registerWhenExpressionVariables } from "../core.commands/when-expression-variable-registry";
import { createSymbolActionProvider } from "./symbol-action-provider";
import { getSymbolActionRegistry, } from "./symbol-action-registry";
import { SYMBOL_ACTIONS_SETTING_ID } from "./symbol-action-types";
import type { SymbolAction } from "./symbol-action-types";
import { SymbolActionsSettingsEditor } from "./symbol-action-settings";
import { onCoreSettingsServiceInitialized } from "../core.settings/service";
import { querySessionKey, toQueryOutputSessionId } from "./query-session";

void React;

type QueryTabState = "running" | "failed";

const TAB_STATE_METADATA_KEY = "core.queryengine.tabStateByGroup";
const HAS_RUNNING_QUERY_KEY = "core.queryengine.hasRunningQuery";

function readQueryTabState(file: FileEntity, groupId: string | undefined): QueryTabState | undefined {
  if (!groupId) {
    return undefined;
  }
  const tabStateByGroup = file.metadata?.[TAB_STATE_METADATA_KEY] as Record<string, QueryTabState> | undefined;
  const tabState = tabStateByGroup?.[groupId];
  return tabState === "running" || tabState === "failed" ? tabState : undefined;
}

function getToolbarSessionId(toolbarContext: LayoutToolbarContext, fallbackFileId: string): string {
  return toQueryOutputSessionId(toolbarContext.activeEditorGroupId, fallbackFileId);
}

function writeQueryTabStateToMetadata(
  context: Parameters<Plugin["activate"]>[0],
  fileId: string,
  groupId: string,
  state: QueryTabState | undefined
): void {
  const file = context.files.getFile(fileId);
  if (!file) {
    return;
  }
  const metadata = { ...(file.metadata ?? {}) };
  const tabStateByGroup = (metadata[TAB_STATE_METADATA_KEY] as Record<string, QueryTabState> | undefined) ?? {};
  if (state) {
    tabStateByGroup[groupId] = state;
  } else {
    delete tabStateByGroup[groupId];
  }
  if (Object.keys(tabStateByGroup).length > 0) {
    metadata[TAB_STATE_METADATA_KEY] = tabStateByGroup;
    if (state === "running") {
      metadata[HAS_RUNNING_QUERY_KEY] = true;
    } else {
      const anyRunning = Object.values(tabStateByGroup).some((s) => s === "running");
      if (anyRunning) {
        metadata[HAS_RUNNING_QUERY_KEY] = true;
      } else {
        delete metadata[HAS_RUNNING_QUERY_KEY];
      }
    }
  } else {
    delete metadata[TAB_STATE_METADATA_KEY];
    delete metadata[HAS_RUNNING_QUERY_KEY];
  }
  context.files.updateFile(fileId, { metadata });
}

export const coreQueryEnginePlugin: Plugin = {
  manifest: {
    id: "core.queryengine",
    name: "Core Query Engine",
    version: "0.1.0",
    kind: "core",
    description: "Execute SQL/PLBSQL queries and display streaming results in a split-pane editor",
    dependencies: ["core.layout", "core.files", "core.editor"],
    requiredCapabilities: ["editor"],
    providesCapabilities: ["query.engine"]
  },
  activate: (context) => {
    const queryEngineService = getQueryEngineService();
    const queryPlanStore = getQueryPlanArtifactStore();
    queryEngineService.initialize();
    void setupSqlCompletionLanguage();
    void setupSqlHoverLanguage();
    queryTextRegistry.setFilesRegistry(context.files);
    setFilesRegistry(context.files);
    getEditorRegistryHost().registerContentRepository(queryTextRegistry);
    getQueryViewStateStore().initialize(context.files);
    registerQueryPlanOutput(context);

    const getActiveQueryFile = () => {
      const fileId = context.fileMediator.getActiveFileId();
      if (!fileId) {
        return undefined;
      }
      const file = context.files.getFile(fileId);
      if (!file) {
        return undefined;
      }
      if (!context.files.capabilities.hasCapability(file.mimeType, "queryexecutable")) {
        return undefined;
      }
      return file;
    };

    const getToolbarQueryFile = (toolbarContext: LayoutToolbarContext) => {
      const file = toolbarContext.activeFile;
      if (file && context.files.capabilities.hasCapability(file.mimeType, "queryexecutable")) {
        return file;
      }
      return getActiveQueryFile();
    };

    const getSelectableOutputs = () => getOutputRegistry().getSelectablePrimaryContributors();

    const resolveSelectedOutput = (fileId: string, sessionId?: string): string => {
      const outputs = getSelectableOutputs();
      const selected = getQueryViewStateStore().read(fileId, sessionId ?? fileId).executionTargetOutputId;
      if (selected && outputs.some((output) => output.id === selected)) {
        return selected;
      }
      return outputs[0]?.id ?? TEXT_OUTPUT_PRIMARY_ID;
    };

    queryEngineService.registerEngineResolver(
      ({ fileId }) => {
        if (!fileId) {
          return undefined;
        }
        return context.files.getFile(fileId)?.engineBinding?.engineId;
      },
      { id: "queryengine.file-binding" }
    );

    const executionInfoById = new Map<string, { fileId: string; outputSessionId: string }>();

    // Register the split-pane query editor for mime types marked queryexecutable
    context.layout.registerEditor({
      id: "core.queryengine.editor",
      title: "Query Editor",
      requiredCapabilities: ["queryexecutable"],
      supportedContentCategories: ["text"],
      openIntents: ["edit", "view"],
      priority: 500,
      canSplit: true,
      render: ({ activeFile, editorInstanceId, editorGroupId, isActiveEditorGroup } = {}) => (
        <QueryEditorComponent
          file={activeFile}
          editorRegistryHost={getEditorRegistryHost()}
          outlineRegistry={getOutlineRegistry()}
          editorInstanceId={editorInstanceId}
          editorGroupId={editorGroupId}
          isActiveEditorGroup={isActiveEditorGroup}
        />
      )
    });

    context.layout.registerTabHeaderStyle({
      id: "core.queryengine.tabHeaderStyle.execution",
      order: 100,
      render: ({ file, hasCapability, editorGroupId }) => {
        if (!hasCapability("queryexecutable")) {
          return null;
        }
        const tabState = readQueryTabState(file, editorGroupId);
        if (tabState === "running") {
          return {
            className: "queryengine-tab-state-running",
            indicatorClassName: "queryengine-tab-indicator-running"
          };
        }
        if (tabState === "failed") {
          return {
            indicatorClassName: "queryengine-tab-indicator-failed"
          };
        }
        return null;
      }
    });

    queryEngineService.onQueryEvent((event, executeContext) => {
      const params = event.params as { queryExecutionId?: string } | undefined;

      if (event.method === "query.started") {
        if (params?.queryExecutionId && executeContext?.fileId) {
          const outputSessionId = executeContext.targetOutputSessionId ?? "";
          const groupId = querySessionKey(outputSessionId);
          executionInfoById.set(params.queryExecutionId, { fileId: executeContext.fileId, outputSessionId });
          writeQueryTabStateToMetadata(context, executeContext.fileId, groupId, "running");
        }
        return;
      }

      if (!params?.queryExecutionId) {
        return;
      }

      const info = executionInfoById.get(params.queryExecutionId);
      if (!info) {
        return;
      }

      if (event.method === "queryengine.completed") {
        const artifacts = queryCompletedArtifacts(event.params);
        if (artifacts.length > 0) {
          for (const old of queryPlanStore.list(info.fileId)) {
            clearGraphViewState(old.graph.id);
          }
          for (const artifact of artifacts) {
            if (isPlanGraphArtifact(artifact)) {
              clearGraphViewState(artifact.graph.id);
            }
          }
          queryPlanStore.rememberArtifacts(info.fileId, artifacts);
        }
        const groupId = querySessionKey(info.outputSessionId);
        executionInfoById.delete(params.queryExecutionId);
        writeQueryTabStateToMetadata(context, info.fileId, groupId, undefined);
      } else if (event.method === "queryengine.failed") {
        const groupId = querySessionKey(info.outputSessionId);
        executionInfoById.delete(params.queryExecutionId);
        writeQueryTabStateToMetadata(context, info.fileId, groupId, "failed");
      }
    });

    context.files.subscribe((files) => {
      queryPlanStore.pruneToFileIds(files.map((file) => file.fileId));
    });

    context.commands.registerCommand({
      id: "core.queryengine.execute",
      title: "Execute Query",
      category: "Query",
      enablement: "backendHealthy && hasActiveQueryExecutableFile && activeFile?.metadata?.core?.queryengine?.hasRunningQuery != true",
      handler: async () => {
        queryEngineService.requestExecute();
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.cancel",
      title: "Cancel Query",
      category: "Query",
      enablement: "backendHealthy && hasActiveQueryExecutableFile && activeFile?.metadata?.core?.queryengine?.hasRunningQuery == true",
      handler: async () => {
        queryEngineService.requestCancel();
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.toggleOutputPanel",
      title: "Toggle Output Panel",
      category: "Query",
      enablement: "hasActiveQueryExecutableFile",
      handler: async () => {
        queryEngineService.requestToggleOutputPanel();
      }
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.toolbar.execute",
      title: "Execute",
      order: 40,
      commandId: "core.queryengine.execute",
      icon: QueryRunIcon,
      when: "hasActiveQueryExecutableFile"
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.toolbar.cancel",
      order: 41,
      commandId: "core.queryengine.cancel",
      icon: QueryStopIcon,
      when: "hasActiveQueryExecutableFile"
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.toolbar.toggleOutputPanel",
      order: 42,
      commandId: "core.queryengine.toggleOutputPanel",
      icon: "panel",
      when: "hasActiveQueryExecutableFile",
      pressed: (toolbarContext) => {
        const file = getToolbarQueryFile(toolbarContext);
        if (!file) {
          return true;
        }
        const sessionId = getToolbarSessionId(toolbarContext, file.fileId);
        return getQueryViewStateStore().read(file.fileId, sessionId).outputPanelCollapsed === false;
      }
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.toolbar.output.select",
      type: "select",
      title: "Output",
      order: 43,
      alignment: "west",
      when: "hasActiveQueryExecutableFile",
      getOptions: () => getSelectableOutputs().map((output) => ({ value: output.id, label: output.title })),
      getValue: (toolbarContext) => {
        const active = getToolbarQueryFile(toolbarContext);
        if (!active) {
          return getSelectableOutputs()[0]?.id ?? TEXT_OUTPUT_PRIMARY_ID;
        }
        const sessionId = getToolbarSessionId(toolbarContext, active.fileId);
        return resolveSelectedOutput(active.fileId, sessionId);
      },
      onChange: (value, toolbarContext) => {
        const active = getToolbarQueryFile(toolbarContext);
        if (!active) {
          return;
        }
        const sessionId = getToolbarSessionId(toolbarContext, active.fileId);
        getQueryViewStateStore().setSelectedOutput(active.fileId, sessionId, value);
      },
      disabled: () => getSelectableOutputs().length === 0
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.toolbar.output.text.format",
      type: "select",
      title: "Format",
      order: 44,
      alignment: "west",
      when: "hasActiveQueryExecutableFile",
      getOptions: () => getQueryOutputFormatRegistry().getFormatters().map((f) => ({ value: f.id, label: f.label })),
      getValue: (toolbarContext) => {
        const active = getToolbarQueryFile(toolbarContext);
        const formatters = getQueryOutputFormatRegistry().getFormatters();
        if (!active) {
          return formatters[0]?.id ?? "csv";
        }
        const sessionId = getToolbarSessionId(toolbarContext, active.fileId);
        return getQueryViewStateStore().read(active.fileId, sessionId).textOutputFormat ?? formatters[0]?.id ?? "csv";
      },
      onChange: (value, toolbarContext) => {
        const active = getToolbarQueryFile(toolbarContext);
        if (!active) {
          return;
        }
        const sessionId = getToolbarSessionId(toolbarContext, active.fileId);
        getQueryViewStateStore().setTextOutputFormat(active.fileId, sessionId, value);
      },
      disabled: (toolbarContext) => {
        const active = getToolbarQueryFile(toolbarContext);
        if (!active) {
          return true;
        }
        const sessionId = getToolbarSessionId(toolbarContext, active.fileId);
        const id = resolveSelectedOutput(active.fileId, sessionId);
        return id !== TEXT_OUTPUT_PRIMARY_ID && id !== "core.queryengine.output.file";
      }
    });

    context.keybindings.registerKeybinding({
      id: "core.queryengine.keybinding.execute",
      commandId: "core.queryengine.execute",
      key: "F5",
      when: "global",
      scope: "global",
      order: 500
    });

    registerShortcuts(context);

    // Symbol Actions: when-expression variables for context variable autocomplete
    registerWhenExpressionVariables([
      { name: "symbol.kind", type: "string", description: "Kind of symbol at cursor position (e.g. 'table', 'view', 'function', 'column')" },
      { name: "symbol.name", type: "string", description: "Legacy display/reference name of symbol at cursor position (e.g. 'dbo.MyTable')" },
      { name: "symbol.fullName", type: "string", description: "Most complete resolved symbol name available (e.g. 'database.dbo.MyTable')" },
      { name: "symbol.detail", type: "string", description: "Additional detail of symbol at cursor position (e.g. 'TABLE', 'VIEW')" },
      { name: "symbol.attributes.database", type: "string", description: "Resolved database/catalog name when available" },
      { name: "symbol.attributes.schema", type: "string", description: "Resolved schema name when available" },
      { name: "symbol.attributes.name", type: "string", description: "Unqualified object name when available" }
    ]);

    // Symbol Actions: register context menu provider
    const symbolActionProvider = createSymbolActionProvider(
      context.files,
      getEditorRegistryHost()
    );
    context.contextMenu.registerProvider(symbolActionProvider);

    // Symbol Actions: settings
    context.settings.registerAdvancedRenderer({
      id: SYMBOL_ACTIONS_SETTING_ID,
      render: ({ value, setValue, readonly }) => (
        <SymbolActionsSettingsEditor value={value} setValue={setValue} readonly={readonly} />
      )
    });
    context.settings.registerSettings({
      moduleId: "core.queryengine",
      title: "Query Engine",
      settings: [
        {
          id: SYMBOL_ACTIONS_SETTING_ID,
          moduleId: "core.queryengine",
          title: "Symbol Actions",
          description: "Context menu actions that appear when right-clicking on symbols (tables, views, functions) in SQL editors.",
          sectionPath: ["Query Engine", "Text Editor", "Symbol Actions"],
          type: "json",
          defaultValue: [],
          advanced: { rendererId: SYMBOL_ACTIONS_SETTING_ID }
        }
      ]
    });

    // Sync symbol actions from settings to the runtime registry when the settings service is ready.
    onCoreSettingsServiceInitialized((settingsService) => {
      // Subscribe first so changes from syncRegistryModules (async) are captured.
      settingsService.subscribe(() => {
        const current = settingsService.getValue(SYMBOL_ACTIONS_SETTING_ID);
        if (Array.isArray(current)) {
          getSymbolActionRegistry().setActions(current as SymbolAction[]);
        }
      });

      // refreshSchemaFromRegistry triggers rebuildEffectiveValues with the definition
      // now in the registry. If the module doc was already loaded by loadPersistedModules,
      // effectiveValues will contain the stored value after this call.
      settingsService.refreshSchemaFromRegistry();

      const initial = settingsService.getValue(SYMBOL_ACTIONS_SETTING_ID);
      if (Array.isArray(initial)) {
        getSymbolActionRegistry().setActions(initial as SymbolAction[]);
      }

      // syncRegistryModules handles the case where the module doc wasn't loaded yet
      // (first run / not in index). When it loads a new doc it calls emitValuesChanged,
      // which fires the subscribe callback above.
      void settingsService.syncRegistryModules();
    });
  }
};
