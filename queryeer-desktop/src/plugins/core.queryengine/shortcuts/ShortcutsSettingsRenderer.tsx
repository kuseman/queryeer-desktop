import React, { useState, useEffect, useCallback } from "react";
import type { SettingDefinition } from "../../../contracts/extensions/SettingsExtension";
import { getOutputRegistry } from "../output/OutputRegistry";
import type { QueryShortcut, QueryShortcutsConfig, ShortcutRule } from "./shortcut-types";
import { WhenExpressionEditor, InlineMonacoEditor } from "../../core.commands/WhenExpressionEditor";
import { getKeybindingLabel } from "../../core.commands/keybinding-label-accessor";
import "./shortcuts-settings.css";

void React;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function parseConfig(raw: unknown): QueryShortcutsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { shortcuts: [] };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.shortcuts)) {
    return { shortcuts: [] };
  }
  return { shortcuts: obj.shortcuts as QueryShortcut[] };
}

function getOrCreateShortcut(config: QueryShortcutsConfig, slot: number): QueryShortcut {
  return config.shortcuts.find((s) => s.slot === slot) ?? { slot, rules: [] };
}

function upsertShortcut(config: QueryShortcutsConfig, updated: QueryShortcut): QueryShortcutsConfig {
  const others = config.shortcuts.filter((s) => s.slot !== updated.slot);
  const keep = updated.rules.length > 0 || (updated.label !== undefined && updated.label !== "");
  return {
    shortcuts: keep
      ? [...others, updated].sort((a, b) => a.slot - b.slot)
      : others
  };
}

function makeRule(): ShortcutRule {
  return { id: crypto.randomUUID(), query: "" };
}

// ---------------------------------------------------------------------------
// SlotDetail — right-side panel for the selected slot
// ---------------------------------------------------------------------------

type SlotDetailProps = {
  shortcut: QueryShortcut;
  onChange: (updated: QueryShortcut) => void;
  readonly: boolean;
};

