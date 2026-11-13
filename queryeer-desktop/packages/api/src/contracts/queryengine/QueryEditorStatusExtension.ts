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
  engineId?: string;
  alignment?: "left" | "right";
  order?: number;
  render: (context: QueryEditorStatusItemContext) => ReactNode;
};
