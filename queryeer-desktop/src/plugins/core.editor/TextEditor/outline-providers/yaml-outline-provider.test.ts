import { describe, it, expect } from "vitest";
import { yamlOutlineProvider } from "./yaml-outline-provider";

describe("yamlOutlineProvider", () => {
  it("returns symbols for mappings", () => {
    const content = `database:
  host: localhost
  port: 5432`;
    const symbols = yamlOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("database");
    expect(symbols[0].kind).toBe("Key");
    expect(symbols[0].children).toBeDefined();
    expect(symbols[0].children!.length).toBe(2);
    expect(symbols[0].children![0].name).toBe("host");
    expect(symbols[0].children![1].name).toBe("port");
  });

  it("returns symbols for sequences", () => {
    const content = `users:
  - admin
  - guest`;
    const symbols = yamlOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].children).toBeDefined();
    expect(symbols[0].children![0].name).toBe("item");
    expect(symbols[0].children![0].kind).toBe("Array");
    expect(symbols[0].children![1].name).toBe("item");
  });

  it("handles document markers", () => {
    const content = `---
key: value`;
    const symbols = yamlOutlineProvider(content);
    expect(symbols.length).toBe(2);
    expect(symbols[0].name).toBe("---");
    expect(symbols[0].kind).toBe("Module");
  });

  it("returns empty array for empty string", () => {
    expect(yamlOutlineProvider("")).toEqual([]);
  });

  it("skips comment lines", () => {
    const content = `# This is a comment
key: value
# Another comment
other: data`;
    const symbols = yamlOutlineProvider(content);
    expect(symbols.length).toBe(2);
    expect(symbols[0].name).toBe("key");
    expect(symbols[1].name).toBe("other");
  });

  it("generates correct ID format", () => {
    const content = `database:
  host: localhost`;
    const symbols = yamlOutlineProvider(content);
    expect(symbols[0].id).toMatch(/^yaml:0:\d+:database$/);
    expect(symbols[0].children![0].id).toMatch(/^yaml:1:\d+:host$/);
  });
});
