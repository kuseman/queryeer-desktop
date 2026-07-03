import type { ClipboardFormat } from "../ClipboardFormat";
import { cellValueToString } from "../../large-value-cell";

export const plainFormat: ClipboardFormat = {
  id: "plain",
  label: "Plain text (TSV)",
  mimeType: "text/plain",
  format: ({ grid }) =>
    grid
      .filter((row) => row.some((cell) => cell.selected))
      .map((row) => row.map((cell) => (cell.selected ? cellValueToString(cell.value) : "")).join("\t"))
      .join("\n"),
};
