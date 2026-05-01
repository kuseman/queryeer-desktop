import type { FileEntity } from "../files/FileEntity.js";

export type QuickCommandItem = {
  id: string;
  title: string;
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
  getItems: (
    query: string,
    ctx: QuickCommandContext
  ) => QuickCommandItem[] | Promise<QuickCommandItem[]>;
};

export type QuickCommandRegistry = {
  registerProvider: (provider: QuickCommandProvider) => void;
};
