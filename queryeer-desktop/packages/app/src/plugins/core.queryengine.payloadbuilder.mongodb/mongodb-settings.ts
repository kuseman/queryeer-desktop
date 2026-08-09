import type { SecretRefValue } from "@queryeer/api/security/Security";
import { parseSecretRefValue } from "../core.settings/secret-ref";
import { getCoreSettingsService } from "../core.settings/service";

export const PAYLOADBUILDER_MONGODB_CONNECTIONS_SETTING_ID =
  "core.queryengine.payloadbuilder.mongodb.connections";

export type MongoConnectionDefinition = {
  connectionId: string;
  title?: string;
  connectionString: string;
  authUsername?: string;
  authPassword?: string | SecretRefValue;
  authDatabase?: string;
  enabled: boolean;
};

export function parseMongoConnectionDefinitions(raw: unknown): MongoConnectionDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const definitions: MongoConnectionDefinition[] = [];
  const seenConnectionIds = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const connectionId = normalizeText(entry.connectionId);
    const connectionString = normalizeText(entry.connectionString);
    if (
      !connectionId ||
      !isMongoConnectionString(connectionString) ||
      seenConnectionIds.has(connectionId)
    ) {
      continue;
    }
    seenConnectionIds.add(connectionId);

    definitions.push({
      connectionId,
      title: normalizeText(entry.title) || undefined,
      connectionString,
      authUsername: normalizeText(entry.authUsername) || undefined,
      authPassword: parseSecretRefValue(entry.authPassword) || normalizeText(entry.authPassword) || undefined,
      authDatabase: normalizeText(entry.authDatabase) || undefined,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true
    });
  }
  return definitions;
}

export function getConfiguredMongoConnections(): MongoConnectionDefinition[] {
  const service = getCoreSettingsService();
  return service
    ? parseMongoConnectionDefinitions(service.getValue(PAYLOADBUILDER_MONGODB_CONNECTIONS_SETTING_ID))
    : [];
}

export function isMongoConnectionString(value: string): boolean {
  return value.startsWith("mongodb://") || value.startsWith("mongodb+srv://");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
