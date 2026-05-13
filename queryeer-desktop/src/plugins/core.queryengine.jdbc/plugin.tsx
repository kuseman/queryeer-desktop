import type { Plugin } from "../../contracts/plugin/Plugin";
import { registerQueryExecutableEngine } from "../core.queryengine/engine-registration";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getCoreSettingsService } from "../core.settings/service";
import { JdbcConnectionsSettingsEditor } from "./JdbcConnectionsSettingsEditor";
import {
  JDBC_CONNECTIONS_SETTING_ID,
  getConfiguredJdbcConnections,
  parseJdbcConnectionDefinitions
} from "./jdbc-settings";
import { getJdbcSessionStore } from "./jdbc-session-store";
import { JdbcConnectionsPanel } from "./JdbcConnectionsPanel";
import { DatabaseIcon } from "./DatabaseIcon";
import { getJdbcNavigationStore } from "./jdbc-navigation-store";
import { JdbcNavigationView } from "./JdbcNavigationView";
import { JDBC_NAV_DB_KEY, type JdbcSelectedDatabase } from "./jdbc-navigation-types";
import { writeJdbcContextMetadata } from "./jdbc-metadata";
import { registerWhenExpressionVariables } from "../core.commands/when-expression-variable-registry";
import { registerWhenExpressionTemplates } from "../core.commands/when-expression-template-registry";
import { registerSymbolActionTemplate } from "../core.queryengine/symbol-action-template-registry";
import { registerTableActionTemplate } from "../core.queryengine.output.table/table-action-template-registry";
import { getQuickCommandService } from "../core.quickcommand/service";
import { createJdbcDatabaseQuickCommandProvider } from "./jdbc-database-quick-command";
import { getJdbcDatabaseCache } from "./jdbc-database-cache";

