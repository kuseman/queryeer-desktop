import { describe, it, expect } from "vitest";
import { jsonOutlineProvider } from "./json-outline-provider";

describe("jsonOutlineProvider", () => {
  it("returns symbols for flat object", () => {
    const content = `{
  "name": "test",
  "version": "1.0.0"
}`;
    const symbols = jsonOutlineProvider(content);
    expect(symbols.length).toBe(2);
    expect(symbols[0].name).toBe("name");
    expect(symbols[0].kind).toBe("Key");
    expect(symbols[1].name).toBe("version");
    expect(symbols[1].kind).toBe("Key");
  });

  it("returns symbols for nested objects", () => {
    const content = `{
  "database": {
    "host": "localhost",
    "port": 5432
  }
}`;
    const symbols = jsonOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("database");
    expect(symbols[0].kind).toBe("Key");
    expect(symbols[0].children).toBeDefined();
    expect(symbols[0].children!.length).toBe(2);
  });

  it("returns symbols for arrays", () => {
    const content = `{
  "servers": [
    "server1",
    "server2"
  ]
}`;
    const symbols = jsonOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("servers");
    expect(symbols[0].children).toBeDefined();
    expect(symbols[0].children!.length).toBe(2);
    expect(symbols[0].children![0].name).toBe("0");
  });

  it("returns symbols for mixed content", () => {
    const content = `{
  "name": "app",
  "config": {
    "debug": true,
    "items": [1, 2, null]
  }
}`;
    const symbols = jsonOutlineProvider(content);
    expect(symbols.length).toBe(2);
    expect(symbols[1].children).toBeDefined();
    expect(symbols[1].children!.length).toBe(2);
  });

  it("returns error node for invalid JSON", () => {
    const content = `{ invalid json }`;
    const symbols = jsonOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("Parse Error");
    expect(symbols[0].kind).toBe("Event");
    expect(symbols[0].id.startsWith("json:error:")).toBe(true);
  });

  it("returns empty array for empty string", () => {
    expect(jsonOutlineProvider("")).toEqual([]);
    expect(jsonOutlineProvider("   ")).toEqual([]);
  });

  it("generates stable path-based IDs", () => {
    const content = `{
  "database": {
    "users": []
  }
}`;
    const symbols = jsonOutlineProvider(content);
    expect(symbols[0].id).toMatch(/^json:database:\d+$/);
    expect(symbols[0].children![0].id).toMatch(/^json:database\.users:\d+$/);
  });

  it("computes correct ranges and selectionRanges", () => {
    const content = `{
  "foo": "bar"
}`;
    const symbols = jsonOutlineProvider(content);
    expect(symbols[0].range.startLineNumber).toBeGreaterThan(0);
    expect(symbols[0].selectionRange.startLineNumber).toBe(symbols[0].range.startLineNumber);
    expect(symbols[0].selectionRange.startColumn).toBeGreaterThan(0);
  });
});
