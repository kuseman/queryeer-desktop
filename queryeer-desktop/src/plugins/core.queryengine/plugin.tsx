import React from "react";
import type { Plugin } from "../../contracts/plugin/Plugin";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { getQueryEngineService } from "./QueryEngineService";
import { queryTextRegistry } from "./QueryTextEditorRegistry";
import { QueryEditorComponent } from "./QueryEditorComponent";
import { QueryRunIcon, QueryStopIcon } from "./query-toolbar-icons";
import { getOutputRegistry } from "./output/OutputRegistry";
import { getQueryViewStateStore, TEXT_OUTPUT_PRIMARY_ID } from "./QueryViewStateStore";
import { TEXT_OUTPUT_FORMATTERS } from "../core.queryengine.output.text/formatters";
import { getEditorRegistryHost } from "../../core/plugin-runtime/ExtensionRegistry";
import { getOutlineRegistry } from "../../core/plugin-runtime/ExtensionRegistry";
import { registerShortcuts } from "./shortcuts";
import { setFilesRegistry } from "../core.commands/files-registry-accessor";
import { ExpressionTesterRenderer } from "../core.commands/ExpressionTesterRenderer";
import { setupSqlCompletionLanguage } from "./sql-completion-language";

void React;

const QUERY_TAB_STATE_METADATA_KEY = "core.queryengine.tabState";

type QueryTabState = "running" | "failed";

function readQueryTabState(file: FileEntity): QueryTabState | undefined {
  const state = file.metadata?.[QUERY_TAB_STATE_METADATA_KEY];
  if (state === "running" || state === "failed") {
    return state;
  }
  return undefined;
}

function writeQueryTabState(
  context: Parameters<Plugin["activate"]>[0],
  fileId: string,
  state: QueryTabState | undefined
): void {
  const file = context.files.getFile(fileId);
  if (!file) {
    return;
  }
  const metadata = { ...(file.metadata ?? {}) };
  if (state) {
    metadata[QUERY_TAB_STATE_METADATA_KEY] = state;
  } else {
    delete metadata[QUERY_TAB_STATE_METADATA_KEY];
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
    queryEngineService.initialize();
    void setupSqlCompletionLanguage();
    queryTextRegistry.setFilesRegistry(context.files);
    setFilesRegistry(context.files);
    getEditorRegistryHost().registerContentRepository(queryTextRegistry);
    getQueryViewStateStore().initialize(context.files);

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

    const getSelectableOutputs = () => getOutputRegistry().getSelectablePrimaryContributors();

    const resolveSelectedOutput = (fileId: string): string => {
      const outputs = getSelectableOutputs();
      const selected = getQueryViewStateStore().read(fileId).executionTargetOutputId;
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

    const fileIdByExecutionId = new Map<string, string>();

    // Register the split-pane query editor for mime types marked queryexecutable
    context.layout.registerEditor({
      id: "core.queryengine.editor",
      title: "Query Editor",
      requiredCapabilities: ["queryexecutable"],
      supportedContentCategories: ["text"],
      openIntents: ["edit", "view"],
      priority: 500,
      render: ({ activeFile } = {}) => <QueryEditorComponent file={activeFile} editorRegistryHost={getEditorRegistryHost()} outlineRegistry={getOutlineRegistry()} />
    });

    context.layout.registerTabHeaderStyle({
      id: "core.queryengine.tabHeaderStyle.execution",
      order: 100,
      render: ({ file, hasCapability }) => {
        if (!hasCapability("queryexecutable")) {
          return null;
        }
        const tabState = readQueryTabState(file);
        if (tabState === "running") {
          return {
            className: "queryengine-tab-state-running",
            indicatorClassName: "queryengine-tab-indicator-running"
          };
        }
        if (tabState === "failed") {
          return {
            className: "queryengine-tab-state-failed"
          };
        }
        return null;
      }
    });

    queryEngineService.onQueryEvent((event, executeContext) => {
      const params = event.params as { queryExecutionId?: string } | undefined;

      if (event.method === "query.started") {
        if (params?.queryExecutionId && executeContext?.fileId) {
          fileIdByExecutionId.set(params.queryExecutionId, executeContext.fileId);
          writeQueryTabState(context, executeContext.fileId, "running");
        }
        return;
      }

      if (!params?.queryExecutionId) {
        return;
      }

      const fileId = fileIdByExecutionId.get(params.queryExecutionId);
      if (!fileId) {
        return;
      }

      if (event.method === "queryengine.completed") {
        fileIdByExecutionId.delete(params.queryExecutionId);
        writeQueryTabState(context, fileId, undefined);
      } else if (event.method === "queryengine.failed") {
        fileIdByExecutionId.delete(params.queryExecutionId);
        writeQueryTabState(context, fileId, "failed");
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.execute",
      title: "Execute Query",
      category: "Query",
      enablement: "backendHealthy && hasActiveQueryExecutableFile && activeFileMetadata.core.queryengine.tabState != 'running'",
      handler: async () => {
        queryEngineService.requestExecute();
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.cancel",
      title: "Cancel Query",
      category: "Query",
      enablement: "backendHealthy && hasActiveQueryExecutableFile && activeFileMetadata.core.queryengine.tabState == 'running'",
      handler: async () => {
        queryEngineService.requestCancel();
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
      id: "core.queryengine.toolbar.output.select",
      type: "select",
      title: "Output",
      order: 42,
      alignment: "west",
      when: "hasActiveQueryExecutableFile",
      getOptions: () => getSelectableOutputs().map((output) => ({ value: output.id, label: output.title })),
      getValue: () => {
        const active = getActiveQueryFile();
        if (!active) {
          return getSelectableOutputs()[0]?.id ?? TEXT_OUTPUT_PRIMARY_ID;
        }
        return resolveSelectedOutput(active.fileId);
      },
      onChange: (value) => {
        const active = getActiveQueryFile();
        if (!active) {
          return;
        }
        getQueryViewStateStore().setSelectedOutput(active.fileId, value);
      },
      disabled: () => getSelectableOutputs().length === 0
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.toolbar.output.text.format",
      type: "select",
      title: "Format",
      order: 43,
      alignment: "west",
      when: "hasActiveQueryExecutableFile",
      getOptions: () => TEXT_OUTPUT_FORMATTERS.map((formatter) => ({ value: formatter.id, label: formatter.label })),
      getValue: () => {
        const active = getActiveQueryFile();
        if (!active) {
          return TEXT_OUTPUT_FORMATTERS[0]!.id;
        }
        return getQueryViewStateStore().read(active.fileId).textOutputFormat ?? TEXT_OUTPUT_FORMATTERS[0]!.id;
      },
      onChange: (value) => {
        const active = getActiveQueryFile();
        if (!active) {
          return;
        }
        getQueryViewStateStore().setTextOutputFormat(active.fileId, value);
      },
      disabled: () => {
        const active = getActiveQueryFile();
        if (!active) {
          return true;
        }
        return resolveSelectedOutput(active.fileId) !== TEXT_OUTPUT_PRIMARY_ID;
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

    context.settings.registerAdvancedRenderer({
      id: "core.commands.expression-tester",
      render: (props) => <ExpressionTesterRenderer {...props} />
    });
    context.settings.registerSettings({
      moduleId: "core.commands",
      title: "When Expressions",
      settings: [{
        id: "core.commands.expression-tester.dummy",
        moduleId: "core.commands",
        title: "Expression Tester",
        description: "Test when-expressions against the context of any open file.",
        sectionPath: ["Expression Tester"],
        type: "json",
        defaultValue: null,
        advanced: { rendererId: "core.commands.expression-tester" }
      }]
    });
  }
};
