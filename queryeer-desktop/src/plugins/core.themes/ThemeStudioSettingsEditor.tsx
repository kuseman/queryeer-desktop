import { useEffect, useMemo, useState } from "react";
import { BUILT_IN_THEMES } from "./built-in-themes";
import { listThemeFiles, readThemeManifest, saveThemeManifest } from "./theme-files";
import { getThemeService } from "./runtime";
import { ACTIVE_THEME_SETTING_ID, type ThemeManifest } from "./theme-types";
import { getCoreSettingsService } from "../core.settings/service";
import "./theme-studio.css";

type StudioTheme = ThemeManifest & { fileName: string };

const DEFAULT_TOKENS = BUILT_IN_THEMES.find((t) => t.id === "queryeer.light")?.tokens ?? {};

export function ThemeStudioSettingsEditor(): JSX.Element {
  const [items, setItems] = useState<StudioTheme[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudioTheme | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => items.find((item) => item.fileName === selectedFile) ?? null,
    [items, selectedFile]
  );

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setDraft(selected ? { ...selected, tokens: { ...selected.tokens } } : null);
  }, [selectedFile, selected]);

  const load = async () => {
    const files = await listThemeFiles();
    const manifests: StudioTheme[] = [];
    for (const fileName of files) {
      const manifest = await readThemeManifest(fileName);
      if (manifest) {
        manifests.push({ ...manifest, fileName });
      }
    }
    setItems(manifests);
    if (!selectedFile && manifests.length > 0) {
      setSelectedFile(manifests[0].fileName);
    }
  };

  const createNew = () => {
    const next: StudioTheme = {
      fileName: "custom-theme.json",
      id: "custom.theme",
      name: "Custom Theme",
      mode: "light",
      description: "",
      tokens: { ...DEFAULT_TOKENS }
    };
    setSelectedFile(null);
    setDraft(next);
  };

  const duplicateFromBuiltIn = () => {
    const source = BUILT_IN_THEMES.find((t) => t.id === "queryeer.light") ?? BUILT_IN_THEMES[0];
    setDraft({
      fileName: `${source.id.replace(/\./g, "-")}-copy.json`,
      id: `${source.id}.custom`,
      name: `${source.name} Copy`,
      mode: source.mode,
      description: source.description,
      tokens: { ...source.tokens }
    });
    setSelectedFile(null);
  };

  const save = async () => {
    if (!draft) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await saveThemeManifest(draft.fileName, {
        id: draft.id,
        name: draft.name,
        mode: draft.mode,
        description: draft.description,
        tokens: draft.tokens
      });
      await getThemeService()?.reloadThemes();
      await load();
      setSelectedFile(draft.fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const applyTheme = async () => {
    if (!draft) {
      return;
    }
    const settings = getCoreSettingsService();
    if (!settings) {
      return;
    }
    await settings.setValue(ACTIVE_THEME_SETTING_ID, draft.id);
  };

  return (
    <div className="theme-studio">
      <div>
        <div className="theme-studio-actions" style={{ marginBottom: 8 }}>
          <button type="button" onClick={createNew}>New</button>
          <button type="button" onClick={duplicateFromBuiltIn}>Duplicate</button>
        </div>
        <div className="theme-studio-list">
          {items.map((item) => (
            <button
              key={item.fileName}
              type="button"
              className={`theme-studio-item ${selectedFile === item.fileName ? "active" : ""}`}
              onClick={() => setSelectedFile(item.fileName)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>

      {draft ? (
        <div className="theme-studio-form">
          <div className="theme-studio-row"><label>File</label><input value={draft.fileName} onChange={(e) => setDraft({ ...draft, fileName: e.target.value })} /></div>
          <div className="theme-studio-row"><label>Id</label><input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} /></div>
          <div className="theme-studio-row"><label>Name</label><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div className="theme-studio-row"><label>Mode</label><select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as "light" | "dark" })}><option value="light">Light</option><option value="dark">Dark</option></select></div>
          <div className="theme-studio-row"><label>Description</label><input value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
          <label>Tokens JSON</label>
          <textarea
            rows={12}
            value={JSON.stringify(draft.tokens, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value) as Record<string, string>;
                setDraft({ ...draft, tokens: parsed });
                setError(null);
              } catch {
                setError("Invalid tokens JSON");
              }
            }}
          />
          <div className="theme-studio-actions">
            <button type="button" onClick={() => void save()} disabled={saving}>Save Theme</button>
            <button type="button" onClick={() => void applyTheme()} disabled={saving}>Apply Theme</button>
          </div>
          {error ? <div className="settings-error">{error}</div> : null}
        </div>
      ) : <div className="settings-advanced-empty">Select or create a custom theme.</div>}
    </div>
  );
}
