import type { ReactNode } from "react";
import type { QueryEditorStatusItemContext } from "./QueryEditorStatusExtension.js";

export type QueryEditorHeaderItemContext = QueryEditorStatusItemContext;

export type QueryEditorHeaderItemContribution = {
  id: string;
  engineId?: string;
  title?: string;
  order?: number;
  render: (context: QueryEditorHeaderItemContext) => ReactNode;
};
