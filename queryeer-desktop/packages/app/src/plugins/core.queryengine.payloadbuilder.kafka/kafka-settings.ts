import { getCoreSettingsService } from "../core.settings/service";
import type { SecretRefValue } from "@queryeer/api/security/Security";
import { parseSecretRefValue } from "../core.settings/secret-ref";

export const PAYLOADBUILDER_KAFKA_CONNECTIONS_SETTING_ID =
  "core.queryengine.payloadbuilder.kafka.connections";

export type KafkaSecurityProtocol = "PLAINTEXT" | "SSL" | "SASL_PLAINTEXT" | "SASL_SSL";

export type KafkaSaslMechanism = "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512" | "OAUTHBEARER" | "GSSAPI";

export type KafkaConnectionDefinition = {
  connectionId: string;
  title?: string;
  bootstrapServers: string;
  schemaRegistryUrl?: string;
  securityProtocol: KafkaSecurityProtocol;
  saslMechanism?: KafkaSaslMechanism;
  saslJaasConfig?: string | SecretRefValue;
  enabled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const SECURITY_PROTOCOLS: ReadonlySet<KafkaSecurityProtocol> = new Set([
  "PLAINTEXT",
  "SSL",
  "SASL_PLAINTEXT",
  "SASL_SSL"
]);

const SASL_MECHANISMS: ReadonlySet<KafkaSaslMechanism> = new Set([
  "PLAIN",
  "SCRAM-SHA-256",
  "SCRAM-SHA-512",
  "OAUTHBEARER",
  "GSSAPI"
]);

function normalizeSecurityProtocol(value: unknown): KafkaSecurityProtocol {
  const normalized = normalizeText(value).toUpperCase();
  return SECURITY_PROTOCOLS.has(normalized as KafkaSecurityProtocol)
    ? (normalized as KafkaSecurityProtocol)
    : "PLAINTEXT";
}

function normalizeSaslMechanism(value: unknown): KafkaSaslMechanism | undefined {
  const normalized = normalizeText(value).toUpperCase();
  return SASL_MECHANISMS.has(normalized as KafkaSaslMechanism)
    ? (normalized as KafkaSaslMechanism)
    : undefined;
}

export function parseKafkaConnectionDefinitions(raw: unknown): KafkaConnectionDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const definitions: KafkaConnectionDefinition[] = [];
  const seenConnectionIds = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const connectionId = normalizeText(entry.connectionId);
    const bootstrapServers = normalizeText(entry.bootstrapServers);
    if (!connectionId || !bootstrapServers || seenConnectionIds.has(connectionId)) {
      continue;
    }
    seenConnectionIds.add(connectionId);

    definitions.push({
      connectionId,
      title: normalizeText(entry.title) || undefined,
      bootstrapServers,
      schemaRegistryUrl: normalizeText(entry.schemaRegistryUrl) || undefined,
      securityProtocol: normalizeSecurityProtocol(entry.securityProtocol),
      saslMechanism: normalizeSaslMechanism(entry.saslMechanism),
      saslJaasConfig:
        parseSecretRefValue(entry.saslJaasConfig) || normalizeText(entry.saslJaasConfig) || undefined,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true
    });
  }

  return definitions;
}

export function getConfiguredKafkaConnections(): KafkaConnectionDefinition[] {
  const service = getCoreSettingsService();
  if (!service) {
    return [];
  }

  return parseKafkaConnectionDefinitions(service.getValue(PAYLOADBUILDER_KAFKA_CONNECTIONS_SETTING_ID));
}
