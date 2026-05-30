import type { ColumnType } from "./OutputExtension.js";

export type TableLinkAction = {
  kind: "preview" | "external";
  title: string;
  value: string;
  mimeType?: string;
};

export type TableLinkActionContext = {
  value: unknown;
  columnType: ColumnType;
};

export type TableLinkActionContribution = {
  id: string;
  match: (context: TableLinkActionContext) => TableLinkAction | null;
};
