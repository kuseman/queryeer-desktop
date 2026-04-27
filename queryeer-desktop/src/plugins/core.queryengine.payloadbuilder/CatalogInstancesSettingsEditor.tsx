import { useEffect, useMemo, useState } from "react";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import {
  listPayloadbuilderCatalogContributions,
  subscribePayloadbuilderCatalogContributions
} from "./catalog-contributions";
import {
  parseCatalogAliasDefinitions,
  type PayloadbuilderCatalogAliasDefinition
} from "./catalog-settings";

type Row = {
  id: string;
  alias: string;
  catalogId: string;
  title: string;
  enabled: boolean;
};

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

export function CatalogInstancesSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [rows, setRows] = useState<Row[]>(() => toRows(parseCatalogAliasDefinitions(value)));
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>(() => rows[0]?.id);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const { persistNow, persistDebounced } = useCollectionSettingsPersistence<Row>({
    persist: (nextRows) => {
      setValue(
        nextRows.map((row) => ({
          alias: row.alias,
          catalogId: row.catalogId,
          title: row.title || undefined,
          enabled: row.enabled
        }))
      );
    }
  });

  const catalogSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    suggestions.add("elasticsearch");
    for (const contribution of listPayloadbuilderCatalogContributions()) {
      suggestions.add(contribution.catalogId);
    }
    for (const row of rows) {
      const catalogId = row.catalogId.trim();
      if (catalogId) {
        suggestions.add(catalogId);
      }
    }
    return [...suggestions].sort((a, b) => a.localeCompare(b));
  }, [catalogRevision, rows]);

  useEffect(() => {
    return subscribePayloadbuilderCatalogContributions(() => {
      setCatalogRevision((prev) => prev + 1);
    });
  }, []);

  useEffect(() => {
    const incoming = parseCatalogAliasDefinitions(value);
    setRows((previous) => mergeRows(previous, incoming));
  }, [value]);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedRowId(undefined);
      return;
    }
    if (!selectedRowId || !rows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(rows[0]?.id);
    }
  }, [rows, selectedRowId]);

  const syncRows = (nextRows: Row[], nextSelectedId?: string, options?: { debouncePersist?: boolean }): void => {
    setRows(nextRows);
    if (nextSelectedId !== undefined) {
      setSelectedRowId(nextSelectedId);
    }
    if (options?.debouncePersist) {
      persistDebounced(nextRows);
      return;
    }

    persistNow(nextRows);
  };

  const updateRow = (id: string, patch: Partial<Row>): void => {
    const next = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    syncRows(next, undefined, { debouncePersist: true });
  };

  const removeRow = (id: string): void => {
    const index = rows.findIndex((row) => row.id === id);
    const nextRows = rows.filter((row) => row.id !== id);
    const nextSelection = nextRows[index]?.id ?? nextRows[index - 1]?.id;
    syncRows(nextRows, nextSelection);
  };

  const addRow = (): void => {
    const next: Row = {
      id: crypto.randomUUID(),
      alias: "",
      catalogId: catalogSuggestions[0] ?? "",
      title: "",
      enabled: true
    };
    syncRows([...rows, next], next.id);
  };

  const cloneRow = (id: string): void => {
    const source = rows.find((row) => row.id === id);
    if (!source) {
      return;
    }

    const clone: Row = {
      ...source,
      id: crypto.randomUUID(),
      alias: buildCloneAlias(source.alias, rows)
    };
    syncRows([...rows, clone], clone.id);
  };

  const moveRow = (id: string, direction: -1 | 1): void => {
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) {
      return;
    }
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return;
    }

    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(targetIndex, 0, row);
    syncRows(next);
  };

  const rowErrors = useMemo(() => buildRowErrors(rows), [rows]);
  return (
    <div className="payloadbuilder-settings-editor">
      <div className="payloadbuilder-settings-help">
        Configure alias to catalog mappings used by Payloadbuilder queries.
      </div>

      <CollectionSettingsListEditor
        items={rows.map((row) => ({
          id: row.id,
          label: row.alias.trim() || "(new alias)",
          subtitle: row.catalogId || "Catalog ID required",
          invalid: Boolean(rowErrors[row.id])
        }))}
        selectedId={selectedRowId}
        readonly={readonly}
        addLabel="Add Alias"
        onSelect={setSelectedRowId}
        onAdd={addRow}
        onClone={cloneRow}
        onDelete={removeRow}
        renderDetails={(id) => {
          const row = rows.find((item) => item.id === id);
          if (!row) {
            return <div className="payloadbuilder-catalog-empty">Select an alias to edit details.</div>;
          }
          return (
            <div className="payloadbuilder-settings-detail-grid" role="group" aria-label="Catalog alias details">
              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-settings-alias">
                  Alias
                </label>
                <input
                  id="payloadbuilder-settings-alias"
                  className="payloadbuilder-catalog-input"
                  value={row.alias}
                  readOnly={readonly}
                  placeholder="es1"
                  onChange={(event) => updateRow(row.id, { alias: event.target.value })}
                />
                {rowErrors[row.id]?.alias && (
                  <div className="payloadbuilder-settings-error">{rowErrors[row.id].alias}</div>
                )}
              </div>
              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-settings-catalog-id">
                  Catalog ID
                </label>
                <select
                  id="payloadbuilder-settings-catalog-id"
                  className="payloadbuilder-catalog-select"
                  value={row.catalogId}
                  disabled={readonly}
                  onChange={(event) => updateRow(row.id, { catalogId: event.target.value })}
                >
                  {catalogSuggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion}>
                      {suggestion}
                    </option>
                  ))}
                </select>
                {rowErrors[row.id]?.catalogId && (
                  <div className="payloadbuilder-settings-error">{rowErrors[row.id].catalogId}</div>
                )}
              </div>
              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-settings-title">
                  Title (optional)
                </label>
                <input
                  id="payloadbuilder-settings-title"
                  className="payloadbuilder-catalog-input"
                  value={row.title}
                  readOnly={readonly}
                  placeholder="Search"
                  onChange={(event) => updateRow(row.id, { title: event.target.value })}
                />
              </div>
              <label className="payloadbuilder-settings-enabled">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  disabled={readonly}
                  onChange={(event) => updateRow(row.id, { enabled: event.target.checked })}
                />
                <span>{row.enabled ? "Enabled" : "Disabled"}</span>
              </label>
              <div className="payloadbuilder-settings-actions">
                <button
                  type="button"
                  className="payloadbuilder-catalog-button"
                  disabled={readonly || rows[0]?.id === row.id}
                  onClick={() => moveRow(row.id, -1)}
                  title="Move up"
                >
                  Up
                </button>
                <button
                  type="button"
                  className="payloadbuilder-catalog-button"
                  disabled={readonly || rows[rows.length - 1]?.id === row.id}
                  onClick={() => moveRow(row.id, 1)}
                  title="Move down"
                >
                  Down
                </button>
              </div>
            </div>
          );
        }}
      />

    </div>
  );
}

