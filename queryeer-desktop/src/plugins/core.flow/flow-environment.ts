import { getCoreSettingsService } from "../core.settings/service";
import type { FlowEnvironmentConfig, FlowLocalMapping } from "../../contracts/flow/FlowEnvironmentSettings.js";
import { FLOW_ENVIRONMENTS_SETTING_ID } from "../../contracts/flow/FlowEnvironmentSettings.js";

export type { FlowEnvironmentConfig, FlowLocalMapping };
export { FLOW_ENVIRONMENTS_SETTING_ID };

export const DEFAULT_FLOW_ENVIRONMENT_CONFIG: FlowEnvironmentConfig = {
  activeEnvironment: "dev",
  environments: ["dev"],
  mappings: []
};

export function getFlowEnvironmentConfig(): FlowEnvironmentConfig {
  return parseFlowEnvironmentConfig(
    getCoreSettingsService()?.getValue(FLOW_ENVIRONMENTS_SETTING_ID)
  );
}

export function listFlowEnvironmentNames(config: FlowEnvironmentConfig): string[] {
  return [
    ...new Set([
      config.activeEnvironment,
      ...config.environments
    ].filter((environment) => environment.trim().length > 0))
  ].sort((a, b) => a.localeCompare(b));
}

export function withActiveFlowEnvironment(
  config: FlowEnvironmentConfig,
  activeEnvironment: string
): FlowEnvironmentConfig {
  const nextEnvironment = nonEmptyString(activeEnvironment) ?? DEFAULT_FLOW_ENVIRONMENT_CONFIG.activeEnvironment;
  return {
    ...config,
    activeEnvironment: nextEnvironment,
    environments: [
      ...new Set([...config.environments, nextEnvironment])
    ].sort((a, b) => a.localeCompare(b))
  };
}

export function getFlowLocalMapping(
  config: FlowEnvironmentConfig,
  key: Omit<FlowLocalMapping, "value">
): FlowLocalMapping | undefined {
  return config.mappings.find((mapping) =>
    mapping.environment === key.environment
    && mapping.owner === key.owner
    && mapping.kind === key.kind
    && mapping.ref === key.ref
  );
}

export function withFlowLocalMapping(
  config: FlowEnvironmentConfig,
  mapping: FlowLocalMapping
): FlowEnvironmentConfig {
  const normalizedMapping = normalizeMapping(mapping);
  if (!normalizedMapping) {
    return config;
  }
  const mappings = config.mappings.filter((candidate) =>
    candidate.environment !== normalizedMapping.environment
    || candidate.owner !== normalizedMapping.owner
    || candidate.kind !== normalizedMapping.kind
    || candidate.ref !== normalizedMapping.ref
  );
  mappings.push(normalizedMapping);
  return {
    ...withActiveFlowEnvironment(config, config.activeEnvironment),
    mappings: mappings.sort(compareMappings)
  };
}

export function withoutFlowLocalMapping(
  config: FlowEnvironmentConfig,
  key: Omit<FlowLocalMapping, "value">
): FlowEnvironmentConfig {
  return {
    ...config,
    mappings: config.mappings.filter((mapping) =>
      mapping.environment !== key.environment
      || mapping.owner !== key.owner
      || mapping.kind !== key.kind
      || mapping.ref !== key.ref
    )
  };
}

export function parseFlowEnvironmentConfig(raw: unknown): FlowEnvironmentConfig {
  if (!isRecord(raw)) {
    return DEFAULT_FLOW_ENVIRONMENT_CONFIG;
  }

  return {
    activeEnvironment: nonEmptyString(raw.activeEnvironment) ?? DEFAULT_FLOW_ENVIRONMENT_CONFIG.activeEnvironment,
    environments: parseEnvironmentNames(raw.environments),
    mappings: parseMappings(raw.mappings)
  };
}

function parseMappings(raw: unknown): FlowLocalMapping[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const mappings = raw
    .map((item) => isRecord(item) ? normalizeMapping(item) : undefined)
    .filter((item): item is FlowLocalMapping => Boolean(item));
  const deduped = new Map<string, FlowLocalMapping>();
  for (const mapping of mappings) {
    deduped.set(mappingKey(mapping), mapping);
  }
  return [...deduped.values()].sort(compareMappings);
}

function normalizeMapping(raw: Record<string, unknown>): FlowLocalMapping | undefined {
  const environment = nonEmptyString(raw.environment);
  const owner = nonEmptyString(raw.owner);
  const kind = nonEmptyString(raw.kind);
  const ref = nonEmptyString(raw.ref);
  const value = nonEmptyString(raw.value);
  if (!environment || !owner || !kind || !ref || !value) {
    return undefined;
  }
  return {
    environment,
    owner,
    kind,
    ref,
    value
  };
}

function compareMappings(left: FlowLocalMapping, right: FlowLocalMapping): number {
  return mappingKey(left).localeCompare(mappingKey(right));
}

function mappingKey(mapping: Omit<FlowLocalMapping, "value">): string {
  return [mapping.environment, mapping.owner, mapping.kind, mapping.ref].join("\u0000");
}

function parseEnvironmentNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_FLOW_ENVIRONMENT_CONFIG.environments;
  }
  const environments = raw
    .map((item) => nonEmptyString(item))
    .filter((item): item is string => Boolean(item));
  return environments.length > 0
    ? [...new Set(environments)].sort((a, b) => a.localeCompare(b))
    : DEFAULT_FLOW_ENVIRONMENT_CONFIG.environments;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