function SlotDetail({ shortcut, onChange, readonly }: SlotDetailProps): JSX.Element {
  const outputOptions = getOutputRegistry().getSelectablePrimaryContributors();

  const updateRule = useCallback((ruleId: string, patch: Partial<ShortcutRule>) => {
    onChange({
      ...shortcut,
      rules: shortcut.rules.map((r) => r.id === ruleId ? { ...r, ...patch } : r)
    });
  }, [shortcut, onChange]);

  const deleteRule = useCallback((ruleId: string) => {
    onChange({ ...shortcut, rules: shortcut.rules.filter((r) => r.id !== ruleId) });
  }, [shortcut, onChange]);

  const moveRule = useCallback((ruleId: string, direction: -1 | 1) => {
    const rules = [...shortcut.rules];
    const idx = rules.findIndex((r) => r.id === ruleId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= rules.length) return;
    [rules[idx], rules[newIdx]] = [rules[newIdx]!, rules[idx]!];
    onChange({ ...shortcut, rules });
  }, [shortcut, onChange]);

  const addRule = useCallback(() => {
    onChange({ ...shortcut, rules: [...shortcut.rules, makeRule()] });
  }, [shortcut, onChange]);

  return (
    <div className="shortcut-slot-body">
      {shortcut.rules.length === 0 && (
        <span className="shortcut-slot-empty">No rules yet. Add one below.</span>
      )}

      <div className="shortcut-rules-list">
        {shortcut.rules.map((rule, idx) => (
          <div key={rule.id} className="shortcut-rule">
            <div className="shortcut-rule-header">
              <span className="shortcut-rule-number">Rule {idx + 1}</span>
              <input
                className="shortcut-rule-description"
                type="text"
                placeholder="Description (optional)"
                value={rule.description ?? ""}
                readOnly={readonly}
                onChange={(e) => updateRule(rule.id, { description: e.target.value || undefined })}
              />
              {!readonly && (
                <>
                  <button
                    className="shortcut-rule-move-btn"
                    title="Move up"
                    disabled={idx === 0}
                    onClick={() => moveRule(rule.id, -1)}
                  >↑</button>
                  <button
                    className="shortcut-rule-move-btn"
                    title="Move down"
                    disabled={idx === shortcut.rules.length - 1}
                    onClick={() => moveRule(rule.id, 1)}
                  >↓</button>
                  <button
                    className="shortcut-rule-delete-btn"
                    title="Delete rule"
                    onClick={() => deleteRule(rule.id)}
                  >✕</button>
                </>
              )}
            </div>

            <div className="shortcut-rule-body">
              <div className="shortcut-field">
                <span className="shortcut-field-label">
                  When
                  {!rule.when && (
                    <span className="shortcut-when-empty-badge">always matches</span>
                  )}
                </span>
                <WhenExpressionEditor
                  value={rule.when ?? ""}
                  height={32}
                  readonly={readonly}
                  onChange={(v) => updateRule(rule.id, { when: v || undefined })}
                />
              </div>

              <div className="shortcut-field shortcut-field-query">
                <span className="shortcut-field-label">
                  Query
                  <span className="shortcut-field-hint">{'${selectedText}'} is replaced with the editor selection</span>
                </span>
                <div className="shortcut-monaco-container">
                  <InlineMonacoEditor
                    value={rule.query}
                    language="sql"
                    height="flex"
                    wordWrap={false}
                    readonly={readonly}
                    onChange={(v) => updateRule(rule.id, { query: v })}
                  />
                </div>
              </div>

              <div className="shortcut-field shortcut-field-output">
                <span className="shortcut-field-label">Output</span>
                <select
                  className="shortcut-output-select"
                  value={rule.outputId ?? ""}
                  disabled={readonly}
                  onChange={(e) => updateRule(rule.id, { outputId: e.target.value || undefined })}
                >
                  <option value="">Active file default</option>
                  {outputOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!readonly && (
        <button className="shortcut-add-rule-btn" onClick={addRule}>
          + Add Rule
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShortcutsSettingsRenderer (root)
// ---------------------------------------------------------------------------

type Props = {
  definition: SettingDefinition;
  value: unknown;
  setValue: (next: unknown) => void;
  readonly: boolean;
};

export function ShortcutsSettingsRenderer({ value, setValue, readonly }: Props): JSX.Element {
  const [config, setConfig] = useState<QueryShortcutsConfig>(() => parseConfig(value));
  const [selectedSlot, setSelectedSlot] = useState<number>(0);

  useEffect(() => {
    setConfig(parseConfig(value));
  }, [value]);

  const handleShortcutChange = useCallback((updated: QueryShortcut) => {
    setConfig((prev) => {
      const next = upsertShortcut(prev, updated);
      setValue(next);
      return next;
    });
  }, [setValue]);

  const handleLabelChange = useCallback((slot: number, label: string) => {
    setConfig((prev) => {
      const shortcut = getOrCreateShortcut(prev, slot);
      const updated = { ...shortcut, label: label || undefined };
      const next = upsertShortcut(prev, updated);
      setValue(next);
      return next;
    });
  }, [setValue]);

  const selectedShortcut = getOrCreateShortcut(config, selectedSlot);

  return (
    <div className="shortcuts-settings">
      <div className="shortcuts-slot-list">
        {Array.from({ length: 10 }, (_, i) => {
          const shortcut = getOrCreateShortcut(config, i);
          const ruleCount = shortcut.rules.length;
          return (
            <div
              key={i}
              className={`shortcuts-slot-item${selectedSlot === i ? " selected" : ""}`}
              onClick={() => setSelectedSlot(i)}
            >
              <div className="shortcuts-slot-item-top">
                <span className="shortcut-slot-badge">{getKeybindingLabel(`core.queryengine.shortcut.${i}`) ?? `Ctrl+${i}`}</span>
                <span className="shortcuts-slot-item-label">
                  {shortcut.label || <span className="shortcuts-slot-item-placeholder">Slot {i}</span>}
                </span>
              </div>
              {ruleCount > 0 && (
                <span className="shortcuts-slot-item-count">
                  {ruleCount} {ruleCount === 1 ? "rule" : "rules"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="shortcuts-detail">
        <div className="shortcuts-detail-header">
          <input
            className="shortcut-slot-label-input"
            type="text"
            placeholder={`Slot ${selectedSlot} label…`}
            value={selectedShortcut.label ?? ""}
            readOnly={readonly}
            onChange={(e) => handleLabelChange(selectedSlot, e.target.value)}
          />
        </div>
        <div className="shortcuts-detail-body">
          <SlotDetail
            shortcut={selectedShortcut}
            onChange={handleShortcutChange}
            readonly={readonly}
          />
        </div>
      </div>
    </div>
  );
}
