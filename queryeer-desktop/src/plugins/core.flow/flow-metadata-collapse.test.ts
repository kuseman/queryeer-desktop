import { describe, expect, it } from "vitest";
import { parseQflowDocument } from "./qflow-parser";
import {
  buildMetadataCollapseFallbackDecorations,
  buildMetadataCollapsePlan,
  normalizeExpandedMetadataNodeIds,
  readPersistedExpandedMetadataNodeIds,
  toPersistedExpandedMetadataNodeIds
} from "./flow-metadata-collapse";

describe("flow metadata collapse", () => {
  it("builds hidden ranges for collapsed nodes without metadata diagnostics", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: n1",
      "type: jdbc.query",
      "description: first",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: n2",
      "type: jdbc.query",
      "description: second",
      "%%",
      "select 2"
    ].join("\n"));

    const plan = buildMetadataCollapsePlan({
      document,
      expandedNodeIds: new Set(["n2"])
    });

    expect(plan.hiddenRanges).toEqual([{
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 4,
      endColumn: Number.MAX_SAFE_INTEGER
    }]);
    expect(plan.toggleDecorations).toEqual([
      {
        lineNumber: 1,
        glyphMarginClassName: "flow-metadata-toggle",
        hoverMessage: "Show flow node metadata"
      },
      {
        lineNumber: 8,
        glyphMarginClassName: "flow-metadata-toggle flow-metadata-toggle-expanded",
        hoverMessage: "Hide flow node metadata"
      }
    ]);
  });

  it("does not hide metadata for nodes with metadata diagnostics", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: n1",
      "type: jdbc.query",
      "description: first",
      "%%",
      "select 1"
    ].join("\n"));

    const withMetadataDiagnostic = {
      ...document,
      diagnostics: [
        ...document.diagnostics,
        {
          severity: "error" as const,
          message: "metadata error",
          line: 3,
          column: 1
        }
      ]
    };

    const plan = buildMetadataCollapsePlan({
      document: withMetadataDiagnostic,
      expandedNodeIds: new Set()
    });

    expect(plan.hiddenRanges).toEqual([]);
    expect(plan.toggleDecorations).toHaveLength(1);
  });

  it("builds line fallback decorations when hidden areas are unsupported", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: n1",
      "type: jdbc.query",
      "description: first",
      "%%",
      "select 1"
    ].join("\n"));

    const decorations = buildMetadataCollapseFallbackDecorations({
      document,
      expandedNodeIds: new Set(),
      lineClassName: "flow-metadata-collapsed-line"
    });

    expect(decorations).toEqual([
      {
        lineNumber: 2,
        lineClassName: "flow-metadata-collapsed-line",
        hoverMessage: "Metadata collapse is not supported by this editor build."
      },
      {
        lineNumber: 3,
        lineClassName: "flow-metadata-collapsed-line",
        hoverMessage: "Metadata collapse is not supported by this editor build."
      },
      {
        lineNumber: 4,
        lineClassName: "flow-metadata-collapsed-line",
        hoverMessage: "Metadata collapse is not supported by this editor build."
      }
    ]);
  });

  it("normalizes expanded node ids to only existing nodes", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: n1",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: n2",
      "type: jdbc.query",
      "%%",
      "select 2"
    ].join("\n"));

    const normalized = normalizeExpandedMetadataNodeIds(
      document,
      new Set(["n1", "missing", "n2"])
    );

    expect([...normalized].sort()).toEqual(["n1", "n2"]);
  });

  it("reads persisted expanded node ids and ignores invalid values", () => {
    expect(
      readPersistedExpandedMetadataNodeIds({
        expandedNodeIds: [" b ", "", 2, null, "a"]
      })
    ).toEqual(new Set(["a", "b"]));

    expect(readPersistedExpandedMetadataNodeIds(["x", "  ", "y"])).toEqual(new Set(["x", "y"]));
    expect(readPersistedExpandedMetadataNodeIds(undefined)).toEqual(new Set());
  });

  it("serializes persisted expanded node ids deterministically", () => {
    expect(toPersistedExpandedMetadataNodeIds(new Set(["b", " a "]))).toEqual({
      expandedNodeIds: ["a", "b"]
    });
    expect(toPersistedExpandedMetadataNodeIds(new Set())).toBeUndefined();
  });
});
