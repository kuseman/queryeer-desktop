import type { SymbolAction } from "./SymbolActionTypes.js";

export type SymbolActionTemplateContribution = {
  id: string;
  title: string;
  description?: string;
  action: Omit<SymbolAction, "id">;
  order?: number;
};
