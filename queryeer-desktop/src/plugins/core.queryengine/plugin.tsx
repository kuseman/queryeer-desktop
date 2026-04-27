import type { Plugin } from "../../contracts/plugin/Plugin";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { getQueryEngineService } from "./QueryEngineService";
import { queryTextRegistry } from "./QueryTextEditorRegistry";
import { QueryEditorComponent } from "./QueryEditorComponent";

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
    queryTextRegistry.setFilesRegistry(context.files);

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
      render: ({ activeFile } = {}) => <QueryEditorComponent file={activeFile} />
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

      if (event.method === "query.completed") {
        fileIdByExecutionId.delete(params.queryExecutionId);
        writeQueryTabState(context, fileId, undefined);
      } else if (event.method === "query.failed") {
        fileIdByExecutionId.delete(params.queryExecutionId);
        writeQueryTabState(context, fileId, "failed");
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.execute",
      title: "Execute Query",
      category: "Query",
      handler: async () => {
        queryEngineService.requestExecute();
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.cancel",
      title: "Cancel Query",
      category: "Query",
      handler: async () => {
        queryEngineService.requestCancel();
      }
    });

    context.keybindings.registerKeybinding({
      id: "core.queryengine.keybinding.execute",
      commandId: "core.queryengine.execute",
      key: "F5",
      when: "editorFocus",
      scope: "editor",
      order: 500
    });
  }
};
