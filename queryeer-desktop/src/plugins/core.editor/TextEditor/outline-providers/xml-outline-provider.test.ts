import { describe, it, expect } from "vitest";
import { xmlOutlineProvider } from "./xml-outline-provider";

describe("xmlOutlineProvider", () => {
  it("returns symbols for nested elements", () => {
    const content = `<database>
  <users>
    <user id="1"/>
  </users>
</database>`;
    const symbols = xmlOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("database");
    expect(symbols[0].kind).toBe("Class");
    expect(symbols[0].children).toBeDefined();
    expect(symbols[0].children!.length).toBe(1);
    expect(symbols[0].children![0].name).toBe("users");
    expect(symbols[0].children![0].children!.length).toBe(1);
    expect(symbols[0].children![0].children![0].name).toBe("user");
  });

  it("handles self-closing tags", () => {
    const content = `<root>
  <item/>
  <item id="2"/>
</root>`;
    const symbols = xmlOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].children!.length).toBe(2);
    expect(symbols[0].children![0].name).toBe("item");
    expect(symbols[0].children![1].name).toBe("item");
  });

  it("includes attributes in detail", () => {
    const content = `<user id="1" name="test"/>`;
    const symbols = xmlOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].detail).toBe('id="1" name="test"');
  });

  it("returns error node for malformed XML", () => {
    const content = `<database>
  <users>
`;
    const symbols = xmlOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("Parse Error");
    expect(symbols[0].kind).toBe("Event");
  });

  it("returns empty array for empty string", () => {
    expect(xmlOutlineProvider("")).toEqual([]);
  });

  it("skips comments and processing instructions", () => {
    const content = `<?xml version="1.0"?>
<!-- comment -->
<root>
  <!-- inner comment -->
  <item/>
</root>`;
    const symbols = xmlOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("root");
    expect(symbols[0].children!.length).toBe(1);
  });

  it("generates correct ID format", () => {
    const content = `<database>
  <users>
    <user id="1"/>
  </users>
</database>`;
    const symbols = xmlOutlineProvider(content);
    expect(symbols[0].id).toBe("xml:0:1:database");
    expect(symbols[0].children![0].id).toBe("xml:1:2:users");
    expect(symbols[0].children![0].children![0].id).toBe("xml:2:3:user");
  });
});
