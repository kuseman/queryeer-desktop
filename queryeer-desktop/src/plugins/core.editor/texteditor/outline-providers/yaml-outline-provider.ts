import type { OutlineSymbol, SymbolKind } from "../../../../contracts/extensions/OutlineExtension";

const MAPPING_KEY_RE = /^(\s*)([\w][\w -]*)\s*:(?:\s|$)/;
const SEQUENCE_ITEM_RE = /^(\s*)- /;
const DOCUMENT_MARKER_RE = /^---/;
const DOCUMENT_END_RE = /^\.\.\./;
const COMMENT_RE = /^\s*#/;

export function yamlOutlineProvider(content: string): OutlineSymbol[] {
  if (!content.trim()) {
    return [];
  }

  const lines = content.split("\n");
  const rootSymbols: OutlineSymbol[] = [];
  const stack: { indent: number; children: OutlineSymbol[] }[] = [];
  let indentSize: number | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNum = lineIndex + 1;

    if (COMMENT_RE.test(line) || line.trim() === "") {
      continue;
    }

    if (DOCUMENT_MARKER_RE.test(line) || DOCUMENT_END_RE.test(line)) {
      const symbol: OutlineSymbol = {
        id: `yaml:0:${lineNum}:---`,
        name: "---",
        kind: "Module" as SymbolKind,
        range: {
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: line.length + 1
        },
        selectionRange: {
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: 4
        }
      };
      rootSymbols.push(symbol);
      continue;
    }

    const seqMatch = line.match(SEQUENCE_ITEM_RE);
    if (seqMatch) {
      const rawIndent = seqMatch[1].length;
      if (indentSize === null && rawIndent > 0) {
        indentSize = rawIndent;
      }
      const indent = indentSize != null && indentSize > 0 ? Math.floor(rawIndent / indentSize) : 0;

      while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
        stack.pop();
      }

      const symbol: OutlineSymbol = {
        id: `yaml:${indent}:${lineNum}:item`,
        name: "item",
        kind: "Array" as SymbolKind,
        range: {
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: line.length + 1
        },
        selectionRange: {
          startLineNumber: lineNum,
          startColumn: rawIndent + 3,
          endLineNumber: lineNum,
          endColumn: rawIndent + 3 + 4
        }
      };

      const target = stack.length > 0 ? stack[stack.length - 1].children : rootSymbols;
      target.push(symbol);
      stack.push({ indent: indent + 1, children: [] });
      continue;
    }

    const keyMatch = line.match(MAPPING_KEY_RE);
    if (keyMatch) {
      const rawIndent = keyMatch[1].length;
      if (indentSize === null && rawIndent > 0) {
        indentSize = rawIndent;
      }
      const indent = indentSize != null && indentSize > 0 ? Math.floor(rawIndent / indentSize) : 0;
      const key = keyMatch[2];

      while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
        stack.pop();
      }

      const symbol: OutlineSymbol = {
        id: `yaml:${indent}:${lineNum}:${key}`,
        name: key,
        kind: "Key" as SymbolKind,
        children: [],
        range: {
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: line.length + 1
        },
        selectionRange: {
          startLineNumber: lineNum,
          startColumn: rawIndent + 1,
          endLineNumber: lineNum,
          endColumn: rawIndent + 1 + key.length
        }
      };

      const target = stack.length > 0 ? stack[stack.length - 1].children : rootSymbols;
      target.push(symbol);
      stack.push({ indent: indent + 1, children: symbol.children! });
      continue;
    }
  }

  for (const item of rootSymbols) {
    if (item.children && item.children.length === 0) {
      delete item.children;
    }
  }

  return rootSymbols;
}
