import type { OutlineSymbol, SymbolKind } from "../../../../contracts/extensions/OutlineExtension";

type SqlStatement = {
  kind: SymbolKind;
  name: string;
  detail: string;
  startLine: number;
  endLine: number;
  keyword: string;
  startColumn: number;
};

const STATEMENT_PATTERNS: { re: RegExp; kind: SymbolKind; detail: string; nameGroup: number }[] = [
  { re: /CREATE\s+TABLE\s+(\w+)/i, kind: "Class", detail: "TABLE", nameGroup: 1 },
  { re: /CREATE\s+VIEW\s+(\w+)/i, kind: "Interface", detail: "VIEW", nameGroup: 1 },
  { re: /CREATE\s+INDEX\s+(\w+)/i, kind: "Property", detail: "INDEX", nameGroup: 1 },
  { re: /CREATE\s+FUNCTION\s+(\w+)/i, kind: "Function", detail: "FUNCTION", nameGroup: 1 },
  { re: /CREATE\s+PROCEDURE\s+(\w+)/i, kind: "Function", detail: "PROCEDURE", nameGroup: 1 },
  { re: /CREATE\s+TRIGGER\s+(\w+)/i, kind: "Event", detail: "TRIGGER", nameGroup: 1 },
  { re: /\bSELECT\b/i, kind: "Method", detail: "", nameGroup: 0 },
  { re: /INSERT\s+INTO\s+(\w+)/i, kind: "Method", detail: "", nameGroup: 1 },
  { re: /\bUPDATE\s+(\w+)/i, kind: "Method", detail: "", nameGroup: 1 },
  { re: /DELETE\s+FROM\s+(\w+)/i, kind: "Method", detail: "", nameGroup: 1 },
  { re: /WITH\s+(\w+)\s+AS/i, kind: "Namespace", detail: "CTE", nameGroup: 1 }
];

export function sqlOutlineProvider(content: string): OutlineSymbol[] {
  if (!content.trim()) {
    return [];
  }

  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const statements: SqlStatement[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNum = lineIndex + 1;

    for (const pattern of STATEMENT_PATTERNS) {
      const match = line.match(pattern.re);
      if (match) {
        const name = pattern.nameGroup > 0
          ? match[pattern.nameGroup]
          : match[0].trim().split(/\s+/)[0];
        const keywordIndex = line.indexOf(match[0].trim().split(/\s+/)[0]);
        statements.push({
          kind: pattern.kind,
          name,
          detail: pattern.detail,
          startLine: lineNum,
          endLine: lineNum,
          keyword: match[0].trim().split(/\s+/)[0].toUpperCase(),
          startColumn: keywordIndex + 1
        });
        break;
      }
    }
  }

  if (statements.length === 0) {
    return [];
  }

  const symbols: OutlineSymbol[] = [];
  const cteStack: { symbol: OutlineSymbol; startLine: number }[] = [];

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const nextStmtStart = i + 1 < statements.length ? statements[i + 1].startLine : lines.length + 1;

    const symbol: OutlineSymbol = {
      id: `sql:${stmt.startLine}:${stmt.keyword}`,
      name: stmt.name,
      kind: stmt.kind,
      detail: stmt.detail || undefined,
      range: {
        startLineNumber: stmt.startLine,
        startColumn: stmt.startColumn,
        endLineNumber: Math.min(stmt.endLine, nextStmtStart - 1),
        endColumn: lines[Math.min(stmt.endLine, nextStmtStart - 1) - 1]?.length ?? 0
      },
      selectionRange: {
        startLineNumber: stmt.startLine,
        startColumn: stmt.startColumn,
        endLineNumber: stmt.startLine,
        endColumn: stmt.startColumn + stmt.name.length
      }
    };

    if (stmt.kind === "Namespace") {
      symbol.children = [];
      cteStack.push({ symbol, startLine: stmt.startLine });
    } else if (cteStack.length > 0) {
      const parent = cteStack[cteStack.length - 1];
      if (!parent.symbol.children) {
        parent.symbol.children = [];
      }
      parent.symbol.children.push(symbol);
    }

    symbols.push(symbol);
  }

  return symbols.filter((s) => s.kind !== "Namespace" || (s.children && s.children.length > 0) || true);
}
