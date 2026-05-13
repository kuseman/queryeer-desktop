import type * as monacoType from "monaco-editor";

type SettingsReader = {
  getValue: (settingId: string) => unknown;
};

type WordWrapMode = "off" | "on" | "wordWrapColumn";
type LineNumbersMode = "off" | "on" | "relative";
type RenderWhitespaceMode = "none" | "boundary" | "selection" | "all";
type CursorBlinkingMode = "blink" | "smooth" | "phase" | "solid";

function readBoolean(reader: SettingsReader | null, settingId: string, fallback: boolean): boolean {
  const value = reader?.getValue(settingId);
  return typeof value === "boolean" ? value : fallback;
}

function readString(reader: SettingsReader | null, settingId: string, fallback: string): string {
  const value = reader?.getValue(settingId);
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readNumber(
  reader: SettingsReader | null,
  settingId: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = reader?.getValue(settingId);
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function readEnum<T extends string>(
  reader: SettingsReader | null,
  settingId: string,
  fallback: T,
  allowed: readonly T[]
): T {
  const value = reader?.getValue(settingId);
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export type ResolvedEditorSettings = {
  fontSize: number;
  fontFamily: string;
  wordWrap: WordWrapMode;
  tabSize: number;
  insertSpaces: boolean;
  lineNumbers: LineNumbersMode;
  minimapEnabled: boolean;
  renderWhitespace: RenderWhitespaceMode;
  cursorBlinking: CursorBlinkingMode;
  formatOnSave: boolean;
};

export function resolveEditorSettings(reader: SettingsReader | null): ResolvedEditorSettings {
  return {
    fontSize: readNumber(reader, "core.editor.texteditor.fontSize", 13, 8, 32),
    fontFamily: readString(reader, "core.editor.texteditor.fontFamily", "JetBrains Mono, Consolas, monospace"),
    wordWrap: readEnum(reader, "core.editor.texteditor.wordWrap", "off", ["off", "on", "wordWrapColumn"]),
    tabSize: readNumber(reader, "core.editor.texteditor.tabSize", 4, 1, 12),
    insertSpaces: readBoolean(reader, "core.editor.texteditor.insertSpaces", true),
    lineNumbers: readEnum(reader, "core.editor.texteditor.lineNumbers", "on", ["off", "on", "relative"]),
    minimapEnabled: readBoolean(reader, "core.editor.texteditor.minimap.enabled", true),
    renderWhitespace: readEnum(
      reader,
      "core.editor.texteditor.renderWhitespace",
      "selection",
      ["none", "boundary", "selection", "all"]
    ),
    cursorBlinking: readEnum(reader, "core.editor.texteditor.cursorBlinking", "blink", [
      "blink",
      "smooth",
      "phase",
      "solid"
    ]),
    formatOnSave: readBoolean(reader, "core.editor.texteditor.formatOnSave", false)
  };
}

export function buildMonacoCreateOptions(
  reader: SettingsReader | null
): monacoType.editor.IStandaloneEditorConstructionOptions {
  const settings = resolveEditorSettings(reader);
  return {
    value: "",
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: settings.minimapEnabled },
    scrollBeyondLastLine: false,
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    lineNumbers: settings.lineNumbers,
    renderLineHighlight: "all",
    glyphMargin: false,
    folding: true,
    wordWrap: settings.wordWrap,
    tabSize: settings.tabSize,
    insertSpaces: settings.insertSpaces,
    renderWhitespace: settings.renderWhitespace,
    cursorBlinking: settings.cursorBlinking,
    contextmenu: false,
    model: null
  };
}

export function buildMonacoUpdateOptions(
  reader: SettingsReader | null
): monacoType.editor.IEditorOptions {
  const settings = resolveEditorSettings(reader);
  return {
    minimap: { enabled: settings.minimapEnabled },
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    lineNumbers: settings.lineNumbers,
    wordWrap: settings.wordWrap,
    renderWhitespace: settings.renderWhitespace,
    cursorBlinking: settings.cursorBlinking
  };
}

export function buildMonacoModelUpdateOptions(
  reader: SettingsReader | null
): monacoType.editor.ITextModelUpdateOptions {
  const settings = resolveEditorSettings(reader);
  return {
    tabSize: settings.tabSize,
    insertSpaces: settings.insertSpaces
  };
}
