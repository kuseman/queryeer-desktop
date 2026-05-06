import type { SecretRefValue } from "../../contracts/security/Security";
import { getCoreSettingsService } from "../core.settings/service";

export const JDBC_CONNECTIONS_SETTING_ID = "core.queryengine.jdbc.connections";

export type JdbcConnectionDefinition = {
  connectionId: string;
  title?: string;
  dialectId: string;
  /** JDBC URL — used by generic JDBC dialect. Empty/absent for structured-field dialects. */
  url?: string;
  username?: string;
  password?: string | SecretRefValue;
  /** Dialect-specific structured fields (host, port, database, authType, etc.) */
  properties?: Record<string, unknown>;
  enabled: boolean;
  color?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseSecretRef(value: unknown): SecretRefValue | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const secretRef = value.secretRef;
  return typeof secretRef === "string" && secretRef.trim()
    ? { secretRef: secretRef.trim() }
    : undefined;
}

export function parseJdbcConnectionDefinitions(raw: unknown): JdbcConnectionDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: JdbcConnectionDefinition[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }

    const connectionId = text(item.connectionId);
    if (!connectionId || seen.has(connectionId)) {
      continue;
    }

    const url = text(item.url);
    const hasStructuredProperties = isRecord(item.properties);

    // Accept connections that have a URL (generic JDBC) or structured properties (e.g. SQL Server).
    if (!url && !hasStructuredProperties) {
      continue;
    }

    seen.add(connectionId);

    const rawColor = text(item.color);
    result.push({
      connectionId,
      title: text(item.title) || undefined,
      dialectId: text(item.dialectId) || "jdbc",
      url: url || undefined,
      username: text(item.username) || undefined,
      password: parseSecretRef(item.password) ?? (text(item.password) || undefined),
      properties: hasStructuredProperties ? (item.properties as Record<string, unknown>) : undefined,
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
      color: rawColor || undefined
    });
  }

  return result;
}

export function getConfiguredJdbcConnections(): JdbcConnectionDefinition[] {
  const settings = getCoreSettingsService();
  if (!settings) {
    return [];
  }
  return parseJdbcConnectionDefinitions(settings.getValue(JDBC_CONNECTIONS_SETTING_ID));
}
