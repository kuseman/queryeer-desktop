import type { Plugin } from "../../contracts/plugin/Plugin";
import { registerPayloadbuilderFilesystemCatalogContribution } from "./filesystem-catalog-contribution";

export const coreQueryEnginePayloadbuilderFilesystemPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.payloadbuilder.filesystem",
    name: "Core Query Engine Payloadbuilder Filesystem",
    version: "0.1.0",
    kind: "core",
    description: "Filesystem catalog contribution for payloadbuilder",
    dependencies: ["core.queryengine.payloadbuilder"],
    requiredCapabilities: ["query.engine.payloadbuilder"],
    providesCapabilities: ["query.engine.payloadbuilder.filesystem"]
  },
  activate: () => {
    registerPayloadbuilderFilesystemCatalogContribution();
  }
};
