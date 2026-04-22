export type MenuItemContribution = {
  id: string;
  label: string;
  order?: number;
  commandId?: string;
  parentId?: string;
  icon?: string;
};

export type MenuRegistry = {
  registerMenuItem: (contribution: MenuItemContribution) => void;
};
