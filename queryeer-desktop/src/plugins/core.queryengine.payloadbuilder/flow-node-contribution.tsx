import { useEffect, useState } from "react";
import { getCoreSettingsService } from "../core.settings/service";
import {
  registerFlowNodeTypeContribution,
  type FlowNodeSummaryItem
} from "../core.flow/flow-node-type-contributions";
import type { FlowNode } from "../core.flow/types";
import { FLOW_CONFIGURE_NODE_COMMAND_ID } from "../core.flow/qflow-codelens";
import {
  FLOW_ENVIRONMENTS_SETTING_ID,
  getFlowEnvironmentConfig,
  getFlowLocalMapping,
  type FlowEnvironmentConfig,
  type FlowLocalMapping,
  withFlowLocalMapping,
  withoutFlowLocalMapping
} from "../core.flow/flow-environment";
import { executeQueryForFlow } from "../core.queryengine/flow-query-execution";
import { getPayloadbuilderEnvironments } from "./environment-settings";
import {
  listPayloadbuilderCatalogContributions,
  type PayloadbuilderCatalogContribution,
  type PayloadbuilderCatalogFlowMappingField
} from "./catalog-contributions";

const PAYLOADBUILDER_FLOW_MAPPING_OWNER = "core.queryengine.payloadbuilder";

