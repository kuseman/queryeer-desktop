import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { registerPayloadbuilderHttpCatalogContribution } from "./http-catalog-contribution";

export const coreQueryEnginePayloadbuilderHttpPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.payloadbuilder.http",
    name: "Core Query Engine Payloadbuilder HTTP",
    version: "0.1.0",
    kind: "core",
    description: "HTTP catalog contribution for payloadbuilder",
    dependencies: ["core.queryengine.payloadbuilder"],
    requiredCapabilities: ["query.engine.payloadbuilder"],
    providesCapabilities: ["query.engine.payloadbuilder.http"]
  },
  activate: () => {
    registerPayloadbuilderHttpCatalogContribution();
  }
};
