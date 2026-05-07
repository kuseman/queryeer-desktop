export type ShortcutRule = {
  id: string;
  /** Context expression evaluated against the active when-clause context. Absent = always match. */
  when?: string;
  /** Query template. Supports ${selectedText} substitution. */
  query: string;
  /** OutputContributor id. Absent = use the active file's toolbar-selected output. */
  outputId?: string;
  description?: string;
};

export type QueryShortcut = {
  slot: number;
  label?: string;
  rules: ShortcutRule[];
};

export type QueryShortcutsConfig = {
  shortcuts: QueryShortcut[];
};
