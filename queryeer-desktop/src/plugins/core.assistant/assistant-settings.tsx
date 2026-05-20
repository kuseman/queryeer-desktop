import { useEffect, useMemo, useState } from "react";
import type { SecretRefValue } from "../../contracts/security/Security";
import { CollectionSettingsListEditor } from "../core.settings/CollectionSettingsListEditor";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import {
  OPENAI_DEFAULT_HOST,
  createAssistantConnection,
  sanitizeAssistantConnections,
  type AssistantConnectionDraft
} from "./assistant-types";

type Props = {
  value: unknown;
  setValue: (next: unknown) => void;
  readonly: boolean;
};

export function AssistantConnectionsSettingsEditor({ value, setValue, readonly }: Props): JSX.Element {
  const [connections, setConnections] = useState<AssistantConnectionDraft[]>(() => sanitizeAssistantConnections(value));
  const [selectedId, setSelectedId] = useState<string | undefined>(() => connections[0]?.id);

  useEffect(() => {
    const next = sanitizeAssistantConnections(value);
    setConnections(next);
    setSelectedId((previous) => previous && next.some((item) => item.id === previous) ? previous : next[0]?.id);
  }, [value]);

  const items = useMemo(() => connections.map((connection) => ({
    id: connection.id,
    label: connection.name || "Unnamed provider",
    subtitle: `${connection.provider === "openai" ? "OpenAI" : "Custom"} - ${connection.host}`,
    invalid: !connection.name.trim() || !connection.host.trim()
  })), [connections]);

  const persist = (next: AssistantConnectionDraft[]): void => {
    setConnections(next);
    setValue(next);
  };

  const updateConnection = (id: string, patch: Partial<AssistantConnectionDraft>): void => {
    persist(connections.map((connection) => {
      if (connection.id !== id) {
        return connection;
      }
      const next = { ...connection, ...patch };
      if (patch.provider === "openai" && !connection.host.trim()) {
        next.host = OPENAI_DEFAULT_HOST;
      }
      return next;
    }));
  };

  return (
    <CollectionSettingsListEditor
      items={items}
      selectedId={selectedId}
      readonly={readonly}
      addLabel="Add provider"
      onSelect={setSelectedId}
      onAdd={() => {
        const created = createAssistantConnection("openai");
        persist([...connections, created]);
        setSelectedId(created.id);
      }}
      onClone={(id) => {
        const source = connections.find((connection) => connection.id === id);
        if (!source) {
          return;
        }
        const cloned = {
          ...source,
          id: createAssistantConnection().id,
          name: `${source.name} Copy`,
          apiKeyRef: undefined
        };
        persist([...connections, cloned]);
        setSelectedId(cloned.id);
      }}
      onDelete={(id) => {
        const next = connections.filter((connection) => connection.id !== id);
        persist(next);
        setSelectedId(next[0]?.id);
      }}
      renderDetails={(id) => {
        const connection = connections.find((item) => item.id === id);
        if (!connection) {
          return <div className="settings-list-editor-placeholder">Select an assistant provider.</div>;
        }
        return (
          <div className="assistant-settings-detail">
            <label className="settings-field">
              <span className="settings-field-label">Provider</span>
              <select
                className="settings-field-input"
                value={connection.provider}
                disabled={readonly}
                onChange={(event) => {
                  const provider = event.target.value === "custom" ? "custom" : "openai";
                  updateConnection(connection.id, {
                    provider,
                    name: connection.name.trim() ? connection.name : provider === "openai" ? "OpenAI" : "Custom Assistant",
                    host: provider === "openai" && !connection.host.trim() ? OPENAI_DEFAULT_HOST : connection.host
                  });
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-field-label">API Type</span>
              <select className="settings-field-input" value={connection.apiType} disabled>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Name</span>
              <input
                className="settings-field-input"
                value={connection.name}
                readOnly={readonly}
                onChange={(event) => updateConnection(connection.id, { name: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Host</span>
              <input
                className="settings-field-input"
                value={connection.host}
                readOnly={readonly}
                placeholder={connection.provider === "openai" ? OPENAI_DEFAULT_HOST : "http://localhost:1234/v1"}
                onChange={(event) => updateConnection(connection.id, { host: event.target.value })}
              />
            </label>
            <div className="settings-field">
              <span className="settings-field-label">API Key</span>
              <PasswordFieldInput
                inputId={`assistant-api-key-${connection.id}`}
                readonly={readonly}
                valueRef={connection.apiKeyRef}
                onChangeRef={(apiKeyRef: SecretRefValue | undefined) => {
                  updateConnection(connection.id, { apiKeyRef });
                }}
              />
              <p className="settings-setting-id">Leave empty for local providers that do not require authentication.</p>
            </div>
          </div>
        );
      }}
    />
  );
}
