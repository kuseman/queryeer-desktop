import { useMemo, useState } from "react";
import type { SecretRefValue } from "@queryeer/api/security/Security";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import { parsePayloadbuilderEnvironments } from "./environment-settings";

type VariableRow = { id: string; key: string; value: string; secretRef?: SecretRefValue };
type EnvironmentRow = { id: string; envId: string; title: string; variables: VariableRow[] };

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

export function PayloadbuilderEnvironmentsSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [rows, setRows] = useState<EnvironmentRow[]>(() => toRows(value));
  const [selectedId, setSelectedId] = useState<string | undefined>(() => rows[0]?.id);
  const { persistNow, persistDebounced } = useCollectionSettingsPersistence<EnvironmentRow>({
    persist: (nextRows) => {
      setValue(
        nextRows.map((row) => ({
          id: row.envId,
          title: row.title,
          variables: row.variables
            .filter((v) => v.key.trim() && ((v.value.trim() && !v.secretRef?.secretRef) || (!v.value.trim() && Boolean(v.secretRef?.secretRef))))
            .map((v) => ({
              key: v.key.trim(),
              ...(v.value.trim() ? { value: v.value.trim() } : {}),
              ...(v.secretRef?.secretRef ? { secretRef: v.secretRef } : {})
            }))
        }))
      );
    }
  });

  const sync = (nextRows: EnvironmentRow[], debounce = false): void => {
    setRows(nextRows);
    if (debounce) persistDebounced(nextRows);
    else persistNow(nextRows);
  };

  const errors = useMemo(() => buildErrors(rows), [rows]);

  return <CollectionSettingsListEditor
    items={rows.map((row) => ({
      id: row.id,
      label: row.title || "(new environment)",
      subtitle: `${row.variables.length} variable${row.variables.length === 1 ? "" : "s"}`,
      invalid: Boolean(errors[row.id])
    }))}
    selectedId={selectedId}
    readonly={readonly}
    addLabel="Add Environment"
    onSelect={setSelectedId}
    onAdd={() => {
      const row: EnvironmentRow = {
        id: crypto.randomUUID(),
        envId: crypto.randomUUID(),
        title: "",
        variables: []
      };
      sync([...rows, row]);
      setSelectedId(row.id);
    }}
    onDelete={(id) => sync(rows.filter((r) => r.id !== id))}
    onClone={(id) => {
      const source = rows.find((r) => r.id === id);
      if (!source) return;
      const clone = { ...source, id: crypto.randomUUID(), envId: crypto.randomUUID() };
      sync([...rows, clone]);
      setSelectedId(clone.id);
    }}
    renderDetails={(id) => {
      const row = rows.find((x) => x.id === id);
      if (!row) return <div className="payloadbuilder-catalog-empty">Select an environment.</div>;
      return <div className="payloadbuilder-settings-detail-grid" role="group" aria-label="Payloadbuilder environment details">
        <div className="payloadbuilder-settings-cell"><label>Title</label><input className="payloadbuilder-catalog-input" value={row.title} readOnly={readonly} onChange={(e) => sync(rows.map((r) => r.id === row.id ? { ...r, title: e.target.value } : r), true)} /></div>
        <div className="payloadbuilder-settings-cell"><label>Variables</label>
          <table className="payloadbuilder-environment-grid"><thead><tr><th>Name</th><th>Value</th><th>Secret Ref</th><th /></tr></thead><tbody>
            {row.variables.map((v) => <tr key={v.id}><td><input className="payloadbuilder-catalog-input" value={v.key} readOnly={readonly} onChange={(e) => sync(rows.map((r) => r.id === row.id ? { ...r, variables: r.variables.map((x) => x.id === v.id ? { ...x, key: e.target.value } : x) } : r), true)} /></td><td><input className="payloadbuilder-catalog-input" value={v.value} readOnly={readonly || Boolean(v.secretRef?.secretRef)} onChange={(e) => sync(rows.map((r) => r.id === row.id ? { ...r, variables: r.variables.map((x) => x.id === v.id ? { ...x, value: e.target.value, secretRef: undefined } : x) } : r), true)} /></td><td><PasswordFieldInput inputId={`payloadbuilder-env-secret-${row.id}-${v.id}`} valueRef={v.secretRef} readonly={readonly || Boolean(v.value.trim())} onChangeRef={(nextRef) => sync(rows.map((r) => r.id === row.id ? { ...r, variables: r.variables.map((x) => x.id === v.id ? { ...x, secretRef: nextRef, value: "" } : x) } : r), true)} /></td><td><button type="button" className="payloadbuilder-catalog-button" disabled={readonly} onClick={() => sync(rows.map((r) => r.id === row.id ? { ...r, variables: r.variables.filter((x) => x.id !== v.id) } : r))}>Delete</button></td></tr>)}
          </tbody></table>
          <button type="button" className="payloadbuilder-catalog-button" disabled={readonly} onClick={() => sync(rows.map((r) => r.id === row.id ? { ...r, variables: [...r.variables, { id: crypto.randomUUID(), key: "", value: "" }] } : r))}>Add Variable</button>
        </div>
      </div>;
    }}
  />;
}

function toRows(value: unknown): EnvironmentRow[] {
  return parsePayloadbuilderEnvironments(value).map((env) => ({
    id: crypto.randomUUID(),
    envId: env.id,
    title: env.title,
    variables: env.variables.map((v) => ({
      id: crypto.randomUUID(),
      key: v.key,
      value: v.value ?? "",
      secretRef: v.secretRef
    }))
  }));
}

function buildErrors(rows: EnvironmentRow[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const row of rows) {
    if (!row.title.trim()) {
      errors[row.id] = "Environment title is required";
    }
  }
  return errors;
}
