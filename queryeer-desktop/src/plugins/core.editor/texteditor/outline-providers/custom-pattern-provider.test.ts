import { describe, it, expect } from "vitest";
import { customPatternProvider } from "./custom-pattern-provider";

describe("customPatternProvider", () => {
  it("returns symbols for single @outline-pattern directive", () => {
    const content = `// @outline-pattern: /\\bfunction\\s+(\\w+)/g  Function  exported function

function foo() {}
function bar() {}`;
    const symbols = customPatternProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("bar");
    expect(symbols[0].kind).toBe("Function");
    expect(symbols[0].detail).toBe("exported function");
  });

  it("returns symbols for multiple directives", () => {
    const content = `// @outline-pattern: /function\\s+(\\w+)/g  Function
// @outline-pattern: /class\\s+(\\w+)/g  Class

function foo() {}
class Baz {}`;
    const symbols = customPatternProvider(content);
    expect(symbols.length).toBe(2);
    const funcSymbols = symbols.filter((s) => s.kind === "Function");
    const classSymbols = symbols.filter((s) => s.kind === "Class");
    expect(funcSymbols.length).toBe(1);
    expect(classSymbols.length).toBe(1);
  });

  it("uses first capture group as name when available", () => {
    const content = `// @outline-pattern: /function\\s+(\\w+)/g  Function

function foo() {}`;
    const symbols = customPatternProvider(content);
    expect(symbols[0].name).toBe("foo");
  });

  it("uses full match as name when no capture group", () => {
    const content = `// @outline-pattern: /SECTION:\\s*(.+)/g  Namespace

// SECTION: User queries`;
    const symbols = customPatternProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toContain("User queries");
  });

  it("respects regex flags (case-insensitive, global)", () => {
    const content = `// @outline-pattern: /FUNCTION\\s+(\\w+)/gi  Function

function foo() {}
FUNCTION bar() {}`;
    const symbols = customPatternProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("bar");
  });

  it("skips invalid regex patterns silently", () => {
    const content = `// @outline-pattern: /[invalid/g  Function

function foo() {}`;
    const symbols = customPatternProvider(content);
    expect(symbols.length).toBe(0);
  });

  it("skips unknown SymbolKind values silently", () => {
    const content = `// @outline-pattern: /function\\s+(\\w+)/g  UnknownKind

function foo() {}`;
    const symbols = customPatternProvider(content);
    expect(symbols.length).toBe(0);
  });

  it("returns empty array when no directives in first 20 lines", () => {
    const content = `function foo() {}
function bar() {}`;
    const symbols = customPatternProvider(content);
    expect(symbols).toEqual([]);
  });

  it("ignores directives after line 20", () => {
    const lines = Array.from({ length: 20 }, () => "// padding");
    lines.push("// @outline-pattern: /function\\s+(\\w+)/g  Function");
    lines.push("function foo() {}");
    const content = lines.join("\n");
    const symbols = customPatternProvider(content);
    expect(symbols.length).toBe(0);
  });

  it("handles comment-style directives (//, #, --, <!--)", () => {
    const jsContent = `// @outline-pattern: /function\\s+(\\w+)/g  Function
function foo() {}`;
    expect(customPatternProvider(jsContent).length).toBe(1);

    const pyContent = `# @outline-pattern: /def\\s+(\\w+)/g  Function
def foo(): pass`;
    expect(customPatternProvider(pyContent).length).toBe(1);

    const sqlContent = `-- @outline-pattern: /SELECT/g  Method
SELECT * FROM users`;
    expect(customPatternProvider(sqlContent).length).toBe(1);
  });

  it("matches section headers with default kind when kind omitted", () => {
    const content = `-- @outline-pattern: /--##\\s+(.+)/g

--## Skus
some code`;
    const symbols = customPatternProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("Skus");
    expect(symbols[0].kind).toBe("Namespace");
  });

  describe("line ending handling", () => {
    it("handles Windows line endings (CRLF)", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\r\n\r\n--## Skus\r\nsome code\r\n";
      const symbols = customPatternProvider(content);
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe("Skus");
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
    });

    it("handles Unix line endings (LF)", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\n\n--## Skus\nsome code\n";
      const symbols = customPatternProvider(content);
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe("Skus");
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
    });

    it("handles old Mac line endings (CR)", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\r\r--## Skus\rsome code\r";
      const symbols = customPatternProvider(content);
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe("Skus");
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
    });

    it("handles mixed line endings", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\r\n\r\n--## SectionA\nsome code\r--## SectionB\n";
      const symbols = customPatternProvider(content);
      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe("SectionA");
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
      expect(symbols[1].name).toBe("SectionB");
      expect(symbols[1].selectionRange.startLineNumber).toBe(5);
    });

    it("produces accurate selection ranges with CRLF", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\r\n\r\n--## Skus\r\n";
      const symbols = customPatternProvider(content);
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
      expect(symbols[0].selectionRange.startColumn).toBe(6);
      expect(symbols[0].selectionRange.endColumn).toBe(10);
      expect(symbols[0].name).toBe("Skus");
    });

    it("produces accurate selection ranges with LF", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\n\n--## Skus\n";
      const symbols = customPatternProvider(content);
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
      expect(symbols[0].selectionRange.startColumn).toBe(6);
      expect(symbols[0].selectionRange.endColumn).toBe(10);
      expect(symbols[0].name).toBe("Skus");
    });

    it("produces accurate selection ranges with CR", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\r\r--## Skus\r";
      const symbols = customPatternProvider(content);
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
      expect(symbols[0].selectionRange.startColumn).toBe(6);
      expect(symbols[0].selectionRange.endColumn).toBe(10);
      expect(symbols[0].name).toBe("Skus");
    });

    it("handles multiple custom pattern matches with CRLF", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\r\n\r\n--## First\r\n--## Second\r\n--## Third\r\n";
      const symbols = customPatternProvider(content);
      expect(symbols.length).toBe(3);
      expect(symbols[0].name).toBe("First");
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
      expect(symbols[1].name).toBe("Second");
      expect(symbols[1].selectionRange.startLineNumber).toBe(4);
      expect(symbols[2].name).toBe("Third");
      expect(symbols[2].selectionRange.startLineNumber).toBe(5);
    });

    it("handles multiple custom pattern matches with LF", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\n\n--## First\n--## Second\n--## Third\n";
      const symbols = customPatternProvider(content);
      expect(symbols.length).toBe(3);
      expect(symbols[0].name).toBe("First");
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
      expect(symbols[1].name).toBe("Second");
      expect(symbols[1].selectionRange.startLineNumber).toBe(4);
      expect(symbols[2].name).toBe("Third");
      expect(symbols[2].selectionRange.startLineNumber).toBe(5);
    });

    it("navigates to pattern line, not subsequent statements", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\n\n--## Skus\nselect * from users;\n";
      const symbols = customPatternProvider(content);
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe("Skus");
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
      expect(symbols[0].selectionRange.startColumn).toBe(6);
      expect(symbols[0].range.startLineNumber).toBe(3);
      expect(symbols[0].range.endLineNumber).toBe(3);
    });

    it("handles pattern immediately followed by statement on same line", () => {
      const content = "-- @outline-pattern: /--##\\s+(.+)/g\n--## Skus select * from users;\n";
      const symbols = customPatternProvider(content);
      expect(symbols.length).toBe(1);
      expect(symbols[0].selectionRange.startLineNumber).toBe(2);
      expect(symbols[0].selectionRange.startColumn).toBe(6);
    });
  });
});
