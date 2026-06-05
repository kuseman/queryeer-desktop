import type { ReactNode } from "react";
import type { OutputContext } from "./OutputExtension.js";
import type { FileEntity } from "../files/FileEntity.js";

export type QueryEditorStatusItemContext = {
  fileId: string;
  file: FileEntity | undefined;
  outputContext: OutputContext;
};

export type QueryEditorStatusItemContribution = {
  id: string;
  alignment?: "left" | "right";
  order?: number;
  render: (context: QueryEditorStatusItemContext) => ReactNode;
};

const items = new Map<string, QueryEditorStatusItemContribution>();

export function registerQueryEditorStatusItem(
  item: QueryEditorStatusItemContribution
): void {
  items.set(item.id, item);
}

export function getQueryEditorStatusItems(): QueryEditorStatusItemContribution[] {
  return [...items.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
