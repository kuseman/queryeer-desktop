import type { Plugin } from "../../contracts/plugin/Plugin";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import { registerWhenExpressionVariables } from "../core.commands/when-expression-variable-registry";
import { registerWhenExpressionTemplates } from "../core.commands/when-expression-template-registry";
import { registerSymbolActionTemplate } from "../core.queryengine/symbol-action-template-registry";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { registerQueryExecutableEngine } from "../core.queryengine/engine-registration";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../core.settings/service";
import { CatalogInstancesSettingsEditor } from "./CatalogInstancesSettingsEditor";
import { PayloadbuilderEnvironmentsSettingsEditor } from "./PayloadbuilderEnvironmentsSettingsEditor";
import { getPayloadbuilderCatalogStore, type PayloadbuilderCatalogStore } from "./catalog-store";
import {
  parseCatalogAliasDefinitions,
  PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID
} from "./catalog-settings";
import {
  parsePayloadbuilderEnvironments,
  getPayloadbuilderEnvironments,
  PAYLOADBUILDER_ENVIRONMENTS_SETTING_ID
} from "./environment-settings";
import { PayloadbuilderCatalogSidebar } from "./PayloadbuilderCatalogSidebar";
import { getEditorRegistryHost } from "../../core/plugin-runtime/ExtensionRegistry";
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
    registerWhenExpressionVariables([
      { name: "activeFile.metadata.core.queryengine.payloadbuilder.enabledCatalogs", type: "string", description: "Comma-separated enabled PayloadBuilder catalog aliases (e.g. 'es1,oss2')" },
      { name: "activeFile.metadata.core.queryengine.payloadbuilder.selectedEnvironment", type: "string", description: "Title of the selected PayloadBuilder environment (e.g. 'Production')" },
      { name: "activeFile.metadata.core.queryengine.payloadbuilder.defaultCatalogAlias", type: "string", description: "Default PayloadBuilder catalog alias for the file" },
    ]);

    registerWhenExpressionTemplates([
      {
        name: "Payloadbuilder",
        description: "Match Payloadbuilder files where Elasticsearch is default",
        when: "activeFile.mimeType == 'application/plbsql' && activeFile.metadata.core.queryengine.payloadbuilder.defaultCatalogAlias.toLowerCase() == 'es'"
      }
    ]);

    registerSymbolActionTemplate({
      id: "core.queryengine.payloadbuilder.symbolAction.describe",
      title: "Payloadbuilder Top 500",
      description: "Top 500 row for a table",
      order: 20,
      action: {
        label: "Describe",
        when: "activeFile.mimeType == 'application/plbsql' && (symbol.kind == 'table' || symbol.kind == 'view')",
        query: "exec sp_help '${symbol.name}'"
      }
    });

    getPayloadbuilderCatalogStore().initialize(context.files);
    registerQueryExecutableEngine(context, {
      engineId: "payloadbuilder",
      mimeTypes: ["application/plbsql"]
    });

    context.files.capabilities.registerLabel?.("application/plbsql", "Payloadbuilder");
    context.files.capabilities.registerPreferredNewFileMimeType?.("application/plbsql", 20);

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

    context.settings.registerAdvancedValidator({
      id: "core.queryengine.payloadbuilder.environments.validator",
      validate: ({ value }) => {
        if (!Array.isArray(value)) {
          return { ok: false, message: "Expected an array of environments" };
        }
        const parsed = parsePayloadbuilderEnvironments(value);
        if (parsed.length !== value.length) {
          return { ok: false, message: "Environment entries must have unique id/title and valid variables" };
        }
        return { ok: true };
      }
    });

    context.settings.registerAdvancedRenderer({
      id: "core.queryengine.payloadbuilder.environments.renderer",
      render: ({ value, setValue, readonly }) => (
        <PayloadbuilderEnvironmentsSettingsEditor value={value} setValue={setValue} readonly={readonly} />
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

    context.settings.registerSettings({
      moduleId: "core.queryengine.payloadbuilder.environments",
      title: "Query Engine Payloadbuilder Environments",
      order: 31,
      settings: [
        {
          id: PAYLOADBUILDER_ENVIRONMENTS_SETTING_ID,
          moduleId: "core.queryengine.payloadbuilder.environments",
          title: "Environment Profiles",
          description: "Define payloadbuilder environments and their variables.",
          sectionPath: ["Query Engine", "Payloadbuilder", "Environment"],
          tags: ["payloadbuilder", "environment", "variables"],
          type: "json",
          defaultValue: [],
          advanced: {
            rendererId: "core.queryengine.payloadbuilder.environments.renderer",
            validatorId: "core.queryengine.payloadbuilder.environments.validator"
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
      when: "activeFile.mimeType == 'application/plbsql'",
      render: () => <PayloadbuilderCatalogSidebar editorRegistryHost={getEditorRegistryHost()} />
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
      const params = event.params as { engineState?: unknown };
      if (!params.engineState) {
        return;
      }
      const catalogStore = getPayloadbuilderCatalogStore();
      catalogStore.applyEngineStatePatch(executeContext.fileId, params.engineState);
      syncPayloadbuilderMetadata(executeContext.fileId, context.files, catalogStore);
    });

    const catalogStore = getPayloadbuilderCatalogStore();
    catalogStore.subscribe(() => {
      for (const file of context.files.listFiles()) {
        if (file.mimeType === "application/plbsql") {
          syncPayloadbuilderMetadata(file.fileId, context.files, catalogStore);
        }
      }
    });

    // Write metadata for any PLB file the first time it appears in the registry
    // (covers workspace restore before catalog store receives a runtime update).
    const syncedPlbFileIds = new Set<string>();
    context.files.subscribe((files) => {
      for (const file of files) {
        if (file.mimeType !== "application/plbsql" || syncedPlbFileIds.has(file.fileId)) {
          continue;
        }
        syncedPlbFileIds.add(file.fileId);
        syncPayloadbuilderMetadata(file.fileId, context.files, catalogStore);
      }
    });
  }
};

const PLB_CTX_ENABLED_CATALOGS = "core.queryengine.payloadbuilder.enabledCatalogs";
const PLB_CTX_SELECTED_ENV = "core.queryengine.payloadbuilder.selectedEnvironment";
const PLB_CTX_DEFAULT_CATALOG = "core.queryengine.payloadbuilder.defaultCatalogAlias";

function syncPayloadbuilderMetadata(
  fileId: string,
  files: FilesRegistry,
  catalogStore: PayloadbuilderCatalogStore
): void {
  const file = files.getFile(fileId);
  if (!file) return;

  const meta = catalogStore.getCatalogMeta(fileId);
  const metadata = { ...(file.metadata ?? {}) };

  if (meta.enabledAliases.length > 0) {
    metadata[PLB_CTX_ENABLED_CATALOGS] = meta.enabledAliases.join(",");
  } else {
    delete metadata[PLB_CTX_ENABLED_CATALOGS];
  }

  if (meta.selectedEnvironmentId) {
    const envTitle = getPayloadbuilderEnvironments().find((e) => e.id === meta.selectedEnvironmentId)?.title;
    if (envTitle) {
      metadata[PLB_CTX_SELECTED_ENV] = envTitle;
    } else {
      delete metadata[PLB_CTX_SELECTED_ENV];
    }
  } else {
    delete metadata[PLB_CTX_SELECTED_ENV];
  }

  if (meta.defaultCatalogAlias) {
    metadata[PLB_CTX_DEFAULT_CATALOG] = meta.defaultCatalogAlias;
  } else {
    delete metadata[PLB_CTX_DEFAULT_CATALOG];
  }

  files.updateFile(fileId, { metadata });
}

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
  const contributions = listPayloadbuilderCatalogContributions();
  const byCatalogIdInsensitive = new Map(
    contributions.map((contribution) => [contribution.catalogId.toLowerCase(), contribution])
  );

  const current = parseCatalogAliasDefinitions(
    settingsService.getValue(PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID)
  );
  const merged = current.map((entry) => {
    const contribution = byCatalogIdInsensitive.get(entry.catalogId.toLowerCase());
    if (!contribution) {
      return entry;
    }
    return {
      ...entry,
      catalogId: contribution.catalogId
    };
  });

  const byCatalogId = new Map<string, number>();
  for (const entry of merged) {
    byCatalogId.set(entry.catalogId, (byCatalogId.get(entry.catalogId) ?? 0) + 1);
  }

  const takenAliases = new Set(merged.map((item) => item.alias));
  for (const contribution of contributions) {
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

  const changed =
    merged.length !== current.length ||
    merged.some((entry, index) => {
      const prev = current[index];
      return !prev || prev.alias !== entry.alias || prev.catalogId !== entry.catalogId || prev.title !== entry.title || prev.enabled !== entry.enabled;
    });
  if (!changed) {
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
