import type { Plugin } from "../../contracts/plugin/Plugin";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getCoreSettingsService } from "../core.settings/service";
import { CatalogInstancesSettingsEditor } from "./CatalogInstancesSettingsEditor";
import { getPayloadbuilderCatalogStore } from "./catalog-store";
import {
  parseCatalogAliasDefinitions,
  PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID
} from "./catalog-settings";
import { PayloadbuilderCatalogSidebar } from "./PayloadbuilderCatalogSidebar";

export const coreQueryEnginePayloadbuilderPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.payloadbuilder",
    name: "Core Query Engine Payloadbuilder",
    version: "0.1.0",
    kind: "core",
    description: "Payloadbuilder engine state and catalog sidebar contributions",
    dependencies: ["core.queryengine", "core.layout", "core.files", "core.editor", "core.settings"],
    providesCapabilities: ["query.engine.payloadbuilder"]
  },
  activate: (context) => {
    getPayloadbuilderCatalogStore().initialize(context.files);

    context.settings.registerAdvancedValidator({
      id: "core.queryengine.payloadbuilder.catalogInstances.validator",
      validate: ({ value }) => {
        if (!Array.isArray(value)) {
          return { ok: false, message: "Expected an array of alias definitions" };
        }

        const parsed = parseCatalogAliasDefinitions(value);
        if (parsed.length !== value.length) {
          return {
            ok: false,
            message:
              "Each item must be unique and include non-empty alias and catalogId"
          };
        }

        return { ok: true };
      }
    });

    context.settings.registerAdvancedRenderer({
      id: "core.queryengine.payloadbuilder.catalogInstances.renderer",
      render: ({ value, setValue, readonly }) => (
        <CatalogInstancesSettingsEditor value={value} setValue={setValue} readonly={readonly} />
      )
    });

    context.settings.registerSettings({
      moduleId: "core.queryengine.payloadbuilder",
      title: "Query Engine Payloadbuilder",
      order: 30,
      settings: [
        {
          id: PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID,
          moduleId: "core.queryengine.payloadbuilder",
          title: "Catalog Alias Mapping",
          description:
            "Define aliases and mapped catalog ids. Example: [{\"alias\":\"es1\",\"catalogId\":\"elasticsearch\"}]",
          sectionPath: ["Query Engine", "Payloadbuilder"],
          tags: ["payloadbuilder", "catalog", "alias"],
          type: "json",
          defaultValue: [],
          advanced: {
            rendererId: "core.queryengine.payloadbuilder.catalogInstances.renderer",
            validatorId: "core.queryengine.payloadbuilder.catalogInstances.validator"
          }
        }
      ]
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }

    context.layout.registerView({
      id: "core.queryengine.payloadbuilder.catalogs",
      title: "Payloadbuilder",
      defaultZone: "primarySidebar",
      order: 40,
      canMoveZones: true,
      render: () => <PayloadbuilderCatalogSidebar />
    });

    getQueryEngineService().registerExecutionContextProvider((params) => {
      if (params.engineId !== "payloadbuilder") {
        return undefined;
      }
      return {
        engineState: getPayloadbuilderCatalogStore().buildEngineState(params.fileId)
      };
    });

    getQueryEngineService().onQueryEvent((event, executeContext) => {
      if (event.method !== "query.completed") {
        return;
      }
      if (executeContext?.engineId !== "payloadbuilder" || !executeContext.fileId) {
        return;
      }
      const params = event.params as { engineStatePatch?: unknown };
      if (!params.engineStatePatch) {
        return;
      }
      getPayloadbuilderCatalogStore().applyEngineStatePatch(
        executeContext.fileId,
        params.engineStatePatch
      );
    });
  }
};
