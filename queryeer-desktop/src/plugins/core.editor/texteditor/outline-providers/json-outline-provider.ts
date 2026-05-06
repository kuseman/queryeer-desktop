import type { OutlineSymbol, SymbolKind } from "../../../../contracts/extensions/OutlineExtension";

function offsetToPosition(content: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function findKeyOffset(content: string, key: string, fromOffset: number): number {
  const searchStr = `"${key}"`;
  const idx = content.indexOf(searchStr, fromOffset);
  return idx >= 0 ? idx : fromOffset;
}

function walkJsonValue(
  value: unknown,
  content: string,
  path: string[],
  keyOffset: number,
  valueEndOffset: number
): OutlineSymbol[] {
  if (value === null || value === undefined) {
    const start = offsetToPosition(content, keyOffset);
    const end = offsetToPosition(content, valueEndOffset);
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
    const start = offsetToPosition(content, keyOffset);
    const end = offsetToPosition(content, valueEndOffset);
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
    const start = offsetToPosition(content, keyOffset);
    const end = offsetToPosition(content, valueEndOffset);
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
    const start = offsetToPosition(content, keyOffset);
    const end = offsetToPosition(content, valueEndOffset);
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
    const start = offsetToPosition(content, keyOffset);
    const end = offsetToPosition(content, valueEndOffset);
    const name = path[path.length - 1] ?? "Array";
    const children: OutlineSymbol[] = [];
    let scanOffset = keyOffset;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const itemPath = [...path, String(i)];
      const itemKeyOffset = findKeyOffset(content, String(i), scanOffset);
      const itemSymbols = walkJsonValue(item, content, itemPath, itemKeyOffset, valueEndOffset);
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
        const childSymbols = walkJsonValue(val, content, keyPath, keyOffset, valueEndOffset);
        results.push(...childSymbols);
        scanOffset = keyEndOffset;
      }
      return results;
    }

    const start = offsetToPosition(content, keyOffset);
    const end = offsetToPosition(content, valueEndOffset);
    const name = path[path.length - 1] ?? "Object";
    const children: OutlineSymbol[] = [];
    let scanOffset = keyOffset;
    for (const [key, val] of entries) {
      const keyPath = [...path, key];
      const itemKeyOffset = findKeyOffset(content, key, scanOffset);
      const childSymbols = walkJsonValue(val, content, keyPath, itemKeyOffset, valueEndOffset);
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

  try {
    const parsed = JSON.parse(content);
    return walkJsonValue(parsed, content, [], 0, content.length);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lineMatch = message.match(/position\s+(\d+)/i);
    let line = 0;
    let column = 0;
    if (lineMatch) {
      const pos = parseInt(lineMatch[1], 10);
      const position = offsetToPosition(content, pos);
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
