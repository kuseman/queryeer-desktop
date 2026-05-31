import type { Plugin } from "@queryeer/api/plugin/Plugin";
import type { TableOutputContextMenuProvider } from "@queryeer/api/queryengine/TableOutputContextMenuExtension";

function escapeCsv(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const csvExporterPlugin: Plugin = {
  manifest: {
    id: "example.csv-exporter",
    name: "CSV Exporter",
    version: "0.1.0",
    kind: "feature",
    description: "Export query result tables as CSV via the table output context menu"
  },
  activate: (context) => {
    const provider: TableOutputContextMenuProvider = {
      id: "example.csv-exporter.export",
      getItems: async (ctx) => {
        return [
          {
            id: "example.csv-exporter.export.csv",
            label: "Export as CSV",
            order: 10,
            run: () => {
              const headers = ctx.columns.map((c) => c.name);
              const rows = ctx.selection.selectedRowIndexes.map((rowIdx) => {
                const row = ctx.cellValuesByRow?.[rowIdx];
                if (!row) {
                  return headers.map(() => "");
                }
                return headers.map((_, colIdx) => row[colIdx]);
              });
              const csv = [
                headers.map(escapeCsv).join(","),
                ...rows.map((row) => row.map(escapeCsv).join(","))
              ].join("\n");
              void navigator.clipboard.writeText(csv).then(() => {
                context.notifications.notify({
                  title: "CSV Exporter",
                  message: `Copied ${rows.length} rows to clipboard`,
                  severity: "success"
                });
              });
            }
          }
        ];
      }
    };

    context.tableOutputContextMenu.registerProvider(provider);
  }
};
