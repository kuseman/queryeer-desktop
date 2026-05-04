import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJdbcConnectionDefinitions } from "./jdbc-settings";

describe("parseJdbcConnectionDefinitions", () => {
  it("parses shared jdbc fixture", () => {
    const fixturePath = resolve(
      process.cwd(),
      "..",
      "protocol-fixtures",
      "jdbc",
      "connection-settings.json"
    );
    const moduleDocument = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      values?: Record<string, unknown>;
    };

    const result = parseJdbcConnectionDefinitions(
      moduleDocument.values?.["core.queryengine.jdbc.connections"]
    );

    expect(result).toEqual([
      {
        connectionId: "550e8400-e29b-41d4-a716-446655440001",
        title: "Local Postgres",
        dialectId: "postgres",
        url: "jdbc:postgresql://localhost:5432/app",
        username: "app",
        password: { secretRef: "sec-1" },
        enabled: true
      },
      {
        connectionId: "550e8400-e29b-41d4-a716-446655440002",
        title: undefined,
        dialectId: "jdbc",
        url: "jdbc:first",
        username: undefined,
        password: undefined,
        enabled: true
      },
      {
        connectionId: "550e8400-e29b-41d4-a716-446655440003",
        title: undefined,
        dialectId: "jdbc",
        url: "jdbc:h2:mem:def",
        username: undefined,
        password: undefined,
        enabled: true
      },
      {
        connectionId: "550e8400-e29b-41d4-a716-446655440004",
        title: undefined,
        dialectId: "mysql",
        url: "jdbc:mysql://localhost:3306/app",
        username: undefined,
        password: undefined,
        enabled: false
      }
    ]);
  });

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