function buildCloneAlias(alias: string, rows: Row[]): string {
  const normalized = alias.trim() || "alias";
  const taken = new Set(rows.map((row) => row.alias.trim()));
  if (!taken.has(normalized)) {
    return normalized;
  }
  let index = 2;
  while (taken.has(`${normalized}${index}`)) {
    index++;
  }
  return `${normalized}${index}`;
}

function mergeRows(previous: Row[], definitions: PayloadbuilderCatalogAliasDefinition[]): Row[] {
  const byAlias = new Map(previous.map((row) => [row.alias.trim(), row]));
  return definitions.map((definition, index) => {
    const fromIndex = previous[index];
    const fromAlias = byAlias.get(definition.alias);
    const id = fromIndex?.id ?? fromAlias?.id ?? crypto.randomUUID();
    return {
      id,
      alias: definition.alias,
      catalogId: definition.catalogId,
      title: definition.title ?? "",
      enabled: definition.enabled
    };
  });
}

function buildRowErrors(rows: Row[]): Record<string, { alias?: string; catalogId?: string }> {
  const aliasCounts = new Map<string, number>();
  for (const row of rows) {
    const alias = row.alias.trim();
    if (!alias) continue;
    aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
  }

  const errors: Record<string, { alias?: string; catalogId?: string }> = {};
  for (const row of rows) {
    const alias = row.alias.trim();
    const catalogId = row.catalogId.trim();
    const rowError: { alias?: string; catalogId?: string } = {};

    if (!alias) {
      rowError.alias = "Alias is required";
    } else if ((aliasCounts.get(alias) ?? 0) > 1) {
      rowError.alias = "Alias must be unique";
    }

    if (!catalogId) {
      rowError.catalogId = "Catalog ID is required";
    }

    if (rowError.alias || rowError.catalogId) {
      errors[row.id] = rowError;
    }
  }
  return errors;
}

function toRows(definitions: PayloadbuilderCatalogAliasDefinition[]): Row[] {
  return definitions.map((definition) => ({
    id: crypto.randomUUID(),
    alias: definition.alias,
    catalogId: definition.catalogId,
    title: definition.title ?? "",
    enabled: definition.enabled
  }));
}
