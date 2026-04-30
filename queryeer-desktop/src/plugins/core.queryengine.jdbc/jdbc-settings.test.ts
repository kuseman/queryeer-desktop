import { describe, expect, it } from "vitest";
import { parseJdbcConnectionDefinitions } from "./jdbc-settings";

describe("parseJdbcConnectionDefinitions", () => {
  it("parses valid rows and keeps secret refs", () => {
    const result = parseJdbcConnectionDefinitions([
      {
        connectionId: "pg1",
        dialectId: "postgres",
        url: "jdbc:postgresql://localhost:5432/app",
        username: "app",
        password: { secretRef: "sec-1" },
        enabled: true
      }
    ]);

    expect(result).toEqual([
      {
        connectionId: "pg1",
        dialectId: "postgres",
        url: "jdbc:postgresql://localhost:5432/app",
        username: "app",
        password: { secretRef: "sec-1" },
        enabled: true
      }
    ]);
  });

  it("drops duplicate or incomplete entries", () => {
    const result = parseJdbcConnectionDefinitions([
      { connectionId: "", url: "jdbc:a" },
      { connectionId: "a", url: "" },
      { connectionId: "a", url: "jdbc:a" },
      { connectionId: "a", url: "jdbc:b" }
    ]);

    expect(result).toEqual([
      {
        connectionId: "a",
        dialectId: "jdbc",
        url: "jdbc:a",
        username: undefined,
        password: undefined,
        enabled: true,
        title: undefined
      }
    ]);
  });
});
