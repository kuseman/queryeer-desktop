import React, { useEffect, useMemo, useState } from "react";
import type { SettingDefinition } from "@queryeer/api/settings/SettingsExtension";
import {
  KEYBINDINGS_SCHEMA_VERSION,
  emptyUserKeybindingsDocument,
  type UserKeybindingsDocument
} from "@queryeer/api/commands/Keybindings";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import {
  resolveKeybindingState,
  type KeybindingDiagnostics,
  type ResolvedKeybinding
} from "./keybinding-resolver";
import {
  getKeybindingsExtensionsSnapshot,
  refreshKeybindingsFromRuntime,
  subscribeKeybindingsRuntime
} from "./keybindings-runtime-accessor";
import "./keybindings-settings.css";

type Props = {
  definition: SettingDefinition;
  value: unknown;
  setValue: (next: unknown) => void;
  readonly: boolean;
};

type RowView = {
  commandId: string;
  title: string;
  category?: string;
  effectiveKeys: string[];
  preferredWhen: string;
  preferredScope: "global" | "editor" | "terminal" | "explorer";
  source: "default" | "user";
  isDisabled: boolean;
  hasConflict: boolean;
  conflictText: string;
  isUserCustomized: boolean;
};

function normalizeInputKey(event: KeyboardEvent): string {
  const tokens: string[] = [];
  if (event.ctrlKey) tokens.push("Ctrl");
  if (event.metaKey) tokens.push("Cmd");
  if (event.altKey) tokens.push("Alt");
  if (event.shiftKey) tokens.push("Shift");
  const key = event.key;
  if (["Control", "Meta", "Shift", "Alt"].includes(key)) {
    return "";
  }
  const mapped: Record<string, string> = {
    " ": "Space",
    Escape: "Escape",
    Enter: "Enter",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight"
  };
  const tail = mapped[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...tokens, tail].join("+");
}

function createRows(
  extensions: ExtensionSnapshot,
  resolved: ResolvedKeybinding[],
  diagnostics: KeybindingDiagnostics,
  doc: UserKeybindingsDocument
): RowView[] {
  const byCommand = new Map<string, ResolvedKeybinding[]>();
  for (const item of resolved) {
    const list = byCommand.get(item.commandId) ?? [];
    list.push(item);
    byCommand.set(item.commandId, list);
  }

  const commandDisabled = new Set(doc.unbound.map((entry) => entry.commandId));
  const userCustomized = new Set<string>([
    ...doc.bindings.map((binding) => binding.commandId),
    ...doc.unbound.map((entry) => entry.commandId)
  ]);
  const conflictByCommand = new Map<string, string[]>();
  for (const d of diagnostics.duplicateBindings) {
    const winner = conflictByCommand.get(d.winnerCommandId) ?? [];
    winner.push(`Uses ${d.key} also bound to ${d.shadowedCommandId}`);
    conflictByCommand.set(d.winnerCommandId, winner);
    const shadow = conflictByCommand.get(d.shadowedCommandId) ?? [];
    shadow.push(`Shadowed by ${d.winnerCommandId} on ${d.key}`);
    conflictByCommand.set(d.shadowedCommandId, shadow);
  }

  return [...extensions.commands]
    .sort((a, b) => `${a.category ?? ""}/${a.title}`.localeCompare(`${b.category ?? ""}/${b.title}`))
    .map((command) => {
      const effective = byCommand.get(command.id) ?? [];
      return {
        commandId: command.id,
        title: command.title,
        category: command.category,
        effectiveKeys: effective.map((item) => item.key),
        preferredWhen: effective[0]?.when ?? "global",
        preferredScope: effective[0]?.scope ?? "global",
        source: effective[0]?.source ?? "default",
        isDisabled: commandDisabled.has(command.id) && effective.length === 0,
        hasConflict: (conflictByCommand.get(command.id)?.length ?? 0) > 0,
        conflictText: (conflictByCommand.get(command.id) ?? []).join("; "),
        isUserCustomized: userCustomized.has(command.id)
      };
    });
}

void React;

