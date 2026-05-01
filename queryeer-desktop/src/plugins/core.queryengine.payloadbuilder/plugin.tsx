import type { Plugin } from "../../contracts/plugin/Plugin";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { registerQueryExecutableEngine } from "../core.queryengine/engine-registration";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../core.settings/service";
import { CatalogInstancesSettingsEditor } from "./CatalogInstancesSettingsEditor";
import { getPayloadbuilderCatalogStore } from "./catalog-store";
import {
  parseCatalogAliasDefinitions,
  PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID
} from "./catalog-settings";
import { PayloadbuilderCatalogSidebar } from "./PayloadbuilderCatalogSidebar";
import {
  listPayloadbuilderCatalogContributions,
  subscribePayloadbuilderCatalogContributions
} from "./catalog-contributions";
import { LetterPIcon } from "./LetterPIcon";

export const coreQueryEnginePayloadbuilderPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.payloadbuilder",
    name: "Core Query Engine Payloadbuilder",
    version: "0.1.0",
    kind: "core",
    description: "Payloadbuilder engine state and catalog sidebar contributions",
    dependencies: ["core.queryengine", "core.layout", "core.files", "core.editor", "core.settings"],
    requiredCapabilities: ["query.engine"],
    providesCapabilities: ["query.engine.payloadbuilder"]
  },
  activate: (context) => {
    getPayloadbuilderCatalogStore().initialize(context.files);
    registerQueryExecutableEngine(context, {
      engineId: "payloadbuilder",
      mimeTypes: ["application/plbsql"]
    });

    context.files.mimeIcons.registerMimeIcon({
      moduleId: "core.queryengine.payloadbuilder",
      mimeType: "application/plbsql",
      icon: LetterPIcon
    });

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

        const multiplicity = validateMultiplicity(parsed);
        if (multiplicity) {
          return { ok: false, message: multiplicity };
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
      void adaptCatalogInstancesSettings(settingsService);
    }

    onCoreSettingsServiceInitialized((initializedSettingsService) => {
      void adaptCatalogInstancesSettings(initializedSettingsService);
    });

    subscribePayloadbuilderCatalogContributions(() => {
      const service = getCoreSettingsService();
      if (!service) {
        return;
      }
      void adaptCatalogInstancesSettings(service);
    });

    context.layout.registerView({
      id: "core.queryengine.payloadbuilder.catalogs",
      title: "Payloadbuilder",
      defaultZone: "primarySidebar",
      order: 40,
      canMoveZones: true,
      panelActions: [
        {
          id: "core.queryengine.payloadbuilder.catalogs.settings",
          icon: "⚙",
          title: "Open catalog alias mapping settings",
          commandId: "core.queryengine.payloadbuilder.catalogs.openSettings"
        }
      ],
      when: "activeFileMimeType == 'application/plbsql'",
      render: () => <PayloadbuilderCatalogSidebar />
    });

    context.commands.registerCommand({
      id: "core.queryengine.payloadbuilder.catalogs.openSettings",
      title: "Open Payloadbuilder Catalog Alias Mapping",
      category: "Preferences",
      handler: () => {
        const service = getCoreSettingsService();
        service?.openModalForSetting(PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID);
      }
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
      if (event.method !== "queryengine.completed") {
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

function validateMultiplicity(definitions: ReturnType<typeof parseCatalogAliasDefinitions>): string | undefined {
  const contributions = listPayloadbuilderCatalogContributions();
  const byCatalogId = new Map(contributions.map((item) => [item.catalogId, item]));
  const catalogUsage = new Map<string, number>();
  for (const definition of definitions) {
    const count = (catalogUsage.get(definition.catalogId) ?? 0) + 1;
    catalogUsage.set(definition.catalogId, count);
    const contribution = byCatalogId.get(definition.catalogId);
    if (contribution && !contribution.allowMultiple && count > 1) {
      return `Catalog '${definition.catalogId}' does not allow multiple aliases`;
    }
  }
  return undefined;
}

async function adaptCatalogInstancesSettings(settingsService: {
  getValue: (settingId: string) => unknown;
  setValue: (settingId: string, value: unknown) => Promise<{ ok: boolean }>;
}): Promise<void> {
  const current = parseCatalogAliasDefinitions(
    settingsService.getValue(PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID)
  );
  const merged = [...current];
  const byCatalogId = new Map<string, number>();
  for (const entry of current) {
    byCatalogId.set(entry.catalogId, (byCatalogId.get(entry.catalogId) ?? 0) + 1);
  }

  const takenAliases = new Set(current.map((item) => item.alias));
  for (const contribution of listPayloadbuilderCatalogContributions()) {
    const currentCount = byCatalogId.get(contribution.catalogId) ?? 0;
    if (currentCount > 0) {
      continue;
    }
    const alias = createUniqueAlias(contribution.defaultAlias, takenAliases);
    merged.push({
      alias,
      catalogId: contribution.catalogId,
      title: contribution.title,
      enabled: true
    });
    takenAliases.add(alias);
    byCatalogId.set(contribution.catalogId, 1);
  }

  if (merged.length === current.length) {
    return;
  }
  await settingsService.setValue(PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID, merged);
}

function createUniqueAlias(baseAlias: string, taken: Set<string>): string {
  const normalized = baseAlias.trim() || "catalog";
  if (!taken.has(normalized)) {
    return normalized;
  }
  let suffix = 2;
  while (taken.has(`${normalized}${suffix}`)) {
    suffix++;
  }
  return `${normalized}${suffix}`;
}
