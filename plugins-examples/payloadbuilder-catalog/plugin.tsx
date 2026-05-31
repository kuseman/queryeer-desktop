import type { Plugin } from "@queryeer/api/plugin/Plugin";
import type {
  PayloadbuilderCatalogContribution,
  PayloadbuilderCatalogPanelProps
} from "@queryeer/api/queryengine/PayloadbuilderCatalogExtension";
import { WeatherCatalogPanel, injectWeatherCatalogStyles } from "./WeatherCatalogPanel";

const weatherCatalogContribution: PayloadbuilderCatalogContribution = {
  catalogId: "example.fake",
  title: "Fake Catalog",
  defaultAlias: "fake",
  allowMultiple: false,
  order: 50,
  renderPanel: (props: PayloadbuilderCatalogPanelProps) => (
    <WeatherCatalogPanel {...props} />
  ),
  flowMappingFields: [
    {
      id: "defaultCategory",
      label: "Default Category",
      placeholder: "fruit or vegetable",
      kind: "text",
      required: false,
      persistAsLabel: false
    }
  ],
  filterPersistedProperties: (properties) => {
    return properties as Record<string, unknown>;
  },
  resolveRuntimeProperties: (properties) => {
    return { ...properties as Record<string, unknown>, _resolvedAt: new Date().toISOString() };
  }
};

export const weatherCatalogPlugin: Plugin = {
  manifest: {
    id: "example.payloadbuilder-catalog",
    name: "Fake Payloadbuilder Catalog",
    version: "0.1.0",
    kind: "feature",
    description: "A Payloadbuilder catalog example contributing a fake table and table-valued function",
    dependencies: ["core.queryengine.payloadbuilder"],
    requiredCapabilities: ["query.engine.payloadbuilder"]
  },
  activate: (context) => {
    injectWeatherCatalogStyles();

    context.payloadbuilderCatalog.registerContribution(weatherCatalogContribution);
  }
};
