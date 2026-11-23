import type { IBuffer } from "@xterm/xterm";

export type EditorLink = {
  /** 1-based buffer range, end inclusive (xterm ILink convention). May span wrapped rows. */
  range: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  text: string;
  uri: string;
};

type CellPosition = { x: number; y: number };

const DIRECT_URI_REGEX = /editor:\/\/[^\s)]+/g;
const LOCATION_LABEL_REGEX = /\[line\s+(\d+),\s*col\s+(\d+)\]/gi;

/**
 * Reads the logical line containing the given buffer row, joining rows that the terminal
 * soft-wrapped, and returns the text plus each character's 1-based buffer cell position.
 */
function readLogicalLine(buffer: IBuffer, bufferLineNumber: number): { text: string; positions: CellPosition[] } {
  let startIndex = bufferLineNumber - 1;
  while (startIndex > 0 && buffer.getLine(startIndex)?.isWrapped) {
    startIndex--;
  }

  let text = "";
  const positions: CellPosition[] = [];
  const cell = buffer.getNullCell();
  for (let rowIndex = startIndex; ; rowIndex++) {
    const line = buffer.getLine(rowIndex);
    if (!line || (rowIndex > startIndex && !line.isWrapped)) {
      break;
    }
    for (let column = 0; column < line.length; column++) {
      line.getCell(column, cell);
      if (cell.getWidth() === 0) {
        // Trailing half of a wide character
        continue;
      }
      const chars = cell.getChars() || " ";
      for (let i = 0; i < chars.length; i++) {
        positions.push({ x: column + 1, y: rowIndex + 1 });
      }
      text += chars;
    }
  }

  // Trailing blanks of the last row are padding, not content
  const trimmed = text.replace(/\s+$/, "");
  return { text: trimmed, positions: positions.slice(0, trimmed.length) };
}

/**
 * Finds `editor://` links and `[line N, col M]` location labels on the logical line containing the given
 * buffer row (1-based). Labels split over soft-wrapped rows are still found; their range spans those rows.
 */
export function findEditorLinks(buffer: IBuffer, bufferLineNumber: number): EditorLink[] {
  const { text, positions } = readLogicalLine(buffer, bufferLineNumber);
  const links: EditorLink[] = [];

  const push = (index: number, matched: string, uri: string): void => {
    const start = positions[index];
    const end = positions[index + matched.length - 1];
    if (!start || !end) {
      return;
    }
    links.push({ range: { start, end }, text: matched, uri });
  };

  for (const match of text.matchAll(DIRECT_URI_REGEX)) {
    push(match.index, match[0], match[0]);
  }

  for (const match of text.matchAll(LOCATION_LABEL_REGEX)) {
    const lineNumber = Number(match[1]);
    const columnNumber = Number(match[2]);
    if (!Number.isFinite(lineNumber) || lineNumber < 1 || !Number.isFinite(columnNumber) || columnNumber < 1) {
      continue;
    }
    push(match.index, match[0], `editor://open?line=${lineNumber}&column=${columnNumber}`);
  }

  // xterm asks per row; only offer links that touch the requested row
  return links.filter((link) => link.range.start.y <= bufferLineNumber && link.range.end.y >= bufferLineNumber);
}
