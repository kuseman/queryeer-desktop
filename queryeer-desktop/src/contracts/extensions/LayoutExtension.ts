import type { ReactNode } from "react";
import type { ContentCategory, FileOpenIntent, MimeCapability } from "../files/FilesRegistry";
import type { FileEntity } from "../files/FileEntity";

export type LayoutZone =
  | "menuBar"
  | "toolBar"
  | "statusBar"
  | "primarySidebar"
  | "secondarySidebar"
  | "mainArea";

export type SidebarZone = "primarySidebar" | "secondarySidebar";

export type DockPlacement = "start" | "end" | "before" | "after";

export type LayoutToolbarActionContribution = {
  id: string;
  title: string;
  order?: number;
  commandId: string;
  icon?: string;
};

export type LayoutPanelAction = {
  id: string;
  icon: string;
  title?: string;
  commandId: string;
};

export type LayoutViewContribution = {
  id: string;
  title: string;
  defaultZone: SidebarZone;
  order?: number;
  canMoveZones?: boolean;
  canCollapse?: boolean;
  isOpen?: boolean;
  flex?: number;
  minHeight?: number;
  maxHeight?: number;
  panelActions?: LayoutPanelAction[];
  render: () => ReactNode;
};

export type LayoutStatusItemContribution = {
  id: string;
  alignment?: "left" | "right";
  order?: number;
  commandId?: string;
  render: () => ReactNode;
};

export type LayoutEditorContribution = {
  id: string;
  title: string;
  order?: number;
  resourceScheme?: string;
  supportedMimeTypes?: string[];
  supportedContentCategories?: ContentCategory[];
  requiredCapabilities?: MimeCapability[];
  openIntents?: FileOpenIntent[];
  priority?: number;
  canSplit?: boolean;
  render: (context?: { activeFile?: FileEntity }) => ReactNode;
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
  registerToolbarAction: (contribution: LayoutToolbarActionContribution) => void;
  registerStatusItem: (contribution: LayoutStatusItemContribution) => void;
  registerView: (contribution: LayoutViewContribution) => void;
  registerEditor: (contribution: LayoutEditorContribution) => void;
  registerWelcome: (contribution: LayoutWelcomeContribution) => void;
  setShellDefaults: (defaults: LayoutShellDefaults) => void;
};
