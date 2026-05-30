import type { OutlineSymbol, SymbolKind } from "@queryeer/api/extensions/OutlineExtension";

const OPEN_TAG_RE = /<([a-zA-Z_][\w-:.]*)(\s[^>]*)?>/;
const CLOSE_TAG_RE = /<\/([a-zA-Z_][\w-:.]*)\s*>/;
const SELF_CLOSING_RE = /<([a-zA-Z_][\w-:.]*)(\s[^/]*)?\/>/;
const COMMENT_RE = /<!--[\s\S]*?-->/;
const PI_RE = /<\?[\s\S]*?\?>/;

type TagStackEntry = {
  tagname: string;
  depth: number;
  startLine: number;
  attributes: string;
  children: OutlineSymbol[];
};

export function xmlOutlineProvider(content: string): OutlineSymbol[] {
  if (!content.trim()) {
    return [];
  }

  const lines = content.split("\n");
  const stack: TagStackEntry[] = [];
  const rootChildren: OutlineSymbol[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNum = lineIndex + 1;

    const commentMatch = line.match(COMMENT_RE);
    if (commentMatch) {
      continue;
    }

    const piMatch = line.match(PI_RE);
    if (piMatch) {
      continue;
    }

    const selfCloseMatch = line.match(SELF_CLOSING_RE);
    if (selfCloseMatch) {
      const tagname = selfCloseMatch[1];
      const attrs = (selfCloseMatch[2] ?? "").trim();
      const depth = stack.length;
      const symbol: OutlineSymbol = {
        id: `xml:${depth}:${lineNum}:${tagname}`,
        name: tagname,
        kind: "Class" as SymbolKind,
        detail: attrs || undefined,
        range: {
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: line.length + 1
        },
        selectionRange: {
          startLineNumber: lineNum,
          startColumn: line.indexOf("<") + 2,
          endLineNumber: lineNum,
          endColumn: line.indexOf("<") + 2 + tagname.length
        }
      };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(symbol);
      } else {
        rootChildren.push(symbol);
      }
      continue;
    }

    const openMatch = line.match(OPEN_TAG_RE);
    if (openMatch) {
      const tagname = openMatch[1];
      const attrs = (openMatch[2] ?? "").trim();
      stack.push({
        tagname,
        depth: stack.length,
        startLine: lineNum,
        attributes: attrs,
        children: []
      });
      continue;
    }

    const closeMatch = line.match(CLOSE_TAG_RE);
    if (closeMatch) {
      const tagname = closeMatch[1];
      if (stack.length > 0) {
        const entry = stack[stack.length - 1];
        if (entry.tagname === tagname) {
          const popped = stack.pop()!;
          const symbol: OutlineSymbol = {
            id: `xml:${popped.depth}:${popped.startLine}:${popped.tagname}`,
            name: popped.tagname,
            kind: "Class" as SymbolKind,
            detail: popped.attributes || undefined,
            children: popped.children.length > 0 ? popped.children : undefined,
            range: {
              startLineNumber: popped.startLine,
              startColumn: 1,
              endLineNumber: lineNum,
              endColumn: line.length + 1
            },
            selectionRange: {
              startLineNumber: popped.startLine,
              startColumn: 1,
              endLineNumber: popped.startLine,
              endColumn: 1 + popped.tagname.length
            }
          };
          if (stack.length > 0) {
            stack[stack.length - 1].children.push(symbol);
          } else {
            rootChildren.push(symbol);
          }
        }
      }
      continue;
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return [{
      id: `xml:error:${unclosed.startLine}`,
      name: "Parse Error",
      detail: `Unclosed tag <${unclosed.tagname}> at line ${unclosed.startLine}`,
      kind: "Event" as SymbolKind,
      range: {
        startLineNumber: unclosed.startLine,
        startColumn: 1,
        endLineNumber: unclosed.startLine,
        endColumn: 1
      },
      selectionRange: {
        startLineNumber: unclosed.startLine,
        startColumn: 1,
        endLineNumber: unclosed.startLine,
        endColumn: 1
      }
    }];
  }

  return rootChildren;
}
