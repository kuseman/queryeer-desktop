import type { Plugin } from "../../contracts/plugin/Plugin";
import { getQueryEngineService } from "./QueryEngineService";
import { queryTextRegistry } from "./QueryTextEditorRegistry";
import { QueryEditorComponent } from "./QueryEditorComponent";

export const coreQueryEnginePlugin: Plugin = {
  manifest: {
    id: "core.queryengine",
    name: "Core Query Engine",
    version: "0.1.0",
    kind: "core",
    description: "Execute SQL/PLBSQL queries and display streaming results in a split-pane editor",
    dependencies: ["core.layout", "core.files", "core.editor"],
    providesCapabilities: ["query.engine"]
  },
  activate: (context) => {
    getQueryEngineService().initialize();
    queryTextRegistry.setFilesRegistry(context.files);

    // Add executable capability so editor resolution prefers this plugin for SQL files
    context.files.capabilities.registerCapabilities("application/sql", ["executable"]);
    context.files.capabilities.registerCapabilities("application/plbsql", ["executable"]);

    // Register the split-pane query editor with higher priority than the plain text editor
    context.layout.registerEditor({
      id: "core.queryengine.editor",
      title: "Query Editor",
      supportedMimeTypes: ["application/sql", "application/plbsql"],
      priority: 500,
      render: ({ activeFile } = {}) => <QueryEditorComponent file={activeFile} />
    });

    context.commands.registerCommand({
      id: "core.queryengine.execute",
      title: "Execute Query",
      category: "Query",
      handler: async () => {
        getQueryEngineService().requestExecute();
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.cancel",
      title: "Cancel Query",
      category: "Query",
      handler: async () => {
        getQueryEngineService().requestCancel();
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
