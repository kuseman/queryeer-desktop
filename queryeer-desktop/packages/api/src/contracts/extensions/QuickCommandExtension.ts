import type { FileEntity } from "../files/FileEntity.js";

export type QuickCommandItemTitlePart = {
  text: string;
  color?: string;
};

export type QuickCommandItem = {
  id: string;
  title: string;
  titleParts?: QuickCommandItemTitlePart[];
  description?: string;
  icon?: string;
  action: () => void | Promise<void>;
};

export type QuickCommandContext = {
  activeFile?: FileEntity;
  openFiles: FileEntity[];
};

export type QuickCommandProvider = {
  /** Single char trigger (e.g. '>', '#', '$'). Omit to contribute to the global list only. */
  prefix?: string;
  label: string;
  order?: number;
  /** When expression evaluated against the effective context chain. Provider is skipped when false. */
  when?: string;
  getItems: (
    query: string,
    ctx: QuickCommandContext
  ) => QuickCommandItem[] | Promise<QuickCommandItem[]>;
};

export type QuickCommandRegistry = {
  registerProvider: (provider: QuickCommandProvider) => void;
};
