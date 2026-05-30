import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExtensionRegistry } from "./ExtensionRegistry";
import type { OutlineSymbol } from "@queryeer/api/extensions/OutlineExtension";

describe("OutlineRegistry", () => {
  let registry: ExtensionRegistry;

  beforeEach(() => {
    registry = new ExtensionRegistry();
  });

  const sampleSymbol: OutlineSymbol = {
    id: "test:1",
    name: "test",
    kind: "Key",
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 },
    selectionRange: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 }
  };

  it("registerOutlineProvider registers a provider", () => {
    const outlineRegistry = registry.createOutlineRegistry();
    outlineRegistry.registerOutlineProvider({
      mimeType: "application/json",
      provider: () => [sampleSymbol]
    });
    expect(outlineRegistry.hasProvider("application/json")).toBe(true);
  });

  it("hasProvider returns false for unregistered MIME types", () => {
    const outlineRegistry = registry.createOutlineRegistry();
    expect(outlineRegistry.hasProvider("application/json")).toBe(false);
  });

  it("getProvider returns the registered provider", () => {
    const outlineRegistry = registry.createOutlineRegistry();
    const provider = () => [sampleSymbol];
    outlineRegistry.registerOutlineProvider({ mimeType: "application/json", provider });
    expect(outlineRegistry.getProvider("application/json")).toBe(provider);
  });

  it("getSymbols runs the main provider", async () => {
    const outlineRegistry = registry.createOutlineRegistry();
    outlineRegistry.registerOutlineProvider({
      mimeType: "application/json",
      provider: () => [sampleSymbol]
    });
    const symbols = await outlineRegistry.getSymbols("application/json", "{}");
    expect(symbols).toEqual([sampleSymbol]);
  });

  it("registerSupplementaryOutlineProvider adds supplementary symbols", async () => {
    const outlineRegistry = registry.createOutlineRegistry();
    outlineRegistry.registerOutlineProvider({
      mimeType: "application/json",
      provider: () => [{ ...sampleSymbol, id: "main:1" }]
    });
    outlineRegistry.registerSupplementaryOutlineProvider({
      mimeType: "application/json",
      provider: () => [{ ...sampleSymbol, id: "supp:1" }]
    });
    const symbols = await outlineRegistry.getSymbols("application/json", "{}");
    expect(symbols.length).toBe(2);
    expect(symbols[0].id).toBe("supp:1");
    expect(symbols[1].id).toBe("main:1");
  });

  it("deduplicates by id (main provider wins)", async () => {
    const outlineRegistry = registry.createOutlineRegistry();
    outlineRegistry.registerOutlineProvider({
      mimeType: "application/json",
      provider: () => [{ ...sampleSymbol, id: "dup:1", name: "main" }]
    });
    outlineRegistry.registerSupplementaryOutlineProvider({
      mimeType: "application/json",
      provider: () => [{ ...sampleSymbol, id: "dup:1", name: "supp" }]
    });
    const symbols = await outlineRegistry.getSymbols("application/json", "{}");
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("main");
  });

  it("silently discards supplementary provider errors", async () => {
    const outlineRegistry = registry.createOutlineRegistry();
    outlineRegistry.registerOutlineProvider({
      mimeType: "application/json",
      provider: () => [sampleSymbol]
    });
    outlineRegistry.registerSupplementaryOutlineProvider({
      mimeType: "application/json",
      provider: () => { throw new Error("boom"); }
    });
    const symbols = await outlineRegistry.getSymbols("application/json", "{}");
    expect(symbols.length).toBe(1);
    expect(symbols[0].id).toBe("test:1");
  });

  it("shows main provider error node on failure", async () => {
    const outlineRegistry = registry.createOutlineRegistry();
    outlineRegistry.registerOutlineProvider({
      mimeType: "application/json",
      provider: () => { throw new Error("parse error"); }
    });
    const symbols = await outlineRegistry.getSymbols("application/json", "{}");
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("Parse Error");
    expect(symbols[0].id).toBe("application/json:error:0");
  });

  it("returns empty array for MIME type with no providers", async () => {
    const outlineRegistry = registry.createOutlineRegistry();
    const symbols = await outlineRegistry.getSymbols("application/json", "{}");
    expect(symbols).toEqual([]);
  });

  it("warns on overwrite of main provider", () => {
    const outlineRegistry = registry.createOutlineRegistry();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    outlineRegistry.registerOutlineProvider({
      mimeType: "application/json",
      provider: () => []
    });
    outlineRegistry.registerOutlineProvider({
      mimeType: "application/json",
      provider: () => []
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("supports async providers", async () => {
    const outlineRegistry = registry.createOutlineRegistry();
    outlineRegistry.registerOutlineProvider({
      mimeType: "application/json",
      provider: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [sampleSymbol];
      }
    });
    const symbols = await outlineRegistry.getSymbols("application/json", "{}");
    expect(symbols).toEqual([sampleSymbol]);
  });
});
