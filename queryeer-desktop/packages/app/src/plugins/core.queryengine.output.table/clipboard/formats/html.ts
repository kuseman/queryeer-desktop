import type { ClipboardFormat } from "../ClipboardFormat";
import { cellValueToString } from "../../large-value-cell";

function esc(value: unknown): string {
  return cellValueToString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const htmlFormat: ClipboardFormat = {
  id: "html",
  label: "HTML table",
  mimeType: "text/html",
  format: ({ grid, columns }) => {
    const selectedCellCount = grid.reduce((count, row) => count + row.filter((cell) => cell.selected).length, 0);
    if (selectedCellCount <= 1) return null;

    const header = `<tr>${columns.map((c) => `<td><strong>${esc(c.name)}</strong></td>`).join("")}</tr>`;

    const body = grid
      .filter((row) => row.some((cell) => cell.selected))
      .map((row) => `<tr>${row.map((cell) => `<td>${cell.selected ? esc(cell.value) : ""}</td>`).join("")}</tr>`)
      .join("");

    return `<table><tbody>${header}${body}</tbody></table>`;
  },
};
