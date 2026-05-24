import { describe, expect, it } from "vitest";
import {
  getQflowCompletionsAtPosition,
  getQflowCompletionsForContext,
  resolveQflowCompletionContext
} from "./qflow-completion";
import { parseQflowDocument } from "./qflow-parser";

function buildDocument() {
  const source = [
    "%%queryeer-flow",
    "id: first",
    "type: jdbc.query",
    "runIf: ctx.first.output.rowsAffected > 0",
    "%%",
    "select * from src",
    "",
    "%%queryeer-flow",
    "id: second",
    "type: payloadbuilder.query",
    "%%",
    "echo \"ok\""
  ].join("\n");

  return {
    document: parseQflowDocument(source),
    lines: source.split("\n")
  };
}

describe("qflow completion", () => {
  it("resolves runIf context and only exposes preceding ctx nodes", () => {
    const { document, lines } = buildDocument();
    const lineContent = lines[3] ?? "";

    const context = resolveQflowCompletionContext(document, 4, lineContent.length + 1, lineContent);
    expect(context.kind).toBe("runIf");

    const completions = getQflowCompletionsForContext(document, context);
    const labels = completions.map((item) => item.label);

    expect(labels).toContain("ctx");
    expect(labels).not.toContain("ctx.first");
    expect(labels).not.toContain("ctx.second");
    expect(labels).toContain("date.add");
  });

  it("includes preceding nodes in later runIf and excludes current node", () => {
    const source = [
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: second",
      "type: payloadbuilder.query",
      "runIf: ctx.",
      "%%",
      "select 2"
    ].join("\n");
    const document = parseQflowDocument(source);
    const lineContent = "runIf: ctx.";

    const completions = getQflowCompletionsAtPosition(
      document,
      10,
      lineContent.length + 1,
      lineContent
    );
    const labels = completions.map((item) => item.label);

    expect(labels).toContain("first");
    expect(labels).not.toContain("second");
  });

  it("returns metadata key completions when cursor is in key area", () => {
    const { document, lines } = buildDocument();
    const lineContent = lines[1] ?? "";

    const completions = getQflowCompletionsAtPosition(document, 2, 2, lineContent);
    const labels = completions.map((item) => item.label);

    expect(labels).toContain("id");
    expect(labels).toContain("type");
    expect(labels).toContain("description");
    expect(labels).toContain("runIf");
    expect(labels).not.toContain("queryEngine");
  });

  it("returns type value completions when cursor is in type value", () => {
    const { document, lines } = buildDocument();
    const lineContent = lines[2] ?? "";

    const completions = getQflowCompletionsAtPosition(document, 3, lineContent.length + 1, lineContent);
    expect(completions.map((item) => item.label)).toEqual(["jdbc.query", "payloadbuilder.query"]);
  });

  it("routes action completions by node type", () => {
    const source = [
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select * from src",
      "",
      "%%queryeer-flow",
      "id: second",
      "type: script",
      "%%",
      "echo \"ok\""
    ].join("\n");
    const document = parseQflowDocument(source);
    const lines = source.split("\n");
    const queryActionLine = lines[5] ?? "";
    const scriptActionLine = lines[10] ?? "";

    const queryCompletions = getQflowCompletionsAtPosition(document, 5, queryActionLine.length + 1, queryActionLine);
    expect(queryCompletions.map((item) => item.label)).toContain("SELECT");

    const scriptCompletions = getQflowCompletionsAtPosition(document, 11, scriptActionLine.length + 1, scriptActionLine);
    expect(scriptCompletions.map((item) => item.label)).toContain("echo");
  });

  it("returns qualifier-aware ctx child completions inside runIf", () => {
    const source = [
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: second",
      "type: payloadbuilder.query",
      "runIf: ctx.first.output.",
      "%%",
      "select 2"
    ].join("\n");
    const document = parseQflowDocument(source);
    const lineContent = "runIf: ctx.first.output.";

    const completions = getQflowCompletionsAtPosition(
      document,
      10,
      lineContent.length + 1,
      lineContent
    );
    const labels = completions.map((item) => item.label);

    expect(labels).toEqual(["preview", "rows", "rowsAffected"]);
  });

  it("returns qualifier-aware function namespace completions inside runIf", () => {
    const { document } = buildDocument();
    const lineContent = "runIf: date.";

    const completions = getQflowCompletionsAtPosition(
      document,
      4,
      lineContent.length + 1,
      lineContent
    );
    const labels = completions.map((item) => item.label);

    expect(labels).toEqual(["add"]);
  });

  it("returns empty runIf completions for unknown qualifier", () => {
    const { document } = buildDocument();
    const lineContent = "runIf: unknownScope.";

    const completions = getQflowCompletionsAtPosition(
      document,
      4,
      lineContent.length + 1,
      lineContent
    );

    expect(completions).toEqual([]);
  });
});
