import React, { useCallback, useEffect, useState } from "react";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import { InlineMonacoEditor, WhenExpressionEditor } from "../core.commands/WhenExpressionEditor";
import type { SymbolAction } from "./symbol-action-types";
import { getSymbolActionRegistry } from "./symbol-action-registry";
import {
  listSymbolActionTemplates,
  subscribeSymbolActionTemplates,
  type SymbolActionTemplateContribution
} from "./symbol-action-template-registry";

void React;

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

function parseActions(value: unknown): SymbolAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is SymbolAction =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).id === "string" &&
      typeof (item as Record<string, unknown>).label === "string" &&
      typeof (item as Record<string, unknown>).when === "string" &&
      typeof (item as Record<string, unknown>).query === "string"
  );
}

function generateId(): string {
  return `action-${Date.now().toString(36)}`;
}

export function SymbolActionsSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [actions, setActions] = useState<SymbolAction[]>(() => parseActions(value));
  const [templates, setTemplates] = useState<SymbolActionTemplateContribution[]>(() => listSymbolActionTemplates());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("__empty__");
  const [selectedId, setSelectedId] = useState<string | undefined>(() => actions[0]?.id);

  useEffect(() => subscribeSymbolActionTemplates(() => setTemplates(listSymbolActionTemplates())), []);

  useEffect(() => {
    if (templates.length === 0) {
      setSelectedTemplateId("__empty__");
      return;
    }
    if (!templates.some((t) => t.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  useEffect(() => {
    if (actions.length === 0) {
      setSelectedId(undefined);
    } else if (!selectedId || !actions.some((a) => a.id === selectedId)) {
      setSelectedId(actions[0]?.id);
    }
  }, [actions, selectedId]);

  const { persistNow } = useCollectionSettingsPersistence<SymbolAction>({
    persist: (next) => {
      setValue(next);
      getSymbolActionRegistry().setActions(next);
    }
  });

  const syncActions = useCallback(
    (next: SymbolAction[], nextSelectedId?: string) => {
      setActions(next);
      if (nextSelectedId !== undefined) setSelectedId(nextSelectedId);
      persistNow(next);
    },
    [persistNow]
  );

  const handleAdd = useCallback(() => {
    const newAction: SymbolAction = {
      id: generateId(),
      label: "New Action",
      when: "",
      query: ""
    };
    const next = [...actions, newAction];
    syncActions(next, newAction.id);
  }, [actions, syncActions]);

  const handleAddFromTemplate = useCallback(() => {
    const template = templates.find((t) => t.id === selectedTemplateId);
    if (!template) {
      return;
    }
    const newAction: SymbolAction = {
      id: generateId(),
      ...template.action
    };
    const next = [...actions, newAction];
    syncActions(next, newAction.id);
  }, [actions, selectedTemplateId, syncActions, templates]);

  const handleClone = useCallback(
    (id: string) => {
      const source = actions.find((a) => a.id === id);
      if (!source) return;
      const cloned: SymbolAction = { ...source, id: generateId(), label: `${source.label} (copy)` };
      const next = [...actions, cloned];
      syncActions(next, cloned.id);
    },
    [actions, syncActions]
  );

  const handleDelete = useCallback(
    (id: string) => {
      const next = actions.filter((a) => a.id !== id);
      syncActions(next);
    },
    [actions, syncActions]
  );

  const updateField = useCallback(
    (id: string, patch: Partial<SymbolAction>) => {
      const next = actions.map((a) => (a.id === id ? { ...a, ...patch } : a));
      syncActions(next, id);
    },
    [actions, syncActions]
  );

  const renderDetails = useCallback(
    (id: string | undefined): React.ReactNode => {
      const action = actions.find((a) => a.id === id);
      if (!action) {
        return (
          <div className="settings-list-editor-placeholder">
            Select an action to edit, or add a new one.
          </div>
        );
      }

      return (
        <div className="symbol-action-detail">
          <div className="settings-field">
            <label className="settings-field-label">Label</label>
            <input
              className="settings-field-input"
              type="text"
              value={action.label}
              disabled={readonly}
              onChange={(e) => updateField(action.id, { label: e.target.value })}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">When Expression</label>
            <WhenExpressionEditor
              value={action.when}
              onChange={(v) => updateField(action.id, { when: v })}
              height={64}
              wordWrap
              readonly={readonly}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Query Template</label>
            <div className="symbol-action-query-editor">
              <InlineMonacoEditor
                value={action.query}
                language="sql"
                height={180}
                wordWrap={false}
                readonly={readonly}
                onChange={(v) => updateField(action.id, { query: v })}
              />
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Order</label>
            <input
              className="settings-field-input"
              type="number"
              value={action.order ?? ""}
              disabled={readonly}
              placeholder="(optional)"
              onChange={(e) => {
                const v = e.target.value.trim();
                updateField(action.id, { order: v === "" ? undefined : parseInt(v, 10) });
              }}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Output ID</label>
            <input
              className="settings-field-input"
              type="text"
              value={action.outputId ?? ""}
              disabled={readonly}
              placeholder="(optional, leave empty for default output)"
              onChange={(e) => {
                const v = e.target.value.trim();
                updateField(action.id, { outputId: v === "" ? undefined : v });
              }}
            />
          </div>
        </div>
      );
    },
    [actions, readonly, updateField]
  );

  return (
    <>
      {templates.length > 0 && (
        <div className="symbol-action-template-toolbar">
          <select
            className="settings-field-input"
            value={selectedTemplateId}
            disabled={readonly || templates.length === 0}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            title={templates.find((t) => t.id === selectedTemplateId)?.description}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="settings-list-editor-add"
            disabled={readonly || templates.length === 0 || selectedTemplateId === "__empty__"}
            onClick={handleAddFromTemplate}
          >
            Add Template
          </button>
        </div>
      )}
      <CollectionSettingsListEditor
        items={actions.map((a) => ({
          id: a.id,
          label: a.label,
          subtitle: a.when || undefined
        }))}
        selectedId={selectedId}
        readonly={readonly}
        addLabel="Add Action"
        onSelect={setSelectedId}
        onAdd={handleAdd}
        onClone={handleClone}
        onDelete={handleDelete}
        renderDetails={renderDetails}
      />
    </>
  );
}