const JDBC_SESSION_ID_METADATA_KEY = "core.queryengine.jdbc.sessionId";
const JDBC_SESSION_CONNECTION_TITLE_KEY = "core.queryengine.jdbc.sessionConnection";
const JDBC_SESSION_STATE_METADATA_KEY = "core.queryengine.jdbc.sessionState";
// Tracks which connectionId (UUID) each file's session was established with.
// Kept in memory — same lifetime as metadata, which is also not persisted.
const sessionConnectionUuidMap = new Map<string, string>();
export const coreQueryEngineJdbcPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.jdbc",
    name: "Core Query Engine JDBC",
    version: "0.1.0",
    kind: "core",
    description: "JDBC connection setup and execution context wiring",
    dependencies: ["core.queryengine", "core.settings", "core.security", "core.files"],
    requiredCapabilities: ["query.engine"],
    providesCapabilities: ["query.engine.jdbc"]
  },
  activate: (context) => {
    registerWhenExpressionVariables([
      { name: "activeFile.metadata.core.queryengine.jdbc.database", type: "string", description: "Selected JDBC database name" },
      { name: "activeFile.metadata.core.queryengine.jdbc.connectionTitle", type: "string", description: "Human-readable title of the active JDBC connection" },
      { name: "activeFile.metadata.core.queryengine.jdbc.dialectId", type: "string", description: "SQL dialect of the active JDBC connection (e.g. 'sqlserver', 'postgresql')" },
      { name: "activeFile.metadata.core.queryengine.jdbc.sessionConnection", type: "string", description: "Title of the JDBC connection that owns the active session" },
      { name: "activeFile.metadata.core.queryengine.jdbc.sessionState", type: "string", description: "State of the JDBC session: 'alive', 'dead', or 'none'" },
    ]);

    registerWhenExpressionTemplates([
      {
        name: "SQLServer Database",
        description: "Match SQL files using SQL Server against a specific selected database",
        when: "activeFile.mimeType == 'application/sql' && activeFile.metadata.core.queryengine.jdbc.dialectId == 'sqlserver' && activeFile.metadata.core.queryengine.jdbc.database == 'OrderService'"
      }
    ]);

    registerSymbolActionTemplate({
      id: "core.queryengine.jdbc.symbolAction.sqlserverDescribe",
      title: "SQLServer Describe",
      description: "Describe a table or view in SQL Server",
      order: 10,
      action: {
        label: "Describe",
        when: "activeFile.mimeType == 'application/sql' && activeFile.metadata.core.queryengine.jdbc.dialectId == 'sqlserver' && (symbol.kind == 'table' || symbol.kind == 'view')",
        query: "exec sp_help '${symbol.name}'"
      }
    });

    registerTableActionTemplate({
      id: "core.queryengine.jdbc.tableAction.correlatedDocuments",
      title: "SQLServer Correlated Documents",
      description: "Find rows correlated by a common ID within a ±5 minute window",
      order: 10,
      action: {
        label: "Correlated documents of ${tableData.rows[tableData.primaryRowIndex].correlationId}",
        when: "activeFile.mimeType == 'application/sql' && tableData.columns.some(c => c.name == 'correlationId') && tableData.columns.some(c => c.name == '@timestamp')",
        query: "SELECT * FROM _doc\nWHERE correlationId = ${fn.sql.literal(tableData.rows[tableData.primaryRowIndex].correlationId)}\nAND [@timestamp] >= '${fn.date.add(tableData.rows[tableData.primaryRowIndex][\"@timestamp\"], \"minute\", -5)}'\nAND [@timestamp] <= '${fn.date.add(tableData.rows[tableData.primaryRowIndex][\"@timestamp\"], \"minute\", 5)}'",
        mode: "execute",
        outputTarget: "output"
      }
    });

    registerQueryExecutableEngine(context, {
      engineId: "jdbc",
      mimeTypes: ["application/sql"]
    });

    context.files.capabilities.registerLabel?.("application/sql", "Jdbc");
    context.files.capabilities.registerPreferredNewFileMimeType?.("application/sql", 10);

    context.files.mimeIcons.registerMimeIcon({
      moduleId: "core.queryengine.jdbc",
      mimeType: "application/sql",
      icon: DatabaseIcon
    });

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
        const connections = getConfiguredJdbcConnections();
        const match = connections.find((c) => c.connectionId === connectionId);
        if (!match?.color) {
          return null;
        }
        return {
          style: { backgroundColor: match.color }
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
      ]
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }

    getJdbcNavigationStore().loadConnectionRoots();

    const resolveConnectionTitle = (connectionId: string): string => {
      const match = getConfiguredJdbcConnections().find((entry) => entry.connectionId === connectionId);
      return match?.title?.trim() || connectionId;
    };

    context.commands.registerCommand({
      id: "core.queryengine.jdbc.navigation.refresh",
      title: "Refresh JDBC Tree",
      handler: () => {
        getJdbcNavigationStore().loadConnectionRoots();
        getJdbcDatabaseCache().invalidate();
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
      when: "activeFile.mimeType == 'application/sql'",
      render: () => <JdbcNavigationView context={context} />
    });

    getQueryEngineService().registerExecutionContextProvider((params) => {
      if (params.engineId !== "jdbc" || !params.fileId) {
        return undefined;
      }

      const file = context.files.getFile(params.fileId);
      const connectionId = file?.engineBinding?.connectionId;
      if (!connectionId) {
        return undefined;
      }

      const raw = context.files.getEditorState(params.fileId, JDBC_NAV_DB_KEY);
      const selectedDatabase: JdbcSelectedDatabase | undefined =
        raw !== null &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        typeof (raw as Record<string, unknown>).connectionId === "string" &&
        typeof (raw as Record<string, unknown>).database === "string"
          ? (raw as JdbcSelectedDatabase)
          : undefined;

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
      const params = event.params as { engineState?: unknown };
      const es = params.engineState;
      if (es !== null && typeof es === "object" && !Array.isArray(es)) {
        const record = es as Record<string, unknown>;
        const database = record.database;
        const sessionId = record.sessionId;
        if (typeof sessionId === "string") {
          const file = context.files.getFile(executeContext.fileId);
          if (file) {
            const metadata = { ...(file.metadata ?? {}) };
            const connectionId = file.engineBinding?.connectionId;
            if (sessionId.length > 0) {
              metadata[JDBC_SESSION_ID_METADATA_KEY] = sessionId;
              metadata[JDBC_SESSION_STATE_METADATA_KEY] = "alive";
              if (typeof connectionId === "string" && connectionId.length > 0) {
                sessionConnectionUuidMap.set(executeContext.fileId, connectionId);
                const connTitle = getConfiguredJdbcConnections().find((c) => c.connectionId === connectionId)?.title;
                if (connTitle) {
                  metadata[JDBC_SESSION_CONNECTION_TITLE_KEY] = connTitle;
                }
              }
            } else {
              delete metadata[JDBC_SESSION_ID_METADATA_KEY];
              delete metadata[JDBC_SESSION_CONNECTION_TITLE_KEY];
              sessionConnectionUuidMap.delete(executeContext.fileId);
              metadata[JDBC_SESSION_STATE_METADATA_KEY] = "dead";
            }
            context.files.updateFile(executeContext.fileId, { metadata });
          }
        }
        if (typeof database === "string") {
          const file = context.files.getFile(executeContext.fileId);
          const connectionId = file?.engineBinding?.connectionId;
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

    // Write metadata for any JDBC file the first time it appears in the registry
    // (covers workspace restore before JdbcConnectionSelector has mounted).
    const syncedFileIds = new Set<string>();
    context.files.subscribe((files) => {
      for (const file of files) {
        if (file.engineBinding?.engineId !== "jdbc" || syncedFileIds.has(file.fileId)) {
          continue;
        }
        syncedFileIds.add(file.fileId);
        const connectionId = file.engineBinding.connectionId;
        const persisted = context.files.getEditorState(file.fileId, JDBC_NAV_DB_KEY) as { database?: string } | null;
        writeJdbcContextMetadata(
          file.fileId,
          connectionId || undefined,
          persisted?.database || undefined,
          context.files
        );
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
        const boundConnectionId = file.engineBinding?.connectionId;
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
              const connTitle = getConfiguredJdbcConnections().find((c) => c.connectionId === boundConnectionId)?.title;
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
          id: "core.queryengine.jdbc.panel.sessions",
          title: "JDBC Sessions",
          order: 20,
          render: () => <JdbcConnectionsPanel files={context.files} fileMediator={context.fileMediator} />
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
        const connectionId = file.engineBinding.connectionId;
        if (!connectionId) {
          return null;
        }
        return {
          label: "Connection",
          value: resolveConnectionTitle(connectionId)
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
          sessionConnectionUuidMap.get(file.fileId) !== file.engineBinding?.connectionId
        ) {
          return null;
        }
        return {
          label: "Session",
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
        const sessionId = file.metadata?.[JDBC_SESSION_ID_METADATA_KEY];
        const state = file.metadata?.[JDBC_SESSION_STATE_METADATA_KEY];
        if (state === "dead") {
          return {
            label: "State",
            value: "dead",
            severity: "warning"
          };
        }
        if (typeof sessionId !== "string" || sessionId.length === 0) {
          return null;
        }
        return {
          label: "State",
          value: "alive"
        };
      }
    });

    context.tooltip.registerTooltipSection({
      id: "core.queryengine.jdbc.tooltip.database",
      order: 24,
      render: ({ file }) => {
        if (file.engineBinding?.engineId !== "jdbc") {
          return null;
        }
        const raw = context.files.getEditorState(file.fileId, JDBC_NAV_DB_KEY);
        const selectedDatabase: JdbcSelectedDatabase | undefined =
          raw !== null &&
          typeof raw === "object" &&
          !Array.isArray(raw) &&
          typeof (raw as Record<string, unknown>).connectionId === "string" &&
          typeof (raw as Record<string, unknown>).database === "string"
            ? (raw as JdbcSelectedDatabase)
            : undefined;

        const connectionId = file.engineBinding?.connectionId;
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
