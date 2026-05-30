import type { Position, TextRange } from "../editor/EditorApi.js";

/** Context provided to a ContextMenuProvider when the editor context menu is about to open. */
export type ContextMenuContext = {
  position: Position;
  selection: TextRange | null;
  mimeType: string | null;
  fileId: string | null;
};

/** A single item to display in the editor context menu. */
export type ContextMenuItem = {
  id: string;
  label: string;
  order?: number;
  run(): void;
};

/** Provider of context menu items. Called by the editor when the context menu opens. */
export type ContextMenuProvider = {
  id: string;
  getItems(context: ContextMenuContext): Promise<ContextMenuItem[]>;
};

/** Registry for context menu providers, exposed on PluginContext. */
export type ContextMenuRegistry = {
  registerProvider(provider: ContextMenuProvider): void;
  unregisterProvider(id: string): void;
};
