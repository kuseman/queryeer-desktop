import { describe, expect, it } from "vitest";
import { parseCatalogAliasDefinitions } from "./catalog-settings";

describe("payloadbuilder catalog settings", () => {
  it("parses unique alias and catalogId entries", () => {
    const parsed = parseCatalogAliasDefinitions([
      { alias: "jdbc1", catalogId: "Jdbc" },
      { alias: "jdbc2", catalogId: "Jdbc", title: "Reports" }
    ]);

    expect(parsed).toEqual([
      { alias: "jdbc1", catalogId: "Jdbc", title: undefined, enabled: true },
      { alias: "jdbc2", catalogId: "Jdbc", title: "Reports", enabled: true }
    ]);
  });

  it("filters invalid and duplicate alias entries", () => {
    const parsed = parseCatalogAliasDefinitions([
      { alias: "", catalogId: "Jdbc" },
      { alias: "jdbc1", catalogId: "" },
      { alias: "jdbc1", catalogId: "Jdbc" },
      { alias: "jdbc1", catalogId: "Jdbc2" },
      "bad"
    ]);

    expect(parsed).toEqual([
      { alias: "jdbc1", catalogId: "Jdbc", title: undefined, enabled: true }
    ]);
  });

  it("respects explicit enabled value", () => {
    const parsed = parseCatalogAliasDefinitions([
      { alias: "jdbc1", catalogId: "Jdbc", enabled: false }
    ]);

    expect(parsed[0]?.enabled).toBe(false);
  });
});
