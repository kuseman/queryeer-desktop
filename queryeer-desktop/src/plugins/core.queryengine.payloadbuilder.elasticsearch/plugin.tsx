import type { Plugin } from "../../contracts/plugin/Plugin";
import { getCoreSettingsService } from "../core.settings/service";
import { ElasticsearchConnectionsSettingsEditor } from "./ElasticsearchConnectionsSettingsEditor";
import { registerPayloadbuilderElasticsearchCatalogContribution } from "./elasticsearch-catalog-contribution";
import {
  parseElasticsearchConnectionDefinitions,
  PAYLOADBUILDER_ELASTICSEARCH_CONNECTIONS_SETTING_ID
} from "./elasticsearch-settings";

export const coreQueryEnginePayloadbuilderElasticsearchPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.payloadbuilder.elasticsearch",
    name: "Core Query Engine Payloadbuilder Elasticsearch",
    version: "0.1.0",
    kind: "core",
    description: "Elasticsearch catalog contribution for payloadbuilder",
    dependencies: [
      "core.queryengine.payloadbuilder",
      "core.queryengine",
      "core.settings",
      "core.security"
    ],
    providesCapabilities: ["query.engine.payloadbuilder.elasticsearch"]
  },
  activate: (context) => {
    registerPayloadbuilderElasticsearchCatalogContribution();

    context.settings.registerAdvancedValidator({
      id: "core.queryengine.payloadbuilder.elasticsearch.connections.validator",
      validate: ({ value }) => {
        if (!Array.isArray(value)) {
          return { ok: false, message: "Expected an array of Elasticsearch connection definitions" };
        }

        const parsed = parseElasticsearchConnectionDefinitions(value);
        if (parsed.length !== value.length) {
          return {
            ok: false,
            message:
              "Each item must be unique and include non-empty connectionId and endpoint"
          };
        }

        return { ok: true };
      }
    });

    context.settings.registerAdvancedRenderer({
      id: "core.queryengine.payloadbuilder.elasticsearch.connections.renderer",
      render: ({ value, setValue, readonly }) => (
        <ElasticsearchConnectionsSettingsEditor
          value={value}
          setValue={setValue}
          readonly={readonly}
        />
      )
    });

    context.settings.registerSettings({
      moduleId: "core.queryengine.payloadbuilder.elasticsearch",
      title: "Query Engine Payloadbuilder Elasticsearch",
      order: 31,
      settings: [
        {
          id: PAYLOADBUILDER_ELASTICSEARCH_CONNECTIONS_SETTING_ID,
          moduleId: "core.queryengine.payloadbuilder.elasticsearch",
          title: "Elasticsearch Connections",
          description:
            "Define reusable Elasticsearch cluster connections. Example: [{\"connectionId\":\"cluster1\",\"endpoint\":\"https://localhost:9200\"}]",
          sectionPath: ["Query Engine", "Payloadbuilder", "Elasticsearch"],
          tags: ["payloadbuilder", "elasticsearch", "connection", "cluster"],
          type: "json",
          defaultValue: [],
          advanced: {
            rendererId: "core.queryengine.payloadbuilder.elasticsearch.connections.renderer",
            validatorId: "core.queryengine.payloadbuilder.elasticsearch.connections.validator"
          }
        }
      ]
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }
  }
};
