import React, { useCallback, useEffect, useState } from "react";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import { InlineMonacoEditor, WhenExpressionEditor } from "../core.commands/WhenExpressionEditor";
import type { TreeAction, TreeActionMode, TreeActionOutputTarget } from "./tree-action-types";
import { getTreeActionRegistry } from "./tree-action-registry";
import {
  listTreeActionTemplates,
  subscribeTreeActionTemplates,
  type TreeActionTemplateContribution
} from "./tree-action-template-registry";
import { getOutputRegistry } from "../core.queryengine/output/OutputRegistry";
import "./tree-action-settings.css";

void React;

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

const MODE_OPTIONS: { value: TreeActionMode; label: string }[] = [
  { value: "execute", label: "Execute query" },
  { value: "render", label: "Render template" },
];

const TARGET_OPTIONS: { value: TreeActionOutputTarget; label: string }[] = [
  { value: "output", label: "Output panel" },
  { value: "clipboard", label: "Clipboard" },
  { value: "newQuery", label: "New query file" },
  { value: "newQueryAndExecute", label: "New query file with execute" },
];

function parseActions(value: unknown): TreeAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is TreeAction =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).id === "string" &&
      typeof (item as Record<string, unknown>).label === "string" &&
      typeof (item as Record<string, unknown>).when === "string" &&
      typeof (item as Record<string, unknown>).query === "string"
  );
}

function generateId(): string {
  return `tree-action-${Date.now().toString(36)}`;
}

export function TreeActionsSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [actions, setActions] = useState<TreeAction[]>(() => parseActions(value));
  const [templates, setTemplates] = useState<TreeActionTemplateContribution[]>(() => listTreeActionTemplates());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("__empty__");
  const [selectedId, setSelectedId] = useState<string | undefined>(() => actions[0]?.id);

  useEffect(() => subscribeTreeActionTemplates(() => setTemplates(listTreeActionTemplates())), []);

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

  const { persistNow } = useCollectionSettingsPersistence<TreeAction>({
    persist: (next) => {
      setValue(next);
      getTreeActionRegistry().setActions(next);
    }
  });

  const syncActions = useCallback(
    (next: TreeAction[], nextSelectedId?: string) => {
      setActions(next);
      if (nextSelectedId !== undefined) setSelectedId(nextSelectedId);
      persistNow(next);
    },
    [persistNow]
  );

  const handleAdd = useCallback(() => {
    const newAction: TreeAction = {
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
    const newAction: TreeAction = {
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
      const cloned: TreeAction = { ...source, id: generateId(), label: `${source.label} (copy)` };
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
    (id: string, patch: Partial<TreeAction>) => {
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
        <div className="tree-action-detail">
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
            <div className="tree-action-query-editor">
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
              onChange={(e) => updateField(action.id, { mode: e.target.value as TreeActionMode })}
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
              onChange={(e) => updateField(action.id, { outputTarget: e.target.value as TreeActionOutputTarget })}
            >
              {TARGET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Output ID</label>
            <select
              className="settings-field-input"
              value={action.outputId ?? ""}
              disabled={readonly}
              onChange={(e) => {
                const v = e.target.value.trim();
                updateField(action.id, { outputId: v === "" ? undefined : v });
              }}
            >
              <option value="">(default output)</option>
              {getOutputRegistry().getSelectablePrimaryContributors().map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
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
        <div className="tree-action-template-toolbar">
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
