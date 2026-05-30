import type { OutlineSymbol, SymbolKind } from "@queryeer/api/extensions/OutlineExtension";

function buildLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function offsetToPosition(
  lineOffsets: number[],
  offset: number
): { line: number; column: number } {
  let lo = 0, hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineOffsets[lo] + 1 };
}

function findKeyOffset(content: string, key: string, fromOffset: number): number {
  const searchStr = `"${key}"`;
  const idx = content.indexOf(searchStr, fromOffset);
  return idx >= 0 ? idx : fromOffset;
}

function walkJsonValue(
  value: unknown,
  content: string,
  lineOffsets: number[],
  path: string[],
  keyOffset: number,
  valueEndOffset: number
): OutlineSymbol[] {
  if (value === null || value === undefined) {
    const start = offsetToPosition(lineOffsets, keyOffset);
    const end = offsetToPosition(lineOffsets, valueEndOffset);
    const name = path[path.length - 1] ?? "null";
    return [{
      id: `json:${path.join(".")}:${start.line}`,
      name,
      kind: "Null",
      range: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: end.line,
        endColumn: end.column
      },
      selectionRange: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: start.line,
        endColumn: start.column + name.length
      }
    }];
  }

  if (typeof value === "string") {
    const start = offsetToPosition(lineOffsets, keyOffset);
    const end = offsetToPosition(lineOffsets, valueEndOffset);
    const name = path[path.length - 1] ?? value;
    return [{
      id: `json:${path.join(".")}:${start.line}`,
      name,
      kind: path[path.length - 1] != null ? "Key" : "String",
      detail: path[path.length - 1] != null ? undefined : value,
      range: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: end.line,
        endColumn: end.column
      },
      selectionRange: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: start.line,
        endColumn: start.column + name.length
      }
    }];
  }

  if (typeof value === "number") {
    const start = offsetToPosition(lineOffsets, keyOffset);
    const end = offsetToPosition(lineOffsets, valueEndOffset);
    const name = path[path.length - 1] ?? String(value);
    return [{
      id: `json:${path.join(".")}:${start.line}`,
      name,
      kind: path[path.length - 1] != null ? "Key" : "Number",
      detail: path[path.length - 1] != null ? undefined : String(value),
      range: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: end.line,
        endColumn: end.column
      },
      selectionRange: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: start.line,
        endColumn: start.column + name.length
      }
    }];
  }

  if (typeof value === "boolean") {
    const start = offsetToPosition(lineOffsets, keyOffset);
    const end = offsetToPosition(lineOffsets, valueEndOffset);
    const name = path[path.length - 1] ?? String(value);
    return [{
      id: `json:${path.join(".")}:${start.line}`,
      name,
      kind: path[path.length - 1] != null ? "Key" : "Boolean",
      detail: path[path.length - 1] != null ? undefined : String(value),
      range: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: end.line,
        endColumn: end.column
      },
      selectionRange: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: start.line,
        endColumn: start.column + name.length
      }
    }];
  }

  if (Array.isArray(value)) {
    const start = offsetToPosition(lineOffsets, keyOffset);
    const end = offsetToPosition(lineOffsets, valueEndOffset);
    const name = path[path.length - 1] ?? "Array";
    const children: OutlineSymbol[] = [];
    let scanOffset = keyOffset;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const itemPath = [...path, String(i)];
      const itemKeyOffset = findKeyOffset(content, String(i), scanOffset);
      const itemSymbols = walkJsonValue(item, content, lineOffsets, itemPath, itemKeyOffset, valueEndOffset);
      children.push(...itemSymbols);
      if (itemSymbols.length > 0) {
        scanOffset = itemKeyOffset;
      }
    }
    return [{
      id: `json:${path.join(".")}:${start.line}`,
      name,
      kind: path[path.length - 1] != null ? "Key" : "Array",
      children: children.length > 0 ? children : undefined,
      range: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: end.line,
        endColumn: end.column
      },
      selectionRange: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: start.line,
        endColumn: start.column + name.length
      }
    }];
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (path.length === 0) {
      const results: OutlineSymbol[] = [];
      let scanOffset = 0;
      for (const [key, val] of entries) {
        const keyPath = [key];
        const keyOffset = findKeyOffset(content, key, scanOffset);
        const keyEndStr = `"${key}"`;
        const keyEndOffset = keyOffset + keyEndStr.length;
        const childSymbols = walkJsonValue(val, content, lineOffsets, keyPath, keyOffset, valueEndOffset);
        results.push(...childSymbols);
        scanOffset = keyEndOffset;
      }
      return results;
    }

    const start = offsetToPosition(lineOffsets, keyOffset);
    const end = offsetToPosition(lineOffsets, valueEndOffset);
    const name = path[path.length - 1] ?? "Object";
    const children: OutlineSymbol[] = [];
    let scanOffset = keyOffset;
    for (const [key, val] of entries) {
      const keyPath = [...path, key];
      const itemKeyOffset = findKeyOffset(content, key, scanOffset);
      const childSymbols = walkJsonValue(val, content, lineOffsets, keyPath, itemKeyOffset, valueEndOffset);
      children.push(...childSymbols);
      if (childSymbols.length > 0) {
        scanOffset = itemKeyOffset;
      }
    }
    return [{
      id: `json:${path.join(".")}:${start.line}`,
      name,
      kind: path[path.length - 1] != null ? "Key" : "Object",
      children: children.length > 0 ? children : undefined,
      range: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: end.line,
        endColumn: end.column
      },
      selectionRange: {
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: start.line,
        endColumn: start.column + name.length
      }
    }];
  }

  return [];
}

export function jsonOutlineProvider(content: string): OutlineSymbol[] {
  if (!content.trim()) {
    return [];
  }

  const lineOffsets = buildLineOffsets(content);

  try {
    const parsed = JSON.parse(content);
    return walkJsonValue(parsed, content, lineOffsets, [], 0, content.length);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lineMatch = message.match(/position\s+(\d+)/i);
    let line = 0;
    let column = 0;
    if (lineMatch) {
      const pos = parseInt(lineMatch[1], 10);
      const position = offsetToPosition(lineOffsets, pos);
      line = position.line;
      column = position.column;
    }
    return [{
      id: `json:error:${line}`,
      name: "Parse Error",
      detail: message,
      kind: "Event" as SymbolKind,
      range: {
        startLineNumber: line,
        startColumn: column,
        endLineNumber: line,
        endColumn: column
      },
      selectionRange: {
        startLineNumber: line,
        startColumn: column,
        endLineNumber: line,
        endColumn: column
      }
    }];
  }
}
