export type MenuItemContribution = {
  id: string;
  label?: string;
  order?: number;
  commandId?: string;
  parentId?: string;
  when?: string;
  icon?: string;
  type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
  role?: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "reload" |
         "forceReload" | "toggleDevTools" | "resetZoom" | "zoomIn" | "zoomOut" |
         "togglefullscreen" | "window" | "minimize" | "zoom" | "close" | "help" |
        "about" | "services" | "hide" | "hideOthers" | "unhide" | "quit";
  accelerator?: string;
  dynamicItems?: () => Promise<MenuItemContribution[]>;
  _generatedBy?: string;
  mimeType?: string;
};

export type MenuRegistry = {
  registerMenuItem: (contribution: MenuItemContribution) => void;
  rebuildMenu: () => Promise<void>;
  onRebuild: (fn: () => Promise<void>) => void;
};