export function KeybindingsSettingsRenderer(_props: Props): JSX.Element {
  const [extensions, setExtensions] = useState<ExtensionSnapshot | null>(() => getKeybindingsExtensionsSnapshot());
  const [documentState, setDocumentState] = useState<UserKeybindingsDocument>(emptyUserKeybindingsDocument());
  const [query, setQuery] = useState("");
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [userOnly, setUserOnly] = useState(false);

  useEffect(() => {
    const load = async () => {
      const loaded = await window.appShell.getUserKeybindings();
      setDocumentState(loaded);
    };
    void load();
    return subscribeKeybindingsRuntime(() => {
      setExtensions(getKeybindingsExtensionsSnapshot());
    });
  }, []);

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const captured = normalizeInputKey(event);
      if (!captured) {
        return;
      }
      setDraftKey(captured);
      setIsRecording(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isRecording]);

  const resolvedState = useMemo(() => {
    if (!extensions) {
      return null;
    }
    return resolveKeybindingState(extensions, documentState);
  }, [extensions, documentState]);

  const rows = useMemo(() => {
    if (!extensions || !resolvedState) {
      return [];
    }
    const all = createRows(extensions, resolvedState.resolved, resolvedState.diagnostics, documentState);
    const q = query.trim().toLowerCase();
    return all.filter((row) => {
      if (conflictsOnly && !row.hasConflict) {
        return false;
      }
      if (userOnly && !row.isUserCustomized) {
        return false;
      }
      if (!q) {
        return true;
      }
      return [row.commandId, row.title, row.category, row.effectiveKeys.join(" "), row.conflictText]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [extensions, resolvedState, documentState, query, conflictsOnly, userOnly]);

  const rowsByCommand = useMemo(() => {
    const map = new Map<string, RowView>();
    for (const row of rows) {
      map.set(row.commandId, row);
    }
    return map;
  }, [rows]);

  const persist = async (next: UserKeybindingsDocument) => {
    setIsSaving(true);
    setStatus(null);
    await window.appShell.saveUserKeybindings(next);
    const reloaded = await window.appShell.getUserKeybindings();
    setDocumentState(reloaded);
    await refreshKeybindingsFromRuntime();
    setStatus("Saved and verified from persisted keybindings.json");
    setIsSaving(false);
  };

  const rebind = async (commandId: string) => {
    const key = draftKey.trim();
    if (!key) {
      setStatus("Shortcut is required");
      return;
    }
    const row = rowsByCommand.get(commandId);
    const when = row?.preferredWhen ?? "global";
    const scope = row?.preferredScope ?? "global";
    const existingUnbound = documentState.unbound.filter((entry) => entry.commandId !== commandId);
    const next: UserKeybindingsDocument = {
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: [
        ...documentState.bindings.filter((binding) => !(binding.commandId === commandId && (binding.when ?? "global") === when)),
        { commandId, key, when, scope }
      ],
      unbound: [...existingUnbound, { commandId, when }]
    };
    await persist(next);
    setEditingCommandId(null);
    setDraftKey("");
  };

  const disableCommand = async (commandId: string) => {
    const hasUnbound = documentState.unbound.some((entry) => entry.commandId === commandId);
    if (hasUnbound) {
      return;
    }
    const next: UserKeybindingsDocument = {
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: documentState.bindings.filter((binding) => binding.commandId !== commandId),
      unbound: [...documentState.unbound, { commandId }]
    };
    await persist(next);
  };

  const resetCommand = async (commandId: string) => {
    const next: UserKeybindingsDocument = {
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: documentState.bindings.filter((binding) => binding.commandId !== commandId),
      unbound: documentState.unbound.filter((entry) => entry.commandId !== commandId)
    };
    await persist(next);
  };

  if (!extensions || !resolvedState) {
    return <div className="kb-settings-empty">Keybinding runtime is not ready yet.</div>;
  }

  return (
    <div className="kb-settings-root">
      <div className="kb-settings-toolbar">
        <input
          type="search"
          className="kb-settings-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commands or shortcuts"
        />
        <span className="kb-settings-count">{rows.length} commands</span>
        <label className="kb-filter-toggle">
          <input
            type="checkbox"
            checked={conflictsOnly}
            onChange={(event) => setConflictsOnly(event.target.checked)}
          />
          <span>Conflicts</span>
        </label>
        <label className="kb-filter-toggle">
          <input
            type="checkbox"
            checked={userOnly}
            onChange={(event) => setUserOnly(event.target.checked)}
          />
          <span>User</span>
        </label>
      </div>

      <div className="kb-settings-table" role="table" aria-label="Keybindings">
        {rows.map((row) => {
          const editing = editingCommandId === row.commandId;
          return (
            <div key={row.commandId} className="kb-settings-row" role="row">
              <div className="kb-settings-main">
                <div className="kb-settings-title">{row.title}</div>
                <div className="kb-settings-subtitle">
                  {row.category ? <span className="kb-settings-category">{row.category}</span> : null}
                  <span className="kb-settings-command-id">{row.commandId}</span>
                </div>
              </div>
              <div className="kb-settings-key">
                {row.isDisabled ? (
                  <span className="kb-pill disabled">Disabled</span>
                ) : row.effectiveKeys.length > 0 ? (
                  row.effectiveKeys.map((key) => <span key={`${row.commandId}-${key}`} className="kb-pill">{key}</span>)
                ) : (
                  <span className="kb-pill empty">Unassigned</span>
                )}
                <span className={`kb-source ${row.source}`}>{row.source}</span>
              </div>
              <div className="kb-settings-actions">
                {!editing && <button type="button" onClick={() => { setEditingCommandId(row.commandId); setDraftKey(""); }}>Change</button>}
                <button type="button" onClick={() => void disableCommand(row.commandId)} disabled={isSaving}>Turn off</button>
                <button type="button" onClick={() => void resetCommand(row.commandId)} disabled={isSaving}>Reset</button>
              </div>
              {editing && (
                <div className="kb-settings-editor">
                  <input
                    type="text"
                    value={draftKey}
                    onChange={(event) => setDraftKey(event.target.value)}
                    placeholder="Ctrl+K"
                  />
                  <button type="button" onClick={() => setIsRecording((s) => !s)} className={isRecording ? "recording" : ""}>
                    {isRecording ? "Recording..." : "Record shortcut"}
                  </button>
                  <button type="button" onClick={() => void rebind(row.commandId)} disabled={isSaving}>Save</button>
                  <button type="button" onClick={() => { setEditingCommandId(null); setIsRecording(false); setDraftKey(""); }}>Cancel</button>
                </div>
              )}
              {row.hasConflict && <div className="kb-settings-conflict">Conflict: {row.conflictText}</div>}
            </div>
          );
        })}
      </div>
      {status && <div className="kb-settings-status">{status}</div>}
      {resolvedState.diagnostics.invalidUserBindings.length > 0 && (
        <div className="kb-settings-warning">Invalid user bindings detected: {resolvedState.diagnostics.invalidUserBindings.length}</div>
      )}
    </div>
  );
}
