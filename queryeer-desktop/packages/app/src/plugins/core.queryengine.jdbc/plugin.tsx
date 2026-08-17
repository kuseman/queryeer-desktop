import type { Plugin } from "@queryeer/api/plugin/Plugin";
import type { LayoutToolbarContext } from "@queryeer/api/extensions/LayoutExtension";
import { registerQueryExecutableEngine } from "../core.queryengine/engine-registration";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { QUERY_PLAN_ARTIFACT_REQUEST, QUERY_PLAN_OUTPUT_ID as PLAN_OUTPUT_ID } from "../core.queryengine/query-plan/constants";
import { getQueryViewStateStore } from "../core.queryengine/QueryViewStateStore";
import { getCoreSettingsService } from "../core.settings/service";
import { JdbcConnectionsSettingsEditor } from "./JdbcConnectionsSettingsEditor";
import {
  JDBC_CONNECTIONS_SETTING_ID,
  getConfiguredJdbcConnections,
  parseJdbcConnectionDefinitions
} from "./jdbc-settings";
import { getJdbcSessionStore } from "./jdbc-session-store";
import { DatabaseIcon } from "./DatabaseIcon";
import { getJdbcNavigationStore } from "./jdbc-navigation-store";
import { JdbcNavigationView } from "./JdbcNavigationView";
import { JDBC_NAV_DB_KEY, type JdbcSelectedDatabase, type JdbcTreeNode } from "./jdbc-navigation-types";
import { writeJdbcContextMetadata, initJdbcFileBinding } from "./jdbc-metadata";
import { registerWhenExpressionVariables } from "../core.commands/when-expression-variable-registry";
import { getQuickCommandService } from "../core.quickcommand/service";
import { createJdbcDatabaseQuickCommandProvider } from "./jdbc-database-quick-command";
import { getJdbcDatabaseCache } from "./jdbc-database-cache";
import { JdbcPanel } from "./JdbcPanel";
import { getJdbcTreeContextMenuRegistry } from "./jdbc-tree-context-menu-registry";
import { getTreeActionRegistry } from "./tree-action-registry";
import { TREE_ACTIONS_SETTING_ID } from "./tree-action-types";
import type { TreeAction } from "./tree-action-types";
import { TreeActionsSettingsEditor } from "./tree-action-settings";
import { createTreeActionProvider } from "./tree-action-provider";
import { onCoreSettingsServiceInitialized } from "../core.settings/service";
import { getEditorRegistryHost } from "../../core/plugin-runtime/ExtensionRegistry";
import { createJdbcAssistantTools, loadDeepSnapshot } from "./jdbc-assistant-tools";
import { subscribeJdbcQueryPlanDialectSupport } from "../core.queryengine/query-plan/supported-dialects";
import { registerJdbcFlowNodeContribution } from "./flow-node-contribution";
import { buildSchemaGraph } from "./jdbc-schema-graph-builder";
import { SchemaTableNode } from "./SchemaTableNode";
import { JdbcSchemaGraphPanel } from "./JdbcSchemaGraphPanel";
import { GRAPH_DOCUMENT_EDITOR_ID } from "../core.graph/constants";
import { GraphIcon } from "../core.graph/GraphIcon";
import { getGraphDocumentRepository } from "../core.graph/GraphDocumentRepository";
import {
  JDBC_SCHEMA_GRAPH_EXTENSION,
  JDBC_SCHEMA_GRAPH_MIME_TYPE
} from "./jdbc-schema-graph-constants";
import { registerQueryEditorStatusItem } from "@queryeer/api/queryengine/QueryEditorStatusExtension";
import { JdbcConnectionStatus } from "./JdbcConnectionStatus";
import { getCommandContext } from "../core.commands/command-context-accessor";
import { toQueryOutputSessionId } from "../core.queryengine/query-session";
import { JdbcDriversSettingsEditor } from "./JdbcDriversSettingsEditor";
import {
  JDBC_DRIVERS_SETTING_ID,
  JDBC_DRIVER_UPDATE_CHECK_SETTING_ID
} from "./jdbc-driver-management-service";

