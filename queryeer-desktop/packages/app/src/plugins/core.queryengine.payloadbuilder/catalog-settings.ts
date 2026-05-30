import { getCoreSettingsService } from "../core.settings/service";

export const PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID =
  "core.queryengine.payloadbuilder.catalogInstances";

export type PayloadbuilderCatalogAliasDefinition = {
  alias: string;
  catalogId: string;
  title?: string;
  enabled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseCatalogAliasDefinitions(
  raw: unknown
): PayloadbuilderCatalogAliasDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const definitions: PayloadbuilderCatalogAliasDefinition[] = [];
  const seenAliases = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const alias = normalizeText(entry.alias);
    const catalogId = normalizeText(entry.catalogId);
    if (!alias || !catalogId || seenAliases.has(alias)) {
      continue;
    }
    seenAliases.add(alias);
    definitions.push({
      alias,
      catalogId,
      title: normalizeText(entry.title) || undefined,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true
    });
  }

  return definitions;
}

export function getConfiguredCatalogAliases(): PayloadbuilderCatalogAliasDefinition[] {
  const service = getCoreSettingsService();
  if (!service) {
    return [];
  }

  return parseCatalogAliasDefinitions(
    service.getValue(PAYLOADBUILDER_CATALOG_INSTANCES_SETTING_ID)
  );
}
