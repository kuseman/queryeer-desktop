import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getCoreSettingsService } from "../core.settings/service";
import { MongoConnectionsSettingsEditor } from "./MongoConnectionsSettingsEditor";
import { registerPayloadbuilderMongoCatalogContribution } from "./mongodb-catalog-contribution";
import {
  parseMongoConnectionDefinitions,
  PAYLOADBUILDER_MONGODB_CONNECTIONS_SETTING_ID
} from "./mongodb-settings";

export const coreQueryEnginePayloadbuilderMongoPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.payloadbuilder.mongodb",
    name: "Core Query Engine Payloadbuilder MongoDB",
    version: "0.1.0",
    kind: "core",
    description: "MongoDB catalog contribution for payloadbuilder",
    dependencies: ["core.queryengine.payloadbuilder", "core.settings", "core.security"],
    requiredCapabilities: ["query.engine.payloadbuilder"],
    providesCapabilities: ["query.engine.payloadbuilder.mongodb"]
  },
  activate: (context) => {
    registerPayloadbuilderMongoCatalogContribution();
    context.settings.registerAdvancedValidator({
      id: "core.queryengine.payloadbuilder.mongodb.connections.validator",
      validate: ({ value }) => Array.isArray(value) && parseMongoConnectionDefinitions(value).length === value.length
        ? { ok: true }
        : { ok: false, message: "Each item must be unique and include a connectionId and MongoDB connection string" }
    });
    context.settings.registerAdvancedRenderer({
      id: "core.queryengine.payloadbuilder.mongodb.connections.renderer",
      render: ({ value, setValue, readonly }) => <MongoConnectionsSettingsEditor value={value} setValue={setValue} readonly={readonly} />
    });
    context.settings.registerSettings({
      moduleId: "core.queryengine.payloadbuilder.mongodb",
      title: "Query Engine Payloadbuilder MongoDB",
      order: 33,
      settings: [{
        id: PAYLOADBUILDER_MONGODB_CONNECTIONS_SETTING_ID,
        moduleId: "core.queryengine.payloadbuilder.mongodb",
        title: "MongoDB Connections",
        description: "Define reusable MongoDB connections without embedding passwords in connection strings.",
        sectionPath: ["Query Engine", "Payloadbuilder", "MongoDB"],
        tags: ["payloadbuilder", "mongodb", "connection"],
        type: "json",
        defaultValue: [],
        advanced: {
          rendererId: "core.queryengine.payloadbuilder.mongodb.connections.renderer",
          validatorId: "core.queryengine.payloadbuilder.mongodb.connections.validator"
        }
      }]
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }
  }
};
