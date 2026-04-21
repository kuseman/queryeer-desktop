import type { ReactNode } from "react";

export type LayoutZone =
  | "menuBar"
  | "toolBar"
  | "statusBar"
  | "primarySidebar"
  | "secondarySidebar"
  | "mainArea";

export type SidebarZone = "primarySidebar" | "secondarySidebar";

export type DockPlacement = "start" | "end" | "before" | "after";

export type LayoutMenuItemContribution = {
  id: string;
  label: string;
  order?: number;
  commandId?: string;
  group?: "file" | "edit" | "view" | "run" | "tools" | "help";
};

export type LayoutToolbarActionContribution = {
  id: string;
  title: string;
  order?: number;
  commandId: string;
  icon?: string;
};

export type LayoutStatusItemContribution = {
  id: string;
  alignment?: "left" | "right";
  order?: number;
  render: () => ReactNode;
};

export type LayoutViewContribution = {
  id: string;
  title: string;
  defaultZone: SidebarZone;
  order?: number;
  canMoveZones?: boolean;
  render: () => ReactNode;
};

export type LayoutEditorContribution = {
  id: string;
  title: string;
  order?: number;
  resourceScheme?: string;
  supportedMimeTypes?: string[];
  canSplit?: boolean;
  render: () => ReactNode;
};

export type LayoutWelcomeContribution = {
  id: string;
  order?: number;
  render: () => ReactNode;
};

export type LayoutShellDefaults = {
  visibleZones: LayoutZone[];
  sidebarWidths?: {
    primary?: number;
    secondary?: number;
  };
  statusBarHeight?: number;
};

export type LayoutRegistry = {
  registerMenuItem: (contribution: LayoutMenuItemContribution) => void;
  registerToolbarAction: (contribution: LayoutToolbarActionContribution) => void;
  registerStatusItem: (contribution: LayoutStatusItemContribution) => void;
  registerView: (contribution: LayoutViewContribution) => void;
  registerEditor: (contribution: LayoutEditorContribution) => void;
  registerWelcome: (contribution: LayoutWelcomeContribution) => void;
  setShellDefaults: (defaults: LayoutShellDefaults) => void;
};
