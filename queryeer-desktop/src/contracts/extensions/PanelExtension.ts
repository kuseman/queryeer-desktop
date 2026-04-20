import type { ReactNode } from "react";

export type PanelPlacement = "left" | "right" | "bottom" | "center";

export type PanelExtension = {
  id: string;
  title: string;
  placement: PanelPlacement;
  render: () => ReactNode;
};
