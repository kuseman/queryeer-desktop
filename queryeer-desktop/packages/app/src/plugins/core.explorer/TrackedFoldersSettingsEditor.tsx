type TrackedFolder = {
  uri: string;
  name: string;
  label?: string;
  filterRegex: string;
};

type TrackedFoldersSettingsEditorProps = {
  value: unknown;
  setValue: (next: unknown) => void;
  readonly: boolean;
};

function toTrackedFolders(value: unknown): TrackedFolder[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const next: TrackedFolder[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const uri = typeof record.uri === "string" ? record.uri : "";
    const name = typeof record.name === "string" ? record.name : "";
    const label = typeof record.label === "string" && record.label.trim().length > 0 ? record.label.trim() : undefined;
    const filterRegex = typeof record.filterRegex === "string" ? record.filterRegex : "";
    if (!uri || !name) {
      continue;
    }
    next.push({ uri, name, label, filterRegex });
  }
  return next;
}

export function TrackedFoldersSettingsEditor({
  value,
  setValue,
  readonly
}: TrackedFoldersSettingsEditorProps) {
  const rows = toTrackedFolders(value);

  if (rows.length === 0) {
    return <div className="settings-advanced-empty">No tracked folders yet. Use Explorer + to add one.</div>;
  }

  return (
    <div className="settings-advanced-table">
      <div className="settings-advanced-hint">Example regex: <code>\.(sql|plbsql)$</code></div>
      <div className="settings-advanced-row settings-advanced-head">
        <span>Folder</span>
        <span>Display name</span>
        <span>Regex filter</span>
        <span>Action</span>
      </div>
      {rows.map((row, index) => (
        <div key={`${row.uri}-${index}`} className="settings-advanced-row">
          <div className="settings-advanced-folder">
            <div className="settings-advanced-folder-name">{row.name}</div>
            <div className="settings-advanced-folder-uri">{row.uri}</div>
          </div>
          <input
            type="text"
            value={row.label ?? ""}
            placeholder={row.name}
            disabled={readonly}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, label: event.target.value || undefined };
              setValue(next);
            }}
          />
          <input
            type="text"
            value={row.filterRegex}
            disabled={readonly}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, filterRegex: event.target.value };
              setValue(next);
            }}
          />
          <button
            type="button"
            disabled={readonly}
            onClick={() => {
              const next = rows.filter((_, i) => i !== index);
              setValue(next);
            }}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
