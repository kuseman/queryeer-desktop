import type { TextDocument, TextLine, TextRange } from "./types";
import { resolveMonacoLanguageId } from "./mime-types";

export function mimeToLanguage(mimeType: string): string {
  return resolveMonacoLanguageId(mimeType);
}

export class TextEditorModel {
  private readonly uri: string;
  private readonly mimeType: string;
  private content: string;
  private lineCache: TextLine[] = [];
  private version = 0;

  constructor(uri: string, mimeType: string, content: string) {
    this.uri = uri;
    this.mimeType = mimeType;
    this.content = content;
    this.rebuildLineCache();
  }

  getUri(): string {
    return this.uri;
  }

  getMimeType(): string {
    return this.mimeType;
  }

  getDocument(): TextDocument {
    return {
      uri: this.uri,
      languageId: mimeToLanguage(this.mimeType),
      getText: (range?: TextRange) => {
        if (!range) return this.content;
        const lines = this.content.split("\n");
        const startLine = range.startLineNumber - 1;
        const endLine = range.endLineNumber - 1;
        if (startLine === endLine) {
          return lines[startLine]?.slice(range.startColumn - 1, range.endColumn - 1) ?? "";
        }
        const startText = (lines[startLine]?.slice(range.startColumn - 1) ?? "") + "\n";
        const middleLines = lines.slice(startLine + 1, endLine).join("\n") + "\n";
        const endText = lines[endLine]?.slice(0, range.endColumn - 1) ?? "";
        return startText + middleLines + endText;
      },
      lineCount: this.lineCache.length,
      lineAt: (lineNumber: number) => this.lineCache[lineNumber - 1] ?? this.emptyLine(lineNumber)
    };
  }

  getContent(): string {
    return this.content;
  }

  setContent(content: string): void {
    if (this.content === content) {
      return;
    }
    this.content = content;
    this.version++;
    this.rebuildLineCache();
  }

  getVersion(): number {
    return this.version;
  }

  private rebuildLineCache(): void {
    const lines = this.content.split("\n");
    this.lineCache = lines.map((text, index) => ({
      lineNumber: index + 1,
      text,
      range: {
        startLineNumber: index + 1,
        startColumn: 1,
        endLineNumber: index + 1,
        endColumn: text.length + 1
      }
    }));
  }

  private emptyLine(lineNumber: number): TextLine {
    return {
      lineNumber,
      text: "",
      range: {
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: 1
      }
    };
  }

  dispose(): void {
    this.content = "";
    this.lineCache = [];
  }
}
