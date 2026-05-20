import React, { useCallback, useEffect, useState } from "react";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import { InlineMonacoEditor, WhenExpressionEditor } from "../core.commands/WhenExpressionEditor";
import type { TableAction, TableActionMode, TableActionOutputTarget } from "./table-action-types";
import { getTableActionRegistry } from "./table-action-registry";
import {
  listTableActionTemplates,
  subscribeTableActionTemplates,
  type TableActionTemplateContribution
} from "./table-action-template-registry";

void React;

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

const MODE_OPTIONS: { value: TableActionMode; label: string }[] = [
  { value: "execute", label: "Execute query" },
  { value: "render", label: "Render template" },
];

const TARGET_OPTIONS: { value: TableActionOutputTarget; label: string }[] = [
  { value: "output", label: "Output panel" },
  { value: "clipboard", label: "Clipboard" },
  { value: "newFile", label: "New file" },
];

function parseActions(value: unknown): TableAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is TableAction =>
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

export function TableActionsSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [actions, setActions] = useState<TableAction[]>(() => parseActions(value));
  const [templates, setTemplates] = useState<TableActionTemplateContribution[]>(() => listTableActionTemplates());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("__empty__");
  const [selectedId, setSelectedId] = useState<string | undefined>(() => actions[0]?.id);

  useEffect(() => subscribeTableActionTemplates(() => setTemplates(listTableActionTemplates())), []);

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

  const { persistNow } = useCollectionSettingsPersistence<TableAction>({
    persist: (next) => {
      setValue(next);
      getTableActionRegistry().setActions(next);
    }
  });

  const syncActions = useCallback(
    (next: TableAction[], nextSelectedId?: string) => {
      setActions(next);
      if (nextSelectedId !== undefined) setSelectedId(nextSelectedId);
      persistNow(next);
    },
    [persistNow]
  );

  const handleAdd = useCallback(() => {
    const newAction: TableAction = {
      id: generateId(),
      label: "New Action",
      when: "",
      query: "",
      mode: "execute",
      outputTarget: "output",
    };
    const next = [...actions, newAction];
    syncActions(next, newAction.id);
  }, [actions, syncActions]);

  const handleAddFromTemplate = useCallback(() => {
    const template = templates.find((t) => t.id === selectedTemplateId);
    if (!template) return;
    const newAction: TableAction = {
      id: generateId(),
      ...template.action,
    };
    const next = [...actions, newAction];
    syncActions(next, newAction.id);
  }, [actions, selectedTemplateId, syncActions, templates]);

  const handleClone = useCallback(
    (id: string) => {
      const source = actions.find((a) => a.id === id);
      if (!source) return;
      const cloned: TableAction = { ...source, id: generateId(), label: `${source.label} (copy)` };
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
    (id: string, patch: Partial<TableAction>) => {
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
            <InlineMonacoEditor
              value={action.label}
              language="plaintext"
              height={48}
              wordWrap
              readonly={readonly}
              onChange={(v) => updateField(action.id, { label: v })}
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
            <label className="settings-field-label">Mode</label>
            <select
              className="settings-field-input"
              value={action.mode}
              disabled={readonly}
              onChange={(e) => updateField(action.id, { mode: e.target.value as TableActionMode })}
            >
              {MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Output Target</label>
            <select
              className="settings-field-input"
              value={action.outputTarget}
              disabled={readonly}
              onChange={(e) => updateField(action.id, { outputTarget: e.target.value as TableActionOutputTarget })}
            >
              {TARGET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
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
