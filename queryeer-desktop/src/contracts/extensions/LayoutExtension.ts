import type { ReactNode } from "react";
import type { ContentCategory, FileOpenIntent, MimeCapability } from "../files/FilesRegistry.js";
import type { FileEntity } from "../files/FileEntity.js";

export type LayoutZone =
  | "menuBar"
  | "toolBar"
  | "statusBar"
  | "primarySidebar"
  | "secondarySidebar"
  | "mainArea";

export type SidebarZone = "primarySidebar" | "secondarySidebar";

export type DockPlacement = "start" | "end" | "before" | "after";

export type LayoutActionIconRenderer = (props: { className?: string }) => ReactNode;

export type LayoutToolbarActionContribution = {
  id: string;
  type?: "action";
  title?: string;
  order?: number;
  alignment?: "west" | "east";
  commandId: string;
  icon?: string | LayoutActionIconRenderer;
  when?: string;
};

export type LayoutToolbarSeparatorContribution = {
  id: string;
  type: "separator";
  order?: number;
  alignment?: "west" | "east";
  when?: string;
};

export type LayoutToolbarContribution = LayoutToolbarActionContribution | LayoutToolbarSeparatorContribution;

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
  when?: string;
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

export type TabContextMenuAction = {
  id: string;
  label: string;
  order?: number;
  icon?: string;
  enabledWhen?: string;
};

export type TabContextMenuContribution = {
  id: string;
  order?: number;
  actions: TabContextMenuAction[];
};

export type TabHeaderStyleContext = {
  file: FileEntity;
  isActive: boolean;
  hasCapability: (capability: MimeCapability) => boolean;
};

export type TabHeaderStyle = {
  className?: string;
  indicatorClassName?: string;
};

export type TabHeaderStyleContribution = {
  id: string;
  order?: number;
  render: (context: TabHeaderStyleContext) => TabHeaderStyle | null;
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
  registerToolbarAction: (contribution: LayoutToolbarContribution) => void;
  registerStatusItem: (contribution: LayoutStatusItemContribution) => void;
  registerView: (contribution: LayoutViewContribution) => void;
  registerEditor: (contribution: LayoutEditorContribution) => void;
  registerWelcome: (contribution: LayoutWelcomeContribution) => void;
  registerTabContextMenu: (contribution: TabContextMenuContribution) => void;
  registerTabHeaderStyle: (contribution: TabHeaderStyleContribution) => void;
  setShellDefaults: (defaults: LayoutShellDefaults) => void;
};
