import type { FileEntity } from "../files/FileEntity.js";

export type TooltipSeverity = "info" | "warning" | "error";

export type TooltipSection = {
  label: string;
  value: string;
  severity?: TooltipSeverity;
};

export type TooltipSectionContribution = {
  id: string;
  order: number;
  render: (context: { file: FileEntity }) => TooltipSection | null;
};

export type TooltipRegistry = {
  registerTooltipSection: (contribution: TooltipSectionContribution) => void;
};
