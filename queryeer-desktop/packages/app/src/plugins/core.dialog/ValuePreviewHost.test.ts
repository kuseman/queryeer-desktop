import { describe, expect, it } from "vitest";
import { buildValuePreviewEditorOptions, toValuePreviewZIndex } from "./ValuePreviewHost";

describe("ValuePreviewHost editor options", () => {
  it("enables visible section folding for structured values", () => {
    const options = buildValuePreviewEditorOptions('{"nested":{"value":1}}', "application/json");

    expect(options).toMatchObject({
      language: "json",
      readOnly: true,
      folding: true,
      foldingStrategy: "auto",
      foldingHighlight: true,
      showFoldingControls: "always",
      unfoldOnClickAfterEndOfLine: true
    });
  });

  it("uses the XML language service for XML previews", () => {
    expect(buildValuePreviewEditorOptions("<root><child /></root>", "application/xml").language).toBe("xml");
  });

  it("places relative dialog ordering above Monaco and shell overlays", () => {
    expect(toValuePreviewZIndex(1)).toBe(20_001);
    expect(toValuePreviewZIndex(2)).toBeGreaterThan(toValuePreviewZIndex(1));
  });
});
