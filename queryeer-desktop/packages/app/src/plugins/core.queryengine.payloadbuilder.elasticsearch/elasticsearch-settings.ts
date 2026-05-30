import { getCoreSettingsService } from "../core.settings/service";
import type { SecretRefValue } from "@queryeer/api/security/Security";
import { parseSecretRefValue } from "../core.settings/secret-ref";

export const PAYLOADBUILDER_ELASTICSEARCH_CONNECTIONS_SETTING_ID =
  "core.queryengine.payloadbuilder.elasticsearch.connections";

export type ElasticsearchConnectionDefinition = {
  connectionId: string;
  title?: string;
  endpoint: string;
  authType: "NONE" | "BASIC";
  authUsername?: string;
  authPassword?: string | SecretRefValue;
  enabled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAuthType(value: unknown): "NONE" | "BASIC" {
  return normalizeText(value).toUpperCase() === "BASIC" ? "BASIC" : "NONE";
}

export function parseElasticsearchConnectionDefinitions(raw: unknown): ElasticsearchConnectionDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const definitions: ElasticsearchConnectionDefinition[] = [];
  const seenConnectionIds = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const connectionId = normalizeText(entry.connectionId);
    const endpoint = normalizeText(entry.endpoint);
    if (!connectionId || !endpoint || seenConnectionIds.has(connectionId)) {
      continue;
    }
    seenConnectionIds.add(connectionId);

    const authType = normalizeAuthType(entry.authType);
    definitions.push({
      connectionId,
      title: normalizeText(entry.title) || undefined,
      endpoint,
      authType,
      authUsername: normalizeText(entry.authUsername) || undefined,
      authPassword:
        parseSecretRefValue(entry.authPassword) || normalizeText(entry.authPassword) || undefined,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true
    });
  }

  return definitions;
}

export function getConfiguredElasticsearchConnections(): ElasticsearchConnectionDefinition[] {
  const service = getCoreSettingsService();
  if (!service) {
    return [];
  }

  return parseElasticsearchConnectionDefinitions(
    service.getValue(PAYLOADBUILDER_ELASTICSEARCH_CONNECTIONS_SETTING_ID)
  );
}
