import { getCoreSettingsService } from "../core.settings/service";
import { parseSecretRefValue } from "../core.settings/secret-ref";

export const PAYLOADBUILDER_ENVIRONMENTS_SETTING_ID =
  "core.queryengine.payloadbuilder.environments.values";

export type PayloadbuilderEnvironmentVariable = {
  key: string;
  value?: string;
  secretRef?: { secretRef: string };
};

export type PayloadbuilderEnvironment = {
  id: string;
  title: string;
  variables: PayloadbuilderEnvironmentVariable[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parsePayloadbuilderEnvironments(raw: unknown): PayloadbuilderEnvironment[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const environments: PayloadbuilderEnvironment[] = [];
  for (const env of raw) {
    if (!isRecord(env)) {
      continue;
    }
    const id = normalizedText(env.id);
    const title = normalizedText(env.title);
    if (!id || !title || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const variablesRaw = Array.isArray(env.variables) ? env.variables : [];
    const variableSeen = new Set<string>();
    const variables: PayloadbuilderEnvironmentVariable[] = [];
    for (const variable of variablesRaw) {
      if (!isRecord(variable)) {
        continue;
      }
      const key = normalizedText(variable.key);
      const value = normalizedText(variable.value) || undefined;
      const secretRef = parseSecretRefValue(variable.secretRef);
      if (!key || variableSeen.has(key) || (!value && !secretRef) || (value && secretRef)) {
        continue;
      }
      variableSeen.add(key);
      variables.push({ key, value, secretRef });
    }

    environments.push({ id, title, variables });
  }
  return environments;
}

export function getPayloadbuilderEnvironments(): PayloadbuilderEnvironment[] {
  const service = getCoreSettingsService();
  if (!service) {
    return [];
  }
  return parsePayloadbuilderEnvironments(service.getValue(PAYLOADBUILDER_ENVIRONMENTS_SETTING_ID));
}