const JDBC_SESSION_ID_METADATA_KEY = "core.queryengine.jdbc.sessionId";
const JDBC_SESSION_CONNECTION_TITLE_KEY = "core.queryengine.jdbc.sessionConnection";
const JDBC_SESSION_STATE_METADATA_KEY = "core.queryengine.jdbc.sessionState";
const JDBC_QUERY_PLAN_WHEN = "hasActiveQueryExecutableFile && hasActiveQueryPlanDialect";
const JDBC_QUERY_PLAN_ENABLEMENT = `backendHealthy && ${JDBC_QUERY_PLAN_WHEN}`;
// Tracks which connectionId (UUID) each file's session was established with.
// Kept in memory — same lifetime as metadata, which is also not persisted.
const sessionConnectionUuidMap = new Map<string, string>();
type ConfiguredJdbcConnection = ReturnType<typeof getConfiguredJdbcConnections>[number];

function getToolbarSessionId(toolbarContext: LayoutToolbarContext, fallbackFileId: string): string {
  return toQueryOutputSessionId(toolbarContext.activeEditorGroupId, fallbackFileId);
}

function getCommandSessionId(fallbackFileId: string): string {
  const activeEditorGroupId = getCommandContext().activeEditorGroupId;
  return toQueryOutputSessionId(typeof activeEditorGroupId === "string" ? activeEditorGroupId : undefined, fallbackFileId);
}

function findEnabledJdbcConnection(connectionId: string | undefined): ConfiguredJdbcConnection | undefined {
  if (!connectionId) {
    return undefined;
  }
  return getConfiguredJdbcConnections().find(
    (connection) => connection.enabled && connection.connectionId === connectionId
  );
}

function readSelectedJdbcDatabase(raw: unknown): JdbcSelectedDatabase | undefined {
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).connectionId === "string" &&
    typeof (raw as Record<string, unknown>).database === "string"
  ) {
    return raw as JdbcSelectedDatabase;
  }
  return undefined;
}

export const coreQueryEngineJdbcPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.jdbc",
    name: "Core Query Engine JDBC",
    version: "0.1.0",
    kind: "core",
    description: "JDBC connection setup and execution context wiring",
    dependencies: ["core.queryengine", "core.settings", "core.security", "core.files", "core.flow", "core.graph"],
    requiredCapabilities: ["query.engine"],
    providesCapabilities: ["query.engine.jdbc"]
  },
  activate: (context) => {
    registerWhenExpressionVariables([
      { name: "activeFile.metadata.core.queryengine.jdbc.database", type: "string", description: "Selected JDBC database name" },
      { name: "activeFile.metadata.core.queryengine.jdbc.connectionTitle", type: "string", description: "Human-readable title of the active JDBC connection" },
      { name: "activeFile.metadata.core.queryengine.jdbc.dialectId", type: "string", description: "SQL dialect of the active JDBC connection (e.g. 'sqlserver', 'postgresql')" },
      { name: "activeFile.metadata.core.queryengine.jdbc.supportsQueryPlan", type: "boolean", description: "True when the active JDBC dialect supports query plan generation" },
      { name: "activeFile.metadata.core.queryengine.jdbc.sessionConnection", type: "string", description: "Title of the JDBC connection that owns the active session" },
      { name: "activeFile.metadata.core.queryengine.jdbc.sessionState", type: "string", description: "State of the JDBC session: 'alive', 'dead', or 'none'" },
    ]);

    registerQueryExecutableEngine(context, {
      engineId: "jdbc",
      mimeTypes: ["application/sql"]
    });

    registerJdbcFlowNodeContribution();

    context.files.capabilities.registerLabel?.("application/sql", "Jdbc");
    context.files.capabilities.registerPreferredNewFileMimeType?.("application/sql", 10);
    context.files.capabilities.registerCapabilities(JDBC_SCHEMA_GRAPH_MIME_TYPE, ["viewable", "backupable"]);
    context.files.capabilities.registerContentCategory(JDBC_SCHEMA_GRAPH_MIME_TYPE, "text");
    context.files.capabilities.registerLabel?.(JDBC_SCHEMA_GRAPH_MIME_TYPE, "JDBC Schema Graph");
    context.files.capabilities.registerPreferredExtension?.(JDBC_SCHEMA_GRAPH_MIME_TYPE, JDBC_SCHEMA_GRAPH_EXTENSION);
    context.files.registerMimeResolver((_uri, hint) => {
      return hint?.extension?.toLowerCase() === JDBC_SCHEMA_GRAPH_EXTENSION
        ? JDBC_SCHEMA_GRAPH_MIME_TYPE
        : undefined;
    });
    context.files.registerEditorResolver((file) => {
      return file.mimeType === JDBC_SCHEMA_GRAPH_MIME_TYPE ? GRAPH_DOCUMENT_EDITOR_ID : undefined;
    });

    context.files.mimeIcons.registerMimeIcon({
      moduleId: "core.queryengine.jdbc",
      mimeType: "application/sql",
      icon: DatabaseIcon
    });
    context.files.mimeIcons.registerMimeIcon({
      moduleId: "core.queryengine.jdbc",
      mimeType: JDBC_SCHEMA_GRAPH_MIME_TYPE,
      icon: GraphIcon
    });

    for (const tool of createJdbcAssistantTools(context)) {
      context.assistant.registerToolContribution(tool);
    }

    context.layout.registerTabHeaderStyle({
      id: "core.queryengine.jdbc.tabHeaderStyle.connectionColor",
      order: 60,
      render: ({ file }) => {
        if (file.engineBinding?.engineId !== "jdbc") {
          return null;
        }
        const connectionId = file.engineBinding.connectionId;
        if (!connectionId) {
          return null;
        }
        const match = findEnabledJdbcConnection(connectionId);
        if (!match?.color) {
          return null;
        }
        return {
          className: "tab-accent",
          style: { "--tab-accent-color": match.color } as React.CSSProperties
        };
      }
    });

    context.settings.registerAdvancedValidator({
      id: "core.queryengine.jdbc.connections.validator",
      validate: ({ value }) => {
        if (!Array.isArray(value)) {
          return { ok: false, message: "Expected an array of JDBC connection definitions" };
        }

        const parsed = parseJdbcConnectionDefinitions(value);
        if (parsed.length !== value.length) {
          return {
            ok: false,
            message: "Each item must be unique and include a non-empty connectionId with either a url or dialect-specific connection properties"
          };
        }
        return { ok: true };
      }
    });

    context.settings.registerAdvancedRenderer({
      id: "core.queryengine.jdbc.connections.renderer",
      render: ({ value, setValue, readonly }) => (
        <JdbcConnectionsSettingsEditor value={value} readonly={readonly} setValue={setValue} />
      )
    });

    context.settings.registerAdvancedRenderer({
      id: "core.queryengine.jdbc.drivers.renderer",
      render: ({ readonly }) => <JdbcDriversSettingsEditor readonly={readonly} />
    });

    context.settings.registerSettings({
      moduleId: "core.queryengine.jdbc",
      title: "Query Engine JDBC",
      order: 32,
      settings: [
        {
          id: JDBC_CONNECTIONS_SETTING_ID,
          moduleId: "core.queryengine.jdbc",
          title: "JDBC Connections",
          description:
            "Configure JDBC connections with dialect, URL, username and vault-backed password.",
          sectionPath: ["Query Engine", "JDBC"],
          tags: ["jdbc", "sql", "connection"],
          type: "json",
          defaultValue: [],
          advanced: {
            rendererId: "core.queryengine.jdbc.connections.renderer",
            validatorId: "core.queryengine.jdbc.connections.validator"
          }
        },
        {
          id: JDBC_DRIVERS_SETTING_ID,
          moduleId: "core.queryengine.jdbc",
          title: "JDBC Drivers",
          description: "Inspect, install, update, and remove JDBC driver artifacts.",
          sectionPath: ["Query Engine", "JDBC", "Drivers"],
          tags: ["jdbc", "driver", "update", "install"],
          type: "json",
          defaultValue: [],
          advanced: { rendererId: "core.queryengine.jdbc.drivers.renderer" }
        },
        {
          id: JDBC_DRIVER_UPDATE_CHECK_SETTING_ID,
          moduleId: "core.queryengine.jdbc",
          title: "Check For JDBC Driver Updates",
          description: "Check for JDBC driver updates at startup and every 24 hours.",
          sectionPath: ["Query Engine", "JDBC", "Drivers"],
          tags: ["jdbc", "driver", "updates"],
          type: "boolean",
          defaultValue: true
        },
      ]
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }

    getJdbcNavigationStore().loadConnectionRoots();

    const resolveConnectionTitle = (connectionId: string): string => {
      const match = findEnabledJdbcConnection(connectionId);
      return match?.title?.trim() || connectionId;
    };

    const getCommandActiveFileId = (): string | null => {
      const commandContext = getCommandContext();
      return typeof commandContext.activeFileId === "string" && commandContext.activeFileId.length > 0
        ? commandContext.activeFileId
        : context.fileMediator.getActiveFileId();
    };

    const getActiveQueryFile = () => {
      const fileId = getCommandActiveFileId();
      return fileId ? context.files.getFile(fileId) : undefined;
    };

    const getToolbarQueryFile = (toolbarContext: LayoutToolbarContext) => toolbarContext.activeFile ?? getActiveQueryFile();

    context.commands.registerCommand({
      id: "core.queryengine.jdbc.navigation.refresh",
      title: "Refresh JDBC Tree",
      handler: () => {
        getJdbcNavigationStore().loadConnectionRoots();
        getJdbcDatabaseCache().invalidate();
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.jdbc.showEstimatedPlan",
      title: "Show Estimated Query Plan",
      category: "Query",
      enablement: JDBC_QUERY_PLAN_ENABLEMENT,
      handler: async () => {
        getQueryEngineService().requestExecute({
          outputIdOverride: PLAN_OUTPUT_ID,
          optionsOverride: {
            intent: "plan.estimated",
            requestedArtifacts: QUERY_PLAN_ARTIFACT_REQUEST
          }
        });
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.jdbc.toggleActualPlan",
      title: "Include Actual Query Plan",
      category: "Query",
      enablement: JDBC_QUERY_PLAN_ENABLEMENT,
      handler: async () => {
        const file = getActiveQueryFile();
        if (!file) {
          return;
        }
        const store = getQueryViewStateStore();
        const sessionId = getCommandSessionId(file.fileId);
        const current = store.read(file.fileId, sessionId).includeActualPlan === true;
        store.setIncludeActualPlan(file.fileId, sessionId, !current);
      }
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.jdbc.toolbar.showEstimatedPlan",
      title: "Estimated Plan",
      order: 44,
      commandId: "core.queryengine.jdbc.showEstimatedPlan",
      when: JDBC_QUERY_PLAN_WHEN
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.jdbc.toolbar.includeActualPlan",
      title: "Actual Plan",
      order: 45,
      commandId: "core.queryengine.jdbc.toggleActualPlan",
      when: JDBC_QUERY_PLAN_WHEN,
      pressed: (toolbarContext) => {
        const file = getToolbarQueryFile(toolbarContext);
        if (!file) {
          return false;
        }
        const sessionId = getToolbarSessionId(toolbarContext, file.fileId);
        return getQueryViewStateStore().read(file.fileId, sessionId).includeActualPlan === true;
      }
    });

    context.quickcommand.registerProvider(createJdbcDatabaseQuickCommandProvider(context));

    context.commands.registerCommand({
      id: "core.quickcommand.open.jdbc.databases",
      title: "Select Database",
      category: "Quick Command",
      handler: () => {
        getQuickCommandService()?.open("$", { when: "activeFile.mimeType == 'application/sql'" });
      }
    });

    context.keybindings.registerKeybinding({
      id: "core.quickcommand.open.jdbc.databases",
      commandId: "core.quickcommand.open.jdbc.databases",
      key: "F2",
      when: "global",
      scope: "global",
      order: 20
    });

    context.layout.registerView({
      id: "core.queryengine.jdbc.navigation",
      title: "JDBC",
      defaultZone: "primarySidebar",
      order: 30,
      canMoveZones: true,
      canCollapse: true,
      flex: 1,
      minHeight: 120,
      panelActions: [
        {
          id: "core.queryengine.jdbc.navigation.refresh",
          icon: "↺",
          title: "Refresh",
          commandId: "core.queryengine.jdbc.navigation.refresh"
        }
      ],
      when: "activeFile?.mimeType == 'application/sql'",
      render: () => <JdbcNavigationView context={context} />
    });

    context.layout.registerView({
      id: "core.queryengine.jdbc.schemaGraph",
      title: "Schema Graph Tables",
      defaultZone: "primarySidebar",
      order: 35,
      canCollapse: true,
      flex: 1,
      minHeight: 80,
      when: `activeFile?.mimeType == '${JDBC_SCHEMA_GRAPH_MIME_TYPE}'`,
      render: () => <JdbcSchemaGraphPanel context={context} />
    });

    const treeContextMenu = getJdbcTreeContextMenuRegistry();

    // Register custom graph node types for TABLE/VIEW rendering
    context.graphNodeTypes.registerNodeType({
      kind: ["TABLE", "VIEW"],
      component: SchemaTableNode,
    });

    treeContextMenu.registerContribution({
      id: "core.queryengine.jdbc.navigation.newQuery.connection",
      label: "New Query",
      order: 10,
      section: "query",
      matches: (node) => node.kind === "connection",
      run: async (node) => {
        const file = await context.fileMediator.createUntitledFile({
          mimeType: "application/sql",
          extension: "sql"
        });
        initJdbcFileBinding(file.fileId, node.connectionId, undefined, context.files);
      }
    });

    treeContextMenu.registerContribution({
      id: "core.queryengine.jdbc.navigation.newQuery.database",
      label: "New Query",
      order: 10,
      section: "query",
      matches: (node) => node.kind === "database",
      run: async (node) => {
        const file = await context.fileMediator.createUntitledFile({
          mimeType: "application/sql",
          extension: "sql"
        });
        const database = typeof node.attributes.catalog === "string"
          ? node.attributes.catalog
          : node.name;
        initJdbcFileBinding(file.fileId, node.connectionId, database, context.files);
      }
    });

    const createSchemaDiagram = async (node: JdbcTreeNode): Promise<void> => {
      const snapshot = await loadDeepSnapshot(node.connectionId);
      const graph = buildSchemaGraph(snapshot, node.name);
      const file = await context.fileMediator.createUntitledFile({
        mimeType: JDBC_SCHEMA_GRAPH_MIME_TYPE,
        extension: JDBC_SCHEMA_GRAPH_EXTENSION,
        title: `ER Diagram - ${node.name}`,
      });
      context.files.updateFile(file.fileId, {
        dirtyVsDisk: true,
        metadata: {
          ...(file.metadata ?? {}),
          schemaSource: "jdbc",
          graphDocument: graph,
        },
      });
      getGraphDocumentRepository().seedFile(file, graph, { notifyDirty: true });
      context.files.markDirty(file.fileId);
    };

    treeContextMenu.registerContribution({
      id: "core.queryengine.jdbc.showSchemaDiagram",
      label: "Schema Diagram",
      section: "diagram",
      order: 150,
      matches: (node) => node.kind === "database",
      run: async (node) => {
        await createSchemaDiagram(node);
      }
    });

    getQueryEngineService().registerExecutionContextProvider((params) => {
      if (params.engineId !== "jdbc" || !params.fileId) {
        return undefined;
      }

      const file = context.files.getFile(params.fileId);
      const connection = findEnabledJdbcConnection(file?.engineBinding?.connectionId);
      if (!connection) {
        return undefined;
      }
      const connectionId = connection.connectionId;

      const raw = context.files.getEditorState(params.fileId, JDBC_NAV_DB_KEY);
      const selectedDatabase = readSelectedJdbcDatabase(raw);

      const engineState: Record<string, unknown> = { connectionId };
      if (selectedDatabase?.connectionId === connectionId && selectedDatabase.database) {
        engineState.database = selectedDatabase.database;
      }
      const sessionId = file?.metadata?.[JDBC_SESSION_ID_METADATA_KEY];
      if (
        typeof sessionId === "string" &&
        sessionId.length > 0 &&
        sessionConnectionUuidMap.get(params.fileId) === connectionId
      ) {
        engineState.sessionId = sessionId;
      }

      return { engineState };
    });

    getQueryEngineService().onQueryEvent((event, executeContext) => {
      if (event.method !== "queryengine.completed") {
        return;
      }
      if (executeContext?.engineId !== "jdbc" || !executeContext.fileId) {
        return;
      }
      const file = context.files.getFile(executeContext.fileId);
      if (!file || file.mimeType !== "application/sql") {
        return;
      }
      const params = event.params as { engineState?: unknown };
      const es = params.engineState;
      if (es !== null && typeof es === "object" && !Array.isArray(es)) {
        const record = es as Record<string, unknown>;
        const database = record.database;
        const sessionId = record.sessionId;
        if (typeof sessionId === "string") {
          const metadata = { ...(file.metadata ?? {}) };
          const connectionId = findEnabledJdbcConnection(file.engineBinding?.connectionId)?.connectionId;
          if (sessionId.length > 0 && connectionId) {
            metadata[JDBC_SESSION_ID_METADATA_KEY] = sessionId;
            metadata[JDBC_SESSION_STATE_METADATA_KEY] = "alive";
            sessionConnectionUuidMap.set(executeContext.fileId, connectionId);
            const connTitle = findEnabledJdbcConnection(connectionId)?.title;
            if (connTitle) {
              metadata[JDBC_SESSION_CONNECTION_TITLE_KEY] = connTitle;
            }
          } else {
            delete metadata[JDBC_SESSION_ID_METADATA_KEY];
            delete metadata[JDBC_SESSION_CONNECTION_TITLE_KEY];
            sessionConnectionUuidMap.delete(executeContext.fileId);
            metadata[JDBC_SESSION_STATE_METADATA_KEY] = sessionId.length > 0 ? "none" : "dead";
          }
          context.files.updateFile(executeContext.fileId, { metadata });
        }
        if (typeof database === "string") {
          const connectionId = findEnabledJdbcConnection(file.engineBinding?.connectionId)?.connectionId;
          if (connectionId) {
            context.files.setEditorState(executeContext.fileId, JDBC_NAV_DB_KEY, {
              connectionId,
              database
            } satisfies JdbcSelectedDatabase);
            writeJdbcContextMetadata(executeContext.fileId, connectionId, database, context.files);
          }
        }
      }
    });

    // Tree Actions: when-expression variables for context variable autocomplete
    registerWhenExpressionVariables([
      { name: "node.kind", type: "string", description: "Kind of tree node (e.g. 'procedure', 'table', 'view', 'column', 'database')" },
      { name: "node.name", type: "string", description: "Name of the tree node (e.g. 'sp_help')" },
      { name: "node.fullName", type: "string", description: "Fully qualified name of the tree node (e.g. 'dbo.sp_help')" },
      { name: "node.nodeType", type: "string", description: "Node type: 'container', 'structural', 'folder', 'object', 'property'" },
      { name: "node.connectionId", type: "string", description: "Connection ID of the tree node" },
      { name: "node.dialectId", type: "string", description: "SQL dialect of the connection (e.g. 'sqlserver', 'postgresql')" },
    ]);

    // Tree Actions: register context menu provider
    createTreeActionProvider({
      treeContextMenu: getJdbcTreeContextMenuRegistry(),
      createUntitledFile: (options) => context.fileMediator.createUntitledFile(options),
      applyRecoveredContent: (fileId, content) => {
        getEditorRegistryHost().applyRecoveredContent(fileId, content);
      },
      setFileEngineBinding: (fileId, connectionId, database) => {
        initJdbcFileBinding(fileId, connectionId, database, context.files);
      },
      getActiveFileId: () => getCommandActiveFileId()
    });

    // Tree Actions: settings
    context.settings.registerAdvancedRenderer({
      id: TREE_ACTIONS_SETTING_ID,
      render: ({ value, setValue, readonly }) => (
        <TreeActionsSettingsEditor value={value} setValue={setValue} readonly={readonly} />
      )
    });
    context.settings.registerSettings({
      moduleId: "core.queryengine.jdbc",
      title: "Query Engine JDBC",
      order: 32,
      settings: [
        {
          id: TREE_ACTIONS_SETTING_ID,
          moduleId: "core.queryengine.jdbc",
          title: "Tree Actions",
          description: "Context menu actions that appear when right-clicking on nodes in the JDBC navigation tree.",
          sectionPath: ["Query Engine", "JDBC", "Tree Actions"],
          tags: ["jdbc", "tree", "actions", "context-menu"],
          type: "json",
          defaultValue: [],
          advanced: { rendererId: TREE_ACTIONS_SETTING_ID }
        }
      ]
    });

    // Sync tree actions from settings to the runtime registry when the settings service is ready.
    onCoreSettingsServiceInitialized((settingsService) => {
      settingsService.subscribe(() => {
        const current = settingsService.getValue(TREE_ACTIONS_SETTING_ID);
        if (Array.isArray(current)) {
          getTreeActionRegistry().setActions(current as TreeAction[]);
        }
        // Reload navigation tree when connections or any other setting changes
        getJdbcNavigationStore().loadConnectionRoots();
      });

      settingsService.refreshSchemaFromRegistry();

      const initial = settingsService.getValue(TREE_ACTIONS_SETTING_ID);
      if (Array.isArray(initial)) {
        getTreeActionRegistry().setActions(initial as TreeAction[]);
      }

      void settingsService.syncRegistryModules();
    });

    // Write metadata for any JDBC file the first time it appears in the registry
    // (covers workspace restore before JdbcConnectionSelector has mounted).
    const syncedFileIds = new Set<string>();
    const syncJdbcFileMetadata = (fileId: string): void => {
      const file = context.files.getFile(fileId);
      if (!file || file.engineBinding?.engineId !== "jdbc") {
        return;
      }

      const rawConnectionId = file.engineBinding.connectionId;
      const connection = findEnabledJdbcConnection(rawConnectionId);
      const selectedDatabase = readSelectedJdbcDatabase(context.files.getEditorState(file.fileId, JDBC_NAV_DB_KEY));

      if (!connection) {
        if (rawConnectionId) {
          context.files.setEditorState(file.fileId, JDBC_NAV_DB_KEY, undefined);
          context.files.updateFile(file.fileId, { engineBinding: { engineId: "jdbc" } });
        }
        writeJdbcContextMetadata(file.fileId, undefined, undefined, context.files);
        return;
      }

      const database = selectedDatabase?.connectionId === connection.connectionId
        ? selectedDatabase.database
        : undefined;
      if (selectedDatabase && selectedDatabase.connectionId !== connection.connectionId) {
        context.files.setEditorState(file.fileId, JDBC_NAV_DB_KEY, undefined);
      }
      writeJdbcContextMetadata(
        file.fileId,
        connection.connectionId,
        database || undefined,
        context.files
      );
    };

    context.files.subscribe((files) => {
      for (const file of files) {
        if (file.engineBinding?.engineId !== "jdbc" || syncedFileIds.has(file.fileId)) {
          continue;
        }
        syncedFileIds.add(file.fileId);
        syncJdbcFileMetadata(file.fileId);
      }
    });

    subscribeJdbcQueryPlanDialectSupport(() => {
      for (const file of context.files.listFiles()) {
        if (file.engineBinding?.engineId !== "jdbc") {
          continue;
        }
        syncJdbcFileMetadata(file.fileId);
      }
    });

    const sessionStore = getJdbcSessionStore();
    const sessionSyncStartedAtMs = Date.now();
    sessionStore.startPolling(5000);
    sessionStore.subscribe((state) => {
      if (state.updatedAtMs <= 0 || state.updatedAtMs < sessionSyncStartedAtMs) {
        return;
      }
      const byFileId = new Map(state.entries.map((entry) => [entry.fileId, entry]));
      for (const file of context.files.listFiles()) {
        if (file.engineBinding?.engineId !== "jdbc") {
          continue;
        }
        const metadata = { ...(file.metadata ?? {}) };
        const existingSessionId = metadata[JDBC_SESSION_ID_METADATA_KEY];
        const boundConnectionId = findEnabledJdbcConnection(file.engineBinding?.connectionId)?.connectionId;
        const match = byFileId.get(file.fileId);
        const nextSessionId =
          match?.status === "alive" &&
          typeof boundConnectionId === "string" &&
          match.connectionId === boundConnectionId
            ? match.sessionId
            : undefined;
        if (typeof nextSessionId === "string" && nextSessionId.length > 0) {
          const existingUuid = sessionConnectionUuidMap.get(file.fileId);
          if (existingSessionId !== nextSessionId || existingUuid !== boundConnectionId) {
            metadata[JDBC_SESSION_ID_METADATA_KEY] = nextSessionId;
            metadata[JDBC_SESSION_STATE_METADATA_KEY] = "alive";
            if (boundConnectionId) {
              sessionConnectionUuidMap.set(file.fileId, boundConnectionId);
              const connTitle = findEnabledJdbcConnection(boundConnectionId)?.title;
              if (connTitle) {
                metadata[JDBC_SESSION_CONNECTION_TITLE_KEY] = connTitle;
              }
            }
            context.files.updateFile(file.fileId, { metadata });
          }
          continue;
        }
        if (existingSessionId !== undefined || sessionConnectionUuidMap.has(file.fileId)) {
          delete metadata[JDBC_SESSION_ID_METADATA_KEY];
          delete metadata[JDBC_SESSION_CONNECTION_TITLE_KEY];
          sessionConnectionUuidMap.delete(file.fileId);
          metadata[JDBC_SESSION_STATE_METADATA_KEY] = match?.status === "dead" ? "dead" : "none";
          context.files.updateFile(file.fileId, { metadata });
        }
      }
    });

    context.layout.registerPanel({
      id: "core.queryengine.jdbc.panel",
      tabs: [
        {
          id: "core.queryengine.jdbc.panel",
          title: "JDBC",
          order: 20,
          render: () => <JdbcPanel files={context.files} fileMediator={context.fileMediator} />
        }
      ],
      defaultHeight: 220,
      minHeight: 120,
      maxHeight: 420
    });

    context.layout.registerTabTitle({
      id: "core.queryengine.jdbc.tabTitle.session",
      order: 20,
      render: ({ file, hasCapability }) => {
        if (!hasCapability("queryexecutable") || file.engineBinding?.engineId !== "jdbc") {
          return null;
        }
        const sessionId = file.metadata?.[JDBC_SESSION_ID_METADATA_KEY];
        if (
          typeof sessionId !== "string" ||
          sessionId.length === 0 ||
          !findEnabledJdbcConnection(file.engineBinding?.connectionId) ||
          sessionConnectionUuidMap.get(file.fileId) !== file.engineBinding?.connectionId
        ) {
          return null;
        }
        return { prefix: `(${sessionId}) ` };
      }
    });

    context.tooltip.registerTooltipSection({
      id: "core.queryengine.jdbc.tooltip.connection",
      order: 21,
      render: ({ file }) => {
        if (file.engineBinding?.engineId !== "jdbc") {
          return null;
        }
        const connection = findEnabledJdbcConnection(file.engineBinding.connectionId);
        if (!connection) {
          return null;
        }
        return {
          label: "Connection",
          value: resolveConnectionTitle(connection.connectionId)
        };
      }
    });

    context.tooltip.registerTooltipSection({
      id: "core.queryengine.jdbc.tooltip.session",
      order: 22,
      render: ({ file }) => {
        if (file.engineBinding?.engineId !== "jdbc") {
          return null;
        }
        const sessionId = file.metadata?.[JDBC_SESSION_ID_METADATA_KEY];
        if (
          typeof sessionId !== "string" ||
          sessionId.length === 0 ||
          !findEnabledJdbcConnection(file.engineBinding?.connectionId) ||
          sessionConnectionUuidMap.get(file.fileId) !== file.engineBinding?.connectionId
        ) {
          return null;
        }
        return {
          label: "Session Id",
          value: sessionId
        };
      }
    });

    context.tooltip.registerTooltipSection({
      id: "core.queryengine.jdbc.tooltip.state",
      order: 23,
      render: ({ file }) => {
        if (file.engineBinding?.engineId !== "jdbc") {
          return null;
        }
        const connection = findEnabledJdbcConnection(file.engineBinding.connectionId);
        if (!connection) {
          return null;
        }
        const sessionId = file.metadata?.[JDBC_SESSION_ID_METADATA_KEY];
        const state = file.metadata?.[JDBC_SESSION_STATE_METADATA_KEY];
        if (state === "dead") {
          return {
            label: "Connection State",
            value: "dead",
            severity: "warning"
          };
        }
        if (typeof sessionId !== "string" || sessionId.length === 0) {
          return null;
        }
        return {
          label: "Connection State",
          value: "alive"
        };
      }
    });

    registerQueryEditorStatusItem({
      id: "core.queryengine.jdbc.connectionStatus",
      alignment: "right",
      order: 100,
      render: ({ file }) => <JdbcConnectionStatus file={file} />
    });

    context.tooltip.registerTooltipSection({
      id: "core.queryengine.jdbc.tooltip.database",
      order: 24,
      render: ({ file }) => {
        if (file.engineBinding?.engineId !== "jdbc") {
          return null;
        }
        const selectedDatabase = readSelectedJdbcDatabase(context.files.getEditorState(file.fileId, JDBC_NAV_DB_KEY));
        const connectionId = findEnabledJdbcConnection(file.engineBinding?.connectionId)?.connectionId;
        if (
          !connectionId ||
          selectedDatabase?.connectionId !== connectionId ||
          !selectedDatabase.database
        ) {
          return null;
        }

        return {
          label: "Database",
          value: selectedDatabase.database
        };
      }
    });
  }
};
