import type { OutlineSymbol, SymbolKind } from "../../../../contracts/extensions/OutlineExtension";

const DIRECTIVE_RE = /^(?:--|#|\/\/|\/\*)?\s*@outline-pattern:\s*\/([^/]+)\/([gimsuy]*)(?:\s+(\w+))?(?:\s+(.+))?$/;

const DEFAULT_SYMBOL_KIND: SymbolKind = "Namespace";

const VALID_SYMBOL_KINDS = new Set<string>([
  "File", "Module", "Namespace", "Package", "Class", "Method", "Property", "Field",
  "Constructor", "Enum", "Interface", "Function", "Variable", "Constant", "String",
  "Number", "Boolean", "Array", "Object", "Key", "Null", "EnumMember", "Struct",
  "Event", "Operator", "TypeParameter"
]);

export function customPatternProvider(content: string): OutlineSymbol[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const headerLines = lines.slice(0, 20);

  const directives: { regex: RegExp; kind: SymbolKind; detail?: string; patternIndex: number }[] = [];

  for (let i = 0; i < headerLines.length; i++) {
    const match = headerLines[i].match(DIRECTIVE_RE);
    if (!match) continue;

    const patternStr = match[1];
    const flags = match[2] || "g";
    const kindStr = match[3] || DEFAULT_SYMBOL_KIND;
    const detail = match[4];

    if (!VALID_SYMBOL_KINDS.has(kindStr)) continue;

    try {
      const regex = new RegExp(patternStr, flags.includes("g") ? flags : flags + "g");
      directives.push({
        regex,
        kind: kindStr as SymbolKind,
        detail,
        patternIndex: directives.length
      });
    } catch {
      // Invalid regex - skip silently
    }
  }

  if (directives.length === 0) {
    return [];
  }

  const symbols: OutlineSymbol[] = [];
  const directiveLines = new Set<number>();
  for (let i = 0; i < headerLines.length; i++) {
    if (headerLines[i].includes("@outline-pattern")) {
      directiveLines.add(i + 1);
    }
  }

  for (const directive of directives) {
    let match: RegExpExecArray | null;
    directive.regex.lastIndex = 0;
    while ((match = directive.regex.exec(normalized)) !== null) {
      const lineNum = normalized.substring(0, match.index).split("\n").length;
      if (directiveLines.has(lineNum)) {
        continue;
      }

      const name = match[1] ?? match[0];
      const nameInMatch = match[1] != null ? match[0].indexOf(match[1]) : 0;
      const nameLineNum = normalized.substring(0, match.index + nameInMatch).split("\n").length;
      const nameLine = lines[nameLineNum - 1] ?? "";
      const nameCol = nameLine.indexOf(name) + 1;

      symbols.push({
        id: `custom:${lineNum}:${directive.patternIndex}`,
        name,
        kind: directive.kind,
        detail: directive.detail,
        range: {
          startLineNumber: lineNum,
          startColumn: 1,
          endLineNumber: lineNum,
          endColumn: lines[lineNum - 1]?.length ?? 0
        },
        selectionRange: {
          startLineNumber: nameLineNum,
          startColumn: nameCol,
          endLineNumber: nameLineNum,
          endColumn: nameCol + name.length
        }
      });
    }
  }

  return symbols;
}
