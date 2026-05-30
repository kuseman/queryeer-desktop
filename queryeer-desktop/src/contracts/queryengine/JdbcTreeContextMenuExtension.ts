export type JdbcTreeContextMenuContribution<TNode = unknown> = {
  id: string;
  label: string;
  order: number;
  matches(node: TNode): boolean;
  run(node: TNode): void | Promise<void>;
  section?: string;
};

export type JdbcTreeContextMenuRegistry<TNode = unknown> = {
  registerContribution(contribution: JdbcTreeContextMenuContribution<TNode>): void;
  unregisterContribution(id: string): void;
  getItemsForNode(node: TNode): Array<{
    id: string;
    label: string;
    disabled?: boolean;
    section?: string;
    onSelect: () => void | Promise<void>;
  }>;
};
