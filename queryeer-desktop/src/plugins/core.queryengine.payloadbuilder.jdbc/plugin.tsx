import type { Plugin } from "../../contracts/plugin/Plugin";
import { registerPayloadbuilderJdbcCatalogContribution } from "./payloadbuilder-jdbc-catalog-contribution";

export const coreQueryEnginePayloadbuilderJdbcPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.payloadbuilder.jdbc",
    name: "Core Query Engine Payloadbuilder JDBC",
    version: "0.1.0",
    kind: "core",
    description: "JDBC catalog contribution for payloadbuilder",
    dependencies: ["core.queryengine.payloadbuilder", "core.queryengine.jdbc"],
    requiredCapabilities: ["query.engine.payloadbuilder", "query.engine.jdbc"],
    providesCapabilities: ["query.engine.payloadbuilder.jdbc"]
  },
  activate: () => {
    registerPayloadbuilderJdbcCatalogContribution();
  }
};
