import type { TreeAction } from "./TreeActionSettings.js";

export type TreeActionTemplateContribution = {
  id: string;
  title: string;
  description?: string;
  action: Omit<TreeAction, "id">;
  order?: number;
};
