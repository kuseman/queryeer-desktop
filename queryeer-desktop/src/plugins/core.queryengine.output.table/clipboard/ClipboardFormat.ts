import type { Column } from "../../../contracts/queryengine/OutputExtension";

export type ClipboardCell = {
  value: unknown;
  /** False when this position is in the bounding box but not in the selection — output as empty string. */
  selected: boolean;
};

export type ClipboardSelection = {
  /** 2D grid aligned to the bounding box: grid[rowOffset][colOffset]. */
  grid: ClipboardCell[][];
  columns: Column[];
};

export type ClipboardFormat = {
  id: string;
  label: string;
  mimeType: string;
  /** Return null to exclude this format from the ClipboardItem (e.g. when the selection doesn't meet a minimum column count). */
  format: (selection: ClipboardSelection) => string | null;
};
