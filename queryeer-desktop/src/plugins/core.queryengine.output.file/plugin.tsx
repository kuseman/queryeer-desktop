import type { Plugin } from "../../contracts/plugin/Plugin";
import { getOutputRegistry } from "../core.queryengine/output/OutputRegistry";
import outputFileIconUrl from "./output-file.svg";

export const coreQueryEngineOutputFilePlugin: Plugin = {
  manifest: {
    id: "core.queryengine.output.file",
    name: "Query Engine Output: File",
    version: "0.1.0",
    kind: "core",
    description: "File output contributor — writes query results directly to a file",
    dependencies: ["core.queryengine"],
    requiredCapabilities: ["query.engine"]
  },
  activate: () => {
    getOutputRegistry().register({
      id: "core.queryengine.output.file",
      capability: "rows",
      mode: "primary",
      selectable: true,
      showInPanel: false,
      title: "File",
      icon: outputFileIconUrl,
      priority: 150,
      render: () => null
    });
  }
};
