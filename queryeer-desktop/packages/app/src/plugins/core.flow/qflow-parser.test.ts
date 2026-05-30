import { describe, expect, it } from "vitest";
import { parseQflowDocument, resolveNodeIdForLine, serializeQflowDocument } from "./qflow-parser";

describe("qflow parser", () => {
  it("parses node metadata and action blocks", () => {
    const source = [
      "%%queryeer-flow",
      "id: extract",
      "type: jdbc.query",
      "description: \"Extract rows\"",
      "runIf: ctx.bootstrap.output.rowsAffected > 0",
      "queryEngine:",
      "  id: jdbc",
      "  state:",
      "    database: master",
      "%%",
      "select * from source_table;",
      "",
      "%%queryeer-flow",
      "id: transform",
      "type: payloadbuilder.query",
      "%%",
      "echo 'ok'"
    ].join("\n");

    const parsed = parseQflowDocument(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]?.metadata).toMatchObject({
      id: "extract",
      type: "jdbc.query",
      description: "Extract rows",
      runIf: "ctx.bootstrap.output.rowsAffected > 0",
      additional: {
        queryEngine: {
          id: "jdbc",
          state: {
            database: "master"
          }
        }
      }
    });
    expect(parsed.nodes[0]?.action).toBe("select * from source_table;");
    expect(parsed.nodes[1]?.metadata.id).toBe("transform");
    expect(parsed.nodes[1]?.action).toBe("echo 'ok'");
  });

  it("serializes and reparses round-trip", () => {
    const source = [
      "%%queryeer-flow",
      "id: n1",
      "type: jdbc.query",
      "description: first node",
      "runIf: true",
      "queryEngine:",
      "  state:",
      "    catalog: demo",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: n2",
      "type: payloadbuilder.query",
      "%%",
      "select 2"
    ].join("\n");

    const parsed = parseQflowDocument(source);
    const serialized = serializeQflowDocument(parsed);
    const reparsed = parseQflowDocument(serialized);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.nodes.map((node) => node.metadata.id)).toEqual(["n1", "n2"]);
    expect(reparsed.nodes.map((node) => node.metadata.type)).toEqual(["jdbc.query", "payloadbuilder.query"]);
    expect(reparsed.nodes[0]?.metadata.description).toBe("first node");
    expect(reparsed.nodes[0]?.metadata.runIf).toBe("true");
    expect(reparsed.nodes[0]?.action).toBe("select 1");
    expect(reparsed.nodes[1]?.action).toBe("select 2");
  });

  it("reports diagnostics for malformed YAML metadata", () => {
    const source = [
      "%%queryeer-flow",
      "type: jdbc.query",
      "bad: [",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: x"
    ].join("\n");

    const parsed = parseQflowDocument(source);

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.includes("Missing required metadata key 'id'"))).toBe(true);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.length > 0)).toBe(true);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.includes("Unclosed flow metadata block"))).toBe(true);
  });

  it("stores unknown metadata keys in additional", () => {
    const source = [
      "%%queryeer-flow",
      "id: extra",
      "type: jdbc.query",
      "owner: team-a",
      "retry:",
      "  count: 3",
      "%%",
      "select 1"
    ].join("\n");

    const parsed = parseQflowDocument(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes[0]?.metadata.additional).toEqual({
      owner: "team-a",
      retry: {
        count: 3
      }
    });
  });

  it("reports duplicate flow node ids as errors", () => {
    const source = [
      "%%queryeer-flow",
      "id: duplicate",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: duplicate",
      "type: payloadbuilder.query",
      "%%",
      "echo 'again'"
    ].join("\n");

    const parsed = parseQflowDocument(source);

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        line: 8,
        message: expect.stringContaining("Duplicate flow node id 'duplicate'. First declared at line 2.")
      })
    );
  });

  it("reports warning when a node action body is empty", () => {
    const source = [
      "%%queryeer-flow",
      "id: empty",
      "type: jdbc.query",
      "%%",
      "",
      "%%queryeer-flow",
      "id: next",
      "type: payloadbuilder.query",
      "%%",
      "select 1"
    ].join("\n");

    const parsed = parseQflowDocument(source);

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]?.action).toBe("");
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        line: 5,
        message: "Flow node 'empty' has an empty action body."
      })
    );
  });

  it("reports diagnostics for duplicate YAML metadata keys", () => {
    const source = [
      "%%queryeer-flow",
      "id: first",
      "id: second",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n");

    const parsed = parseQflowDocument(source);

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.includes("Map keys must be unique"))).toBe(true);
  });

  it("parses multiline YAML metadata values", () => {
    const source = [
      "%%queryeer-flow",
      "id: multiline",
      "type: jdbc.query",
      "description: |",
      "  line one",
      "  line two",
      "%%",
      "select 1"
    ].join("\n");

    const parsed = parseQflowDocument(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes[0]?.metadata.description).toBe("line one\nline two");
  });

  it("normalizes line endings and trims trailing blank action lines", () => {
    const source = "%%queryeer-flow\rid: alpha\rtype: jdbc.query\r%%\rselect 1\r\r";

    const parsed = parseQflowDocument(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.action).toBe("select 1");
  });

  it("resolves node id by line number", () => {
    const source = [
      "%%queryeer-flow",
      "id: alpha",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: beta",
      "type: payloadbuilder.query",
      "%%",
      "select 2"
    ].join("\n");
    const parsed = parseQflowDocument(source);

    expect(resolveNodeIdForLine(parsed, 2)).toBe("alpha");
    expect(resolveNodeIdForLine(parsed, 5)).toBe("alpha");
    expect(resolveNodeIdForLine(parsed, 8)).toBe("beta");
    expect(resolveNodeIdForLine(parsed, 11)).toBe("beta");
  });
});
