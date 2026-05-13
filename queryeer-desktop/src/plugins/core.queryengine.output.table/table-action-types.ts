export type TableActionMode = "execute" | "render";
export type TableActionOutputTarget = "output" | "clipboard" | "newFile";

export type TableAction = {
  id: string;
  label: string;
  when: string;
  query: string;
  mode: TableActionMode;
  outputTarget: TableActionOutputTarget;
  order?: number;
};

export type TableActionData = {
  rows: Record<string, unknown>[];
  columns: { name: string; type: string }[];
  primaryRowIndex: number;
  selectedRowIndexes: number[];
  selectedColumnIndexes: number[];
};

export const TABLE_ACTIONS_SETTING_ID = "core.queryengine.output.table.tableActions";