export function registerPayloadbuilderFlowNodeContribution(): void {
  registerFlowNodeTypeContribution({
    id: "payloadbuilder.query",
    title: "Payloadbuilder Query",
    description: "Execute a Payloadbuilder SQL query.",
    createTemplate: () => ({
      metadata: {
        type: "payloadbuilder.query",
        payloadbuilder: {
          environment: "",
          defaultCatalogAlias: "search",
          catalogs: {
            search: {
              provider: "elasticsearch"
            }
          }
        }
      },
      action: "select *\nfrom search._doc"
    }),
    getSummary: ({ node }) => summarizePayloadbuilderFlowNode(node.metadata.additional?.payloadbuilder),
    getCodeLens: ({ node }) => getPayloadbuilderFlowMappingCodeLens(node),
    validateConfiguration: ({ node }) => validatePayloadbuilderFlowConfiguration(node.metadata.additional?.payloadbuilder),
    renderConfiguration: ({ node, updateMetadata }) => (
      <PayloadbuilderFlowNodeConfiguration
        nodePayloadbuilder={node.metadata.additional?.payloadbuilder}
        updateMetadata={updateMetadata}
      />
    ),
    execute: async (request) => {
      if (!request.fileId) {
        return {
          ok: false,
          code: "FLOW_FILE_MISSING",
          message: `Flow node '${request.node.metadata.id}' cannot execute without a file id.`
        };
      }
      const engineStateResult = resolvePayloadbuilderFlowEngineState(
        request.node.metadata.additional?.payloadbuilder
      );
      if (!engineStateResult.ok) {
        return {
          ok: false,
          code: engineStateResult.code ?? "FLOW_NODE_CONFIGURATION_MISSING",
          message: engineStateResult.message,
          ...(engineStateResult.details ? { details: engineStateResult.details } : {})
        };
      }
      try {
        const output = await executeQueryForFlow({
          engineId: "payloadbuilder",
          fileId: request.fileId,
          text: request.action,
          engineState: engineStateResult.engineState
        });
        return { ok: true, output };
      } catch (error) {
        return {
          ok: false,
          code: "QUERY_ENGINE_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  });
}

type PayloadbuilderFlowCatalogEntry = {
  alias: string;
  catalog: Record<string, unknown>;
};

function listPayloadbuilderFlowCatalogEntries(
  state: Record<string, unknown> | undefined
): PayloadbuilderFlowCatalogEntry[] {
  const catalogs = toRecord(state?.catalogs);
  if (!catalogs) {
    return [];
  }

  return Object.entries(catalogs)
    .map(([alias, value]) => {
      const normalizedAlias = alias.trim();
      const catalog = toRecord(value);
      return normalizedAlias && catalog ? { alias: normalizedAlias, catalog } : undefined;
    })
    .filter((entry): entry is PayloadbuilderFlowCatalogEntry => Boolean(entry));
}

function getEditablePayloadbuilderFlowCatalog(
  state: Record<string, unknown> | undefined
): PayloadbuilderFlowCatalogEntry {
  const entries = listPayloadbuilderFlowCatalogEntries(state);
  if (typeof state?.defaultCatalogAlias === "string") {
    const defaultAlias = state.defaultCatalogAlias.trim();
    if (!defaultAlias) {
      return { alias: "", catalog: entries[0]?.catalog ?? {} };
    }
    return entries.find((entry) => entry.alias === defaultAlias) ?? { alias: defaultAlias, catalog: {} };
  }
  return entries[0] ?? { alias: "", catalog: {} };
}

function getPayloadbuilderFlowCatalogsObject(
  state: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    listPayloadbuilderFlowCatalogEntries(state).map((entry) => [entry.alias, entry.catalog])
  );
}

function withoutLegacyPayloadbuilderCatalog(state: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...state };
  delete rest.catalog;
  return rest;
}

function validatePayloadbuilderFlowConfiguration(raw: unknown): Array<{ field: string; message: string }> {
  const issues: Array<{ field: string; message: string }> = [];
  const state = toRecord(raw);
  const entries = listPayloadbuilderFlowCatalogEntries(state);
  const defaultAlias = toOptionalString(state?.defaultCatalogAlias);

  if (!defaultAlias) {
    issues.push({ field: "payloadbuilder.defaultCatalogAlias", message: "defaultCatalogAlias is required." });
  }
  if (entries.length === 0) {
    issues.push({ field: "payloadbuilder.catalogs", message: "At least one catalog is required." });
    return issues;
  }
  if (defaultAlias && !entries.some((entry) => entry.alias === defaultAlias)) {
    issues.push({ field: "payloadbuilder.defaultCatalogAlias", message: "Alias must match a configured catalog." });
  }

  for (const entry of entries) {
    const provider = toOptionalString(entry.catalog.provider) ?? toOptionalString(entry.catalog.catalogId);
    if (!provider) {
      issues.push({ field: `payloadbuilder.catalogs.${entry.alias}.provider`, message: "Provider is required." });
      continue;
    }

    const selectedProvider = listPayloadbuilderCatalogContributions().find(
      (candidate) => candidate.catalogId === provider
    );
    for (const field of selectedProvider?.flowMappingFields ?? []) {
      if (!field.required) {
        continue;
      }
      const value = toOptionalString(entry.catalog[field.id]);
      if (!value) {
        issues.push({
          field: `payloadbuilder.catalogs.${entry.alias}.${field.id}`,
          message: `${field.label} is required.`
        });
      }
    }

    for (const mapping of analyzePayloadbuilderFlowMappings(entry.catalog, provider)) {
      if (mapping.state === "missing" || mapping.state === "invalid") {
        issues.push({
          field: `payloadbuilder.catalogs.${entry.alias}.${mapping.fieldId}`,
          message: mapping.message
        });
      }
    }
  }

  return issues;
}

function resolvePayloadbuilderFlowEngineState(raw: unknown):
  | { ok: true; engineState: Record<string, unknown> }
  | { ok: false; message: string; code?: string; details?: Record<string, unknown> } {
  const state = toRecord(raw);
  if (!state) {
    return {
      ok: false,
      message: "Payloadbuilder flow node is missing payloadbuilder configuration."
    };
  }

  const entries = listPayloadbuilderFlowCatalogEntries(state);
  const defaultAlias = toOptionalString(state.defaultCatalogAlias);
  if (!defaultAlias || entries.length === 0) {
    return {
      ok: false,
      message: "Payloadbuilder flow node is missing payloadbuilder.defaultCatalogAlias or payloadbuilder.catalogs."
    };
  }
  if (!entries.some((entry) => entry.alias === defaultAlias)) {
    return {
      ok: false,
      message: `Payloadbuilder default catalog alias '${defaultAlias}' is not configured in payloadbuilder.catalogs.`
    };
  }

  const environmentRef = toOptionalString(state.environment);
  const environment = environmentRef
    ? getPayloadbuilderEnvironments().find((candidate) =>
        candidate.id === environmentRef || candidate.title.trim() === environmentRef
      )
    : undefined;
  if (environmentRef && !environment) {
    return {
      ok: false,
      message: `Payloadbuilder environment '${environmentRef}' is not configured.`
    };
  }

  const catalogs: Record<string, { catalogId: string; properties: Record<string, unknown> }> = {};
  for (const entry of entries) {
    const catalogId = toOptionalString(entry.catalog.provider) ?? toOptionalString(entry.catalog.catalogId);
    if (!catalogId) {
      return {
        ok: false,
        message: `Payloadbuilder catalog '${entry.alias}' is missing provider.`
      };
    }

    const selectedProvider = listPayloadbuilderCatalogContributions().find(
      (candidate) => candidate.catalogId === catalogId
    );
    const resolvedCatalog = resolvePayloadbuilderFlowCatalogValues(entry.catalog, selectedProvider);
    if (!resolvedCatalog.ok) {
      return {
        ok: false,
        code: resolvedCatalog.code,
        message: resolvedCatalog.message,
        details: {
          ...resolvedCatalog.details,
          alias: entry.alias
        }
      };
    }
    const runtimeCatalog = resolvedCatalog.catalog;
    catalogs[entry.alias] = {
      catalogId,
      properties: Object.fromEntries(
        Object.entries(runtimeCatalog).filter(([key, value]) =>
          key !== "provider"
          && key !== "catalogId"
          && value !== undefined
          && value !== null
          && value !== ""
        )
      )
    };
  }

  return {
    ok: true,
    engineState: {
      payloadbuilder: {
        ...(environment ? { selectedEnvironmentId: environment.id } : {}),
        defaultCatalogAlias: defaultAlias,
        catalogs
      }
    }
  };
}

function summarizePayloadbuilderFlowNode(raw: unknown): FlowNodeSummaryItem[] {
  const state = toRecord(raw);
  const environmentRef = toOptionalString(state?.environment);
  const entry = getEditablePayloadbuilderFlowCatalog(state);
  const catalogId = toOptionalString(entry.catalog.provider) ?? toOptionalString(entry.catalog.catalogId);
  const environment = environmentRef
    ? getPayloadbuilderEnvironments().find((candidate) =>
        candidate.id === environmentRef || candidate.title.trim() === environmentRef
      )
    : undefined;
  const catalogContribution = catalogId
    ? listPayloadbuilderCatalogContributions().find((candidate) => candidate.catalogId === catalogId)
    : undefined;

  return [
    ...(environmentRef ? [{ label: "Environment", value: environment?.title ?? environmentRef }] : []),
    ...(entry.alias ? [{ label: "Catalog", value: entry.alias }] : []),
    ...(catalogId ? [{ label: "Provider", value: catalogContribution?.title ?? catalogId }] : [])
  ];
}

function PayloadbuilderFlowNodeConfiguration(props: {
  nodePayloadbuilder: unknown;
  updateMetadata: (patch: Record<string, unknown>) => void;
}): JSX.Element {
  const state = toRecord(props.nodePayloadbuilder) ?? {};
  const stateBase = withoutLegacyPayloadbuilderCatalog(state);
  const catalogEntries = listPayloadbuilderFlowCatalogEntries(state);
  const editableCatalog = getEditablePayloadbuilderFlowCatalog(state);
  const catalog = editableCatalog.catalog;
  const environmentRef = toOptionalString(state.environment) ?? "";
  const alias = editableCatalog.alias;
  const provider = toOptionalString(catalog.provider) ?? toOptionalString(catalog.catalogId) ?? "";
  const environments = getPayloadbuilderEnvironments();
  const providers = listPayloadbuilderCatalogContributions();
  const selectedProvider = providers.find((candidate) => candidate.catalogId === provider);
  const flowMappingFields = selectedProvider?.flowMappingFields ?? [];
  const localBindingFields = flowMappingFields.filter((field) => field.persistAsLabel && field.mappingKind);
  const portableFields = flowMappingFields.filter((field) => !(field.persistAsLabel && field.mappingKind));
  const [fieldOptions, setFieldOptions] = useState<Record<string, Array<string | { value: string; label: string }>>>({});
  const flowEnvironmentConfig = useFlowEnvironmentConfigSnapshot();

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const nextOptions: Record<string, Array<string | { value: string; label: string }>> = {};
      const values = Object.fromEntries(
        Object.entries(catalog).map(([key, value]) => [key, typeof value === "string" ? value : ""])
      );
      for (const field of selectedProvider?.flowMappingFields ?? []) {
        if (!field.listOptions) {
          continue;
        }
        nextOptions[field.id] = await field.listOptions(values);
      }
      if (!cancelled) {
        setFieldOptions(nextOptions);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [provider, JSON.stringify(catalog)]);

  const writePayloadbuilderState = (nextState: Record<string, unknown>): void => {
    props.updateMetadata({
      payloadbuilder: nextState
    });
  };

  const writePayloadbuilder = (patch: Record<string, unknown>): void => {
    writePayloadbuilderState({
      ...stateBase,
      ...patch
    });
  };

  const writeCatalogAlias = (nextAliasRaw: string): void => {
    const nextAlias = nextAliasRaw.trim();
    const nextCatalogs = getPayloadbuilderFlowCatalogsObject(state);
    const previousAlias = alias || (catalogEntries.length === 1 ? catalogEntries[0]?.alias ?? "" : "");
    if (nextAlias) {
      if (previousAlias && previousAlias !== nextAlias) {
        delete nextCatalogs[previousAlias];
      }
      nextCatalogs[nextAlias] = catalog;
    }
    writePayloadbuilderState({
      ...stateBase,
      defaultCatalogAlias: nextAlias,
      catalogs: nextCatalogs
    });
  };

  const writeCatalog = (patch: Record<string, unknown>): void => {
    const nextCatalog = {
      ...catalog,
      ...patch
    };
    const patchProvider = toOptionalString(patch.provider) ?? toOptionalString(patch.catalogId);
    const nextAlias = alias
      || (patchProvider ? providers.find((entry) => entry.catalogId === patchProvider)?.defaultAlias : undefined)
      || (catalogEntries.length === 1 ? catalogEntries[0]?.alias : undefined)
      || "catalog";
    const previousAlias = alias || (catalogEntries.length === 1 ? catalogEntries[0]?.alias ?? "" : "");
    const nextCatalogs = getPayloadbuilderFlowCatalogsObject(state);
    if (previousAlias && previousAlias !== nextAlias) {
      delete nextCatalogs[previousAlias];
    }
    nextCatalogs[nextAlias] = nextCatalog;
    writePayloadbuilderState({
      ...stateBase,
      defaultCatalogAlias: nextAlias,
      catalogs: nextCatalogs
    });
  };

  return (
    <div className="flow-node-sidecar-contribution-fields">
      <label className="flow-node-sidecar-field">
        <span className="flow-node-sidecar-label">Environment</span>
        <select
          className="flow-node-sidecar-input"
          value={environmentRef}
          onChange={(event) => writePayloadbuilder({ environment: event.target.value })}
        >
          <option value="">None</option>
          {environments.map((environment) => (
            <option key={environment.id} value={environment.title || environment.id}>
              {environment.title}
            </option>
          ))}
        </select>
      </label>
      <label className="flow-node-sidecar-field">
        <span className="flow-node-sidecar-label">Alias</span>
        <input
          className="flow-node-sidecar-input"
          value={alias}
          onChange={(event) => writeCatalogAlias(event.target.value)}
          placeholder="search"
        />
      </label>
      <label className="flow-node-sidecar-field">
        <span className="flow-node-sidecar-label">Provider</span>
        <select
          className="flow-node-sidecar-input"
          value={provider}
          onChange={(event) => writeCatalog({ provider: event.target.value })}
        >
          <option value="">Select provider...</option>
          {providers.map((entry) => (
            <option key={entry.catalogId} value={entry.catalogId}>{entry.title}</option>
          ))}
        </select>
      </label>
      <PayloadbuilderFlowLocalMappings
        catalog={catalog}
        provider={provider}
        selectedProvider={selectedProvider}
        flowEnvironmentConfig={flowEnvironmentConfig}
        fieldOptions={fieldOptions}
        localBindingFields={localBindingFields}
        writeCatalog={writeCatalog}
      />
      {portableFields.map((field) => {
        const value = toOptionalString(catalog[field.id]) ?? "";
        const options = fieldOptions[field.id] ?? [];
        return (
          <label className="flow-node-sidecar-field" key={field.id}>
            <span className="flow-node-sidecar-label">{field.label}</span>
            {field.kind === "select" ? (
              <select
                className="flow-node-sidecar-input"
                value={value}
                onChange={(event) => writeCatalog({ [field.id]: event.target.value })}
              >
                <option value="">{field.placeholder ?? "Select..."}</option>
                {options.map((option) => {
                  const optionValue = typeof option === "string" ? option : option.value;
                  const optionLabel = typeof option === "string" ? option : option.label;
                  return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
                })}
              </select>
            ) : (
              <input
                className="flow-node-sidecar-input"
                value={value}
                placeholder={field.placeholder}
                onChange={(event) => writeCatalog({ [field.id]: event.target.value })}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

function PayloadbuilderFlowLocalMappings(props: {
  catalog: Record<string, unknown>;
  provider: string;
  selectedProvider?: PayloadbuilderCatalogContribution;
  flowEnvironmentConfig: FlowEnvironmentConfig;
  fieldOptions: Record<string, Array<string | { value: string; label: string }>>;
  localBindingFields: PayloadbuilderCatalogFlowMappingField[];
  writeCatalog: (patch: Record<string, unknown>) => void;
}): JSX.Element | null {
  if (props.localBindingFields.length === 0) {
    return null;
  }

  const valuesByFieldId: Record<string, string> = Object.fromEntries(
    Object.entries(props.catalog).map(([key, value]) => [key, typeof value === "string" ? value : ""])
  );
  const mappings = analyzePayloadbuilderFlowMappings(
    props.catalog,
    props.selectedProvider ?? props.provider,
    props.flowEnvironmentConfig,
    props.fieldOptions
  );

  const saveMapping = async (mapping: PayloadbuilderFlowMappingAnalysis, value: string): Promise<void> => {
    const service = getCoreSettingsService();
    if (!service || !value) {
      return;
    }
    const nextConfig = withFlowLocalMapping(props.flowEnvironmentConfig, {
      environment: props.flowEnvironmentConfig.activeEnvironment,
      owner: PAYLOADBUILDER_FLOW_MAPPING_OWNER,
      kind: mapping.kind,
      ref: mapping.ref,
      value
    });
    await service.setValue(FLOW_ENVIRONMENTS_SETTING_ID, nextConfig);
  };

  const selectLocalValue = async (
    field: PayloadbuilderCatalogFlowMappingField,
    mapping: PayloadbuilderFlowMappingAnalysis | undefined,
    value: string,
    options: PayloadbuilderFlowMappingOption[]
  ): Promise<void> => {
    if (!value) {
      return;
    }

    const selectedOption = options.find((option) => option.value === value);
    if (mapping?.state === "direct" && mapping.resolvedValue === mapping.ref) {
      if (value !== mapping.resolvedValue) {
        props.writeCatalog({ [field.id]: selectedOption?.label ?? value });
      }
      return;
    }

    if (mapping?.ref) {
      await saveMapping(mapping, value);
      return;
    }

    props.writeCatalog({ [field.id]: selectedOption?.label ?? value });
  };

  const clearMapping = async (mapping: PayloadbuilderFlowMappingAnalysis): Promise<void> => {
    const service = getCoreSettingsService();
    if (!service) {
      return;
    }
    const nextConfig = withoutFlowLocalMapping(props.flowEnvironmentConfig, {
      environment: props.flowEnvironmentConfig.activeEnvironment,
      owner: PAYLOADBUILDER_FLOW_MAPPING_OWNER,
      kind: mapping.kind,
      ref: mapping.ref
    });
    await service.setValue(FLOW_ENVIRONMENTS_SETTING_ID, nextConfig);
  };

  return (
    <>
      {props.localBindingFields.map((field) => {
        const ref = toOptionalString(props.catalog[field.id]) ?? "";
        const mapping = mappings.find((candidate) => candidate.fieldId === field.id && candidate.ref === ref);
        const options = getPayloadbuilderFlowMappingOptions(field, valuesByFieldId, props.fieldOptions);
        const selectedValue = mapping?.state === "mapped" || mapping?.state === "invalid"
          ? mapping.mapping?.value ?? ""
          : mapping?.state === "direct"
            ? mapping.resolvedValue ?? ""
            : "";
        const status = !ref
          ? "Select"
          : mapping?.state === "mapped" || mapping?.state === "direct"
            ? "Ready"
            : "Needs Selection";
        const statusClass = !ref ? "pending" : mapping?.state ?? "missing";
        const explanation = !ref
          ? `Pick the local ${field.label.toLowerCase()} to use. Its name will be saved as the shared flow ref.`
          : mapping?.state === "mapped"
            ? `"${ref}" will use ${mapping.resolvedLabel ?? mapping.mapping?.value ?? "the selected local value"} on this machine.`
            : mapping?.state === "direct"
              ? `"${ref}" matches a local ${field.label.toLowerCase()} on this machine.`
              : mapping?.state === "invalid"
                ? `"${ref}" points to a local value that is not available. Pick another local ${field.label.toLowerCase()}.`
                : `The flow asks for "${ref}". Pick the local ${field.label.toLowerCase()} it should use on this machine.`;
        return (
          <div className="flow-node-sidecar-local-mapping" key={field.id}>
            <div className="flow-node-sidecar-local-mapping-label">
              <span className={`flow-node-sidecar-local-mapping-status ${statusClass}`.trim()}>
                {status}
              </span>
              <span>{field.label}</span>
            </div>
            <div className="flow-node-sidecar-local-mapping-description">
              {explanation}
            </div>
            <div className="flow-node-sidecar-local-mapping-controls">
              <span className="flow-node-sidecar-label">Use local</span>
              <select
                className="flow-node-sidecar-input"
                value={selectedValue}
                title={mapping?.message}
                onChange={(event) => {
                  void selectLocalValue(field, mapping, event.target.value, options);
                }}
              >
                <option value="">Select local value...</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {mapping?.mapping && (
                <button
                  type="button"
                  className="flow-node-sidecar-local-mapping-clear"
                  onClick={() => {
                    void clearMapping(mapping);
                  }}
                >
                  Clear mapping
                </button>
              )}
            </div>
            <details className="flow-node-sidecar-local-mapping-advanced">
              <summary>Advanced: shared ref</summary>
              <label className="flow-node-sidecar-local-mapping-ref">
                <span className="flow-node-sidecar-label">Shared ref</span>
                <input
                  className="flow-node-sidecar-input"
                  value={ref}
                  placeholder={field.placeholder ?? "portable name"}
                  onChange={(event) => props.writeCatalog({ [field.id]: event.target.value })}
                />
              </label>
            </details>
          </div>
        );
      })}
    </>
  );
}

function useFlowEnvironmentConfigSnapshot(): FlowEnvironmentConfig {
  const [config, setConfig] = useState(() => getFlowEnvironmentConfig());

  useEffect(() => {
    const service = getCoreSettingsService();
    if (!service) {
      return;
    }
    const syncConfig = (): void => {
      setConfig(getFlowEnvironmentConfig());
    };
    syncConfig();
    return service.subscribe(syncConfig);
  }, []);

  return config;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type PayloadbuilderFlowMappingOption = {
  value: string;
  label: string;
};

type PayloadbuilderFlowMappingAnalysis = {
  alias?: string;
  fieldId: string;
  label: string;
  kind: string;
  ref: string;
  options: PayloadbuilderFlowMappingOption[];
  state: "direct" | "mapped" | "missing" | "invalid";
  message: string;
  resolvedValue?: string;
  resolvedLabel?: string;
  mapping?: FlowLocalMapping;
};

function resolvePayloadbuilderFlowCatalogValues(
  catalog: Record<string, unknown>,
  selectedProvider?: PayloadbuilderCatalogContribution
):
  | { ok: true; catalog: Record<string, unknown> }
  | { ok: false; code: string; message: string; details: Record<string, unknown> } {
  const resolvedCatalog: Record<string, unknown> = {
    ...catalog
  };
  const mappings = analyzePayloadbuilderFlowMappings(catalog, selectedProvider);
  for (const mapping of mappings) {
    if (mapping.state === "missing" || mapping.state === "invalid") {
      return {
        ok: false,
        code: mapping.state === "missing" ? "FLOW_MAPPING_MISSING" : "FLOW_MAPPING_INVALID",
        message: mapping.message,
        details: {
          owner: PAYLOADBUILDER_FLOW_MAPPING_OWNER,
          kind: mapping.kind,
          ref: mapping.ref,
          field: mapping.fieldId
        }
      };
    }
    if (mapping.resolvedValue) {
      resolvedCatalog[mapping.fieldId] = mapping.resolvedValue;
    }
  }

  return {
    ok: true,
    catalog: resolvedCatalog
  };
}

function getPayloadbuilderFlowMappingCodeLens(node: FlowNode): Array<{ title: string; commandId?: string; arguments?: unknown[] }> {
  const state = toRecord(node.metadata.additional?.payloadbuilder);
  const mappings = analyzePayloadbuilderFlowStateMappings(state);
  const problem = mappings.find((mapping) => mapping.state === "missing" || mapping.state === "invalid");
  if (problem) {
    return [{
      title: `${problem.state === "missing" ? "🔴 Missing" : "🟠 Invalid"} mapping: ${problem.ref}`,
      commandId: FLOW_CONFIGURE_NODE_COMMAND_ID,
      arguments: [node.metadata.id]
    }];
  }

  const mappedMappings = mappings.filter((mapping) => mapping.state === "mapped");
  if (mappedMappings.length === 0) {
    return [];
  }
  const localNames = mappedMappings
    .map((mapping) => mapping.resolvedLabel ?? mapping.mapping?.value ?? mapping.ref)
    .filter((value) => value.trim().length > 0);
  return [{
    title: mappedMappings.length === 1
      ? `🔗 Uses local mapping => ${localNames[0] ?? mappedMappings[0]?.ref ?? "local"}`
      : `🔗 Uses ${mappedMappings.length} local mappings => ${localNames.join(", ")}`,
    commandId: FLOW_CONFIGURE_NODE_COMMAND_ID,
    arguments: [node.metadata.id]
  }];
}

function analyzePayloadbuilderFlowStateMappings(
  state: Record<string, unknown> | undefined,
  config: FlowEnvironmentConfig = getFlowEnvironmentConfig()
): PayloadbuilderFlowMappingAnalysis[] {
  return listPayloadbuilderFlowCatalogEntries(state).flatMap((entry) => {
    const provider = toOptionalString(entry.catalog.provider) ?? toOptionalString(entry.catalog.catalogId);
    return analyzePayloadbuilderFlowMappings(entry.catalog, provider, config).map((mapping) => ({
      ...mapping,
      alias: entry.alias
    }));
  });
}

function analyzePayloadbuilderFlowMappings(
  catalog: Record<string, unknown>,
  providerOrContribution?: string | PayloadbuilderCatalogContribution,
  config: FlowEnvironmentConfig = getFlowEnvironmentConfig(),
  providedOptions?: Record<string, Array<string | { value: string; label: string }>>
): PayloadbuilderFlowMappingAnalysis[] {
  const selectedProvider = typeof providerOrContribution === "string"
    ? listPayloadbuilderCatalogContributions().find((candidate) => candidate.catalogId === providerOrContribution)
    : providerOrContribution;
  const flowFields = selectedProvider?.flowMappingFields ?? [];
  if (flowFields.length === 0 || !selectedProvider) {
    return [];
  }

  const valuesByFieldId: Record<string, string> = Object.fromEntries(
    Object.entries(catalog).map(([key, value]) => [key, typeof value === "string" ? value : ""])
  );
  const results: PayloadbuilderFlowMappingAnalysis[] = [];

  for (const field of flowFields) {
    if (!field.persistAsLabel) {
      continue;
    }

    const storedValue = toOptionalString(catalog[field.id]);
    if (!storedValue) {
      continue;
    }

    const kind = getPayloadbuilderFlowMappingKind(selectedProvider.catalogId, field);
    const options = getPayloadbuilderFlowMappingOptions(field, valuesByFieldId, providedOptions);
    const exactValueMatch = options.find((option) => option.value === storedValue);
    if (exactValueMatch) {
      valuesByFieldId[field.id] = exactValueMatch.value;
      results.push({
        fieldId: field.id,
        label: field.label,
        kind,
        ref: storedValue,
        options,
        state: "direct",
        message: `${field.label} is already a local value.`,
        resolvedValue: exactValueMatch.value,
        resolvedLabel: exactValueMatch.label
      });
      continue;
    }

    const mapping = getFlowLocalMapping(config, {
      environment: config.activeEnvironment,
      owner: PAYLOADBUILDER_FLOW_MAPPING_OWNER,
      kind,
      ref: storedValue
    });
    const mappedOption = mapping
      ? options.find((option) => option.value === mapping.value)
      : undefined;
    if (mapping && mappedOption) {
      valuesByFieldId[field.id] = mappedOption.value;
      results.push({
        fieldId: field.id,
        label: field.label,
        kind,
        ref: storedValue,
        options,
        state: "mapped",
        message: `${storedValue} maps to ${mappedOption.label}.`,
        resolvedValue: mappedOption.value,
        resolvedLabel: mappedOption.label,
        mapping
      });
      continue;
    }

    const labelMatch = options.find((option) => option.label === storedValue);
    if (labelMatch) {
      valuesByFieldId[field.id] = labelMatch.value;
      results.push({
        fieldId: field.id,
        label: field.label,
        kind,
        ref: storedValue,
        options,
        state: "direct",
        message: `${field.label} matched a local option label.`,
        resolvedValue: labelMatch.value,
        resolvedLabel: labelMatch.label
      });
      continue;
    }

    results.push({
      fieldId: field.id,
      label: field.label,
      kind,
      ref: storedValue,
      options,
      state: mapping ? "invalid" : "missing",
      message: mapping
        ? `Payloadbuilder flow mapping '${field.id}' value '${storedValue}' points to a local value that is not available.`
        : `Payloadbuilder flow mapping '${field.id}' value '${storedValue}' is not mapped locally.`,
      mapping
    });
  }

  return results;
}

function getPayloadbuilderFlowMappingKind(
  catalogId: string,
  field: PayloadbuilderCatalogFlowMappingField
): string {
  return field.mappingKind ?? `${catalogId}.${field.id}`;
}

function getPayloadbuilderFlowMappingOptions(
  field: PayloadbuilderCatalogFlowMappingField,
  valuesByFieldId: Record<string, string>,
  providedOptions?: Record<string, Array<string | { value: string; label: string }>>
): PayloadbuilderFlowMappingOption[] {
  const rawOptions = providedOptions?.[field.id]
    ?? (field.listOptions ? field.listOptions(valuesByFieldId) : []);
  if (rawOptions instanceof Promise) {
    return [];
  }
  return rawOptions.map((option) => typeof option === "string"
    ? { value: option, label: option }
    : { value: option.value, label: option.label });
}
