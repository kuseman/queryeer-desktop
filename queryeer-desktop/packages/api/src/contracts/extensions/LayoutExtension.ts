import type { ReactNode } from "react";
import type { ContentCategory, FileOpenIntent, MimeCapability } from "../files/FilesRegistry.js";
import type { FileEntity } from "../files/FileEntity.js";

export type LayoutZone =
  | "menuBar"
  | "toolBar"
  | "statusBar"
  | "primarySidebar"
  | "secondarySidebar"
  | "mainArea"
  | "panel";

export type SidebarZone = "primarySidebar" | "secondarySidebar";

export type DockPlacement = "start" | "end" | "before" | "after";

export type LayoutActionIconRenderer = (props: { className?: string }) => ReactNode;

export type LayoutToolbarContext = {
  activeFile?: FileEntity;
  activeEditorGroupId?: string;
  editorGroupCount: number;
  hasMultipleEditorGroups: boolean;
};

export type LayoutToolbarActionContribution = {
  id: string;
  type?: "action";
  title?: string;
  order?: number;
  alignment?: "west" | "east";
  commandId: string;
  icon?: string | LayoutActionIconRenderer;
  when?: string;
  pressed?: (context: LayoutToolbarContext) => boolean;
};

export type LayoutToolbarSeparatorContribution = {
  id: string;
  type: "separator";
  order?: number;
  alignment?: "west" | "east";
  when?: string;
};

export type LayoutToolbarSelectOption = {
  value: string;
  label: string;
};

export type LayoutToolbarSelectContribution = {
  id: string;
  type: "select";
  title?: string;
  order?: number;
  alignment?: "west" | "east";
  when?: string;
  getOptions: (context: LayoutToolbarContext) => LayoutToolbarSelectOption[];
  getValue: (context: LayoutToolbarContext) => string;
  onChange: (value: string, context: LayoutToolbarContext) => void;
  disabled?: boolean | ((context: LayoutToolbarContext) => boolean);
  isVisible?: (context: LayoutToolbarContext) => boolean;
};

export type LayoutToolbarMenuItem = {
  value: string;
  label: string;
  icon?: string | LayoutActionIconRenderer;
};

export type LayoutToolbarMenuContribution = {
  id: string;
  type: "menu";
  title?: string;
  order?: number;
  alignment?: "west" | "east";
  icon?: string | LayoutActionIconRenderer;
  when?: string;
  getItems: (context: LayoutToolbarContext) => LayoutToolbarMenuItem[];
  onSelect: (value: string, context: LayoutToolbarContext) => void;
  disabled?: boolean | ((context: LayoutToolbarContext) => boolean);
  isVisible?: (context: LayoutToolbarContext) => boolean;
};

export type LayoutToolbarContribution =
  | LayoutToolbarActionContribution
  | LayoutToolbarSeparatorContribution
  | LayoutToolbarSelectContribution
  | LayoutToolbarMenuContribution;

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
  render: (context: LayoutToolbarContext) => ReactNode;
};

export type LayoutStatusItemContribution = {
  id: string;
  alignment?: "left" | "right";
  order?: number;
  commandId?: string;
  render: () => ReactNode;
};

export type LayoutEditorInstanceContext = {
  editorInstanceId: string;
  editorGroupId: string;
  editorGroupIndex: number;
  editorGroupCount: number;
  isActiveEditorGroup: boolean;
};

export type LayoutEditorRenderContext = Partial<LayoutEditorInstanceContext> & {
  activeFile?: FileEntity;
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
  render: (context?: LayoutEditorRenderContext) => ReactNode;
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
  editorGroupId?: string;
};

export type TabHeaderStyle = {
  className?: string;
  indicatorClassName?: string;
  style?: React.CSSProperties;
};

export type TabHeaderStyleContribution = {
  id: string;
  order?: number;
  render: (context: TabHeaderStyleContext) => TabHeaderStyle | null;
};

export type TabTitleContext = {
  file: FileEntity;
  isActive: boolean;
  hasCapability: (capability: MimeCapability) => boolean;
  baseTitle: string;
};

export type TabTitleContribution = {
  id: string;
  order?: number;
  render: (context: TabTitleContext) =>
    | {
        prefix?: string;
        suffix?: string;
        mainOverride?: string;
      }
    | null;
};

export type LayoutPanelTab = {
  id: string;
  title: string;
  icon?: string;
  order?: number;
  render: () => ReactNode;
};

export type LayoutPanelContribution = {
  id: string;
  tabs: LayoutPanelTab[];
  defaultHeight?: number;
  minHeight?: number;
  maxHeight?: number;
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
  registerTabTitle: (contribution: TabTitleContribution) => void;
  registerPanel: (contribution: LayoutPanelContribution) => void;
  setShellDefaults: (defaults: LayoutShellDefaults) => void;
};
