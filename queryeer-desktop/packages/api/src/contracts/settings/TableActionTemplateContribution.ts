import type { TableAction } from "./TableActionSettings.js";

export type TableActionTemplateContribution = {
  id: string;
  title: string;
  description?: string;
  action: Omit<TableAction, "id">;
  order?: number;
};
