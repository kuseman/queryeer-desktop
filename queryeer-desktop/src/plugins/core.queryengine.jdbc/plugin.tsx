import type { Plugin } from "../../contracts/plugin/Plugin";
import { registerQueryExecutableEngine } from "../core.queryengine/engine-registration";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getCoreSettingsService } from "../core.settings/service";
import { JdbcConnectionsSettingsEditor } from "./JdbcConnectionsSettingsEditor";
import {
  getConfiguredJdbcConnections,
  JDBC_CONNECTIONS_SETTING_ID,
  parseJdbcConnectionDefinitions
} from "./jdbc-settings";
import { DatabaseIcon } from "./DatabaseIcon";
import { getJdbcNavigationStore } from "./jdbc-navigation-store";
import { JdbcNavigationView } from "./JdbcNavigationView";

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
    registerQueryExecutableEngine(context, {
      engineId: "jdbc",
      mimeTypes: ["application/sql"]
    });

    context.files.mimeIcons.registerMimeIcon({
      moduleId: "core.queryengine.jdbc",
      mimeType: "application/sql",
      icon: DatabaseIcon
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
            message: "Each item must be unique and include non-empty connectionId and url"
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
        }
      ]
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }

    getJdbcNavigationStore().loadConnectionRoots();

    context.commands.registerCommand({
      id: "core.queryengine.jdbc.navigation.refresh",
      title: "Refresh JDBC Tree",
      handler: () => {
        getJdbcNavigationStore().loadConnectionRoots();
      }
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
      when: "activeFileMimeType == 'application/sql'",
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

      const connection = getConfiguredJdbcConnections().find(
        (item) => item.connectionId === connectionId && item.enabled
      );
      if (!connection) {
        return undefined;
      }

      return {
        engineState: {
          jdbc: {
            connection: {
              connectionId: connection.connectionId,
              dialectId: connection.dialectId,
              url: connection.url,
              username: connection.username,
              password: connection.password
            }
          }
        }
      };
    });
  }
};
