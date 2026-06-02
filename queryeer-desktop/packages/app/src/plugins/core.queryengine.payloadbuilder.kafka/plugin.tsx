import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getCoreSettingsService } from "../core.settings/service";
import { KafkaConnectionsSettingsEditor } from "./KafkaConnectionsSettingsEditor";
import { registerPayloadbuilderKafkaCatalogContribution } from "./kafka-catalog-contribution";
import {
  parseKafkaConnectionDefinitions,
  PAYLOADBUILDER_KAFKA_CONNECTIONS_SETTING_ID
} from "./kafka-settings";

export const coreQueryEnginePayloadbuilderKafkaPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.payloadbuilder.kafka",
    name: "Core Query Engine Payloadbuilder Kafka",
    version: "0.1.0",
    kind: "core",
    description: "Kafka catalog contribution for payloadbuilder",
    dependencies: [
      "core.queryengine.payloadbuilder",
      "core.queryengine",
      "core.settings",
      "core.security"
    ],
    requiredCapabilities: ["query.engine.payloadbuilder"],
    providesCapabilities: ["query.engine.payloadbuilder.kafka"]
  },
  activate: (context) => {
    registerPayloadbuilderKafkaCatalogContribution();

    context.settings.registerAdvancedValidator({
      id: "core.queryengine.payloadbuilder.kafka.connections.validator",
      validate: ({ value }) => {
        if (!Array.isArray(value)) {
          return { ok: false, message: "Expected an array of Kafka connection definitions" };
        }

        const parsed = parseKafkaConnectionDefinitions(value);
        if (parsed.length !== value.length) {
          return {
            ok: false,
            message:
              "Each item must be unique and include non-empty connectionId and bootstrap servers"
          };
        }

        return { ok: true };
      }
    });

    context.settings.registerAdvancedRenderer({
      id: "core.queryengine.payloadbuilder.kafka.connections.renderer",
      render: ({ value, setValue, readonly }) => (
        <KafkaConnectionsSettingsEditor
          value={value}
          setValue={setValue}
          readonly={readonly}
        />
      )
    });

    context.settings.registerSettings({
      moduleId: "core.queryengine.payloadbuilder.kafka",
      title: "Query Engine Payloadbuilder Kafka",
      order: 32,
      settings: [
        {
          id: PAYLOADBUILDER_KAFKA_CONNECTIONS_SETTING_ID,
          moduleId: "core.queryengine.payloadbuilder.kafka",
          title: "Kafka Connections",
          description:
            "Define reusable Kafka cluster connections. Example: [{\"connectionId\":\"broker1\",\"bootstrapServers\":\"localhost:9092\"}]",
          sectionPath: ["Query Engine", "Payloadbuilder", "Kafka"],
          tags: ["payloadbuilder", "kafka", "connection", "cluster"],
          type: "json",
          defaultValue: [],
          advanced: {
            rendererId: "core.queryengine.payloadbuilder.kafka.connections.renderer",
            validatorId: "core.queryengine.payloadbuilder.kafka.connections.validator"
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
