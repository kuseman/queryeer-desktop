import { describe, expect, it } from "vitest";
import { evaluateWhenExpression } from "./when-evaluator";

describe("evaluateWhenExpression", () => {
  it("treats empty/global as true", () => {
    expect(evaluateWhenExpression(undefined, {})).toBe(true);
    expect(evaluateWhenExpression("global", {})).toBe(true);
  });

  it("evaluates boolean identifiers", () => {
    expect(evaluateWhenExpression("editorFocus", { editorFocus: true })).toBe(true);
    expect(evaluateWhenExpression("editorFocus", { editorFocus: false })).toBe(false);
  });

  it("evaluates and/or/not", () => {
    expect(
      evaluateWhenExpression("editorFocus && !terminalFocus", {
        editorFocus: true,
        terminalFocus: false
      })
    ).toBe(true);
    expect(
      evaluateWhenExpression("editorFocus || terminalFocus", {
        editorFocus: false,
        terminalFocus: true
      })
    ).toBe(true);
  });

  it("evaluates equality expressions", () => {
    expect(evaluateWhenExpression("resourceLangId == 'sql'", { resourceLangId: "sql" })).toBe(true);
    expect(evaluateWhenExpression("resourceLangId != 'sql'", { resourceLangId: "json" })).toBe(true);
  });

  describe("string method calls", () => {
    it("contains", () => {
      expect(evaluateWhenExpression("db.contains('prod')", { db: "mydb-prod" })).toBe(true);
      expect(evaluateWhenExpression("db.contains('prod')", { db: "mydb-dev" })).toBe(false);
    });

    it("startsWith", () => {
      expect(evaluateWhenExpression("activeFileMimeType.startsWith('application/')", { activeFileMimeType: "application/sql" })).toBe(true);
      expect(evaluateWhenExpression("activeFileMimeType.startsWith('text/')", { activeFileMimeType: "application/sql" })).toBe(false);
    });

    it("endsWith", () => {
      expect(evaluateWhenExpression("languageId.endsWith('sql')", { languageId: "plsql" })).toBe(true);
      expect(evaluateWhenExpression("languageId.endsWith('json')", { languageId: "plsql" })).toBe(false);
    });

    it("matches", () => {
      expect(evaluateWhenExpression("languageId.matches('sql|plsql')", { languageId: "plsql" })).toBe(true);
      expect(evaluateWhenExpression("languageId.matches('^sql$')", { languageId: "plsql" })).toBe(false);
    });

    it("method on dotted path", () => {
      expect(evaluateWhenExpression("activeFileMetadata.core.queryengine.jdbc.database.contains('staging')", {
        "activeFileMetadata.core.queryengine.jdbc.database": "db-staging"
      })).toBe(true);
    });

    it("returns false when subject is not a string", () => {
      expect(evaluateWhenExpression("count.contains('x')", { count: 42 })).toBe(false);
      expect(evaluateWhenExpression("flag.startsWith('y')", { flag: true })).toBe(false);
      expect(evaluateWhenExpression("missing.contains('x')", {})).toBe(false);
    });

    it("method result works with logical operators", () => {
      expect(evaluateWhenExpression("db.contains('prod') && hasFile", { db: "prod-db", hasFile: true })).toBe(true);
      expect(evaluateWhenExpression("!db.contains('prod')", { db: "dev-db" })).toBe(true);
    });

    it("invalid regex in matches returns false instead of throwing", () => {
      expect(evaluateWhenExpression("s.matches('[')", { s: "hello" })).toBe(false);
    });

    it("lower", () => {
      expect(evaluateWhenExpression("mimeType.lower() == 'application/sql'", { mimeType: "Application/SQL" })).toBe(true);
      expect(evaluateWhenExpression("mimeType.lower() == 'application/sql'", { mimeType: "application/json" })).toBe(false);
    });

    it("upper", () => {
      expect(evaluateWhenExpression("db.upper() == 'PRODUCTION'", { db: "production" })).toBe(true);
      expect(evaluateWhenExpression("db.upper() == 'PRODUCTION'", { db: "staging" })).toBe(false);
    });

    it("lower/upper return undefined (falsy) when subject is not a string", () => {
      expect(evaluateWhenExpression("count.lower() == 'x'", { count: 42 })).toBe(false);
      expect(evaluateWhenExpression("flag.upper() == 'X'", { flag: true })).toBe(false);
    });

    it("chained transform then predicate", () => {
      expect(evaluateWhenExpression(
        "activeFileMetadata.core.queryengine.jdbc.database.lower().contains('products')",
        { "activeFileMetadata.core.queryengine.jdbc.database": "Products_DB" }
      )).toBe(true);
      expect(evaluateWhenExpression(
        "db.lower().startsWith('prod')",
        { db: "PRODUCTION" }
      )).toBe(true);
      expect(evaluateWhenExpression(
        "db.upper().endsWith('DB')",
        { db: "main_db" }
      )).toBe(true);
    });
  });
});
