import { describe, it, expect } from "vitest";
import { sqlOutlineProvider } from "./sql-outline-provider";

describe("sqlOutlineProvider", () => {
  it("parses CREATE TABLE", () => {
    const content = `CREATE TABLE users (
  id INT PRIMARY KEY,
  name TEXT
);`;
    const symbols = sqlOutlineProvider(content);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("users");
    expect(symbols[0].kind).toBe("Class");
    expect(symbols[0].detail).toBe("TABLE");
  });

  it("parses CREATE FUNCTION", () => {
    const content = `CREATE FUNCTION get_user(
  p_id INT
) RETURNS TABLE AS $$
  SELECT * FROM users
  WHERE id = p_id;
$$ LANGUAGE sql;`;
    const symbols = sqlOutlineProvider(content);
    expect(symbols.length).toBe(2);
    expect(symbols[0].name).toBe("get_user");
    expect(symbols[0].kind).toBe("Function");
    expect(symbols[0].detail).toBe("FUNCTION");
    expect(symbols[1].name).toBe("SELECT");
    expect(symbols[1].kind).toBe("Method");
  });

  it("parses CTE with nested SELECT", () => {
    const content = `WITH user_data AS (
  SELECT * FROM users
);
SELECT * FROM user_data;`;
    const symbols = sqlOutlineProvider(content);
    expect(symbols.length).toBe(3);
    expect(symbols[0].name).toBe("user_data");
    expect(symbols[0].kind).toBe("Namespace");
    expect(symbols[0].detail).toBe("CTE");
    expect(symbols[0].children).toBeDefined();
    expect(symbols[0].children!.length).toBe(2);
  });

  it("parses multiple statements", () => {
    const content = `CREATE TABLE users (id INT);
CREATE TABLE orders (id INT);
SELECT * FROM users;`;
    const symbols = sqlOutlineProvider(content);
    expect(symbols.length).toBe(3);
  });

  it("returns empty array for empty string", () => {
    expect(sqlOutlineProvider("")).toEqual([]);
  });

  it("generates correct ID format", () => {
    const content = `CREATE TABLE users (id INT);`;
    const symbols = sqlOutlineProvider(content);
    expect(symbols[0].id).toMatch(/^sql:1:CREATE$/);
  });

  it("parses INSERT, UPDATE, DELETE", () => {
    const content = `INSERT INTO users (name) VALUES ('test');
UPDATE users SET name = 'new';
DELETE FROM users WHERE id = 1;`;
    const symbols = sqlOutlineProvider(content);
    expect(symbols.length).toBe(3);
    expect(symbols[0].name).toBe("users");
    expect(symbols[1].name).toBe("users");
    expect(symbols[2].name).toBe("users");
  });

  describe("line ending handling", () => {
    it("handles Windows line endings (CRLF)", () => {
      const content = "SELECT * FROM users;\r\nSELECT * FROM orders;\r\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe("SELECT");
      expect(symbols[0].selectionRange.startLineNumber).toBe(1);
      expect(symbols[1].selectionRange.startLineNumber).toBe(2);
    });

    it("handles Unix line endings (LF)", () => {
      const content = "SELECT * FROM users;\nSELECT * FROM orders;\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(2);
      expect(symbols[0].selectionRange.startLineNumber).toBe(1);
      expect(symbols[1].selectionRange.startLineNumber).toBe(2);
    });

    it("handles old Mac line endings (CR)", () => {
      const content = "SELECT * FROM users;\rSELECT * FROM orders;\r";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(2);
      expect(symbols[0].selectionRange.startLineNumber).toBe(1);
      expect(symbols[1].selectionRange.startLineNumber).toBe(2);
    });

    it("handles mixed line endings", () => {
      const content = "SELECT * FROM users;\r\nSELECT * FROM orders;\nSELECT * FROM products;\r";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(3);
      expect(symbols[0].selectionRange.startLineNumber).toBe(1);
      expect(symbols[1].selectionRange.startLineNumber).toBe(2);
      expect(symbols[2].selectionRange.startLineNumber).toBe(3);
    });

    it("produces accurate selection ranges with CRLF", () => {
      const content = "SELECT * FROM users;\r\nSELECT * FROM orders;\r\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols[0].selectionRange.startLineNumber).toBe(1);
      expect(symbols[0].selectionRange.startColumn).toBe(1);
      expect(symbols[0].selectionRange.endColumn).toBe(7);
      expect(symbols[1].selectionRange.startLineNumber).toBe(2);
      expect(symbols[1].selectionRange.startColumn).toBe(1);
    });

    it("produces accurate selection ranges with LF", () => {
      const content = "SELECT * FROM users;\nSELECT * FROM orders;\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols[0].selectionRange.startLineNumber).toBe(1);
      expect(symbols[0].selectionRange.startColumn).toBe(1);
      expect(symbols[0].selectionRange.endColumn).toBe(7);
      expect(symbols[1].selectionRange.startLineNumber).toBe(2);
      expect(symbols[1].selectionRange.startColumn).toBe(1);
    });

    it("produces accurate positions for realistic multi-statement file with CRLF", () => {
      const content =
        "-- comment line 1\r\n" +
        "\r\n" +
        "SELECT * FROM users;\r\n" +
        "\r\n" +
        "SELECT * FROM orders;\r\n" +
        "\r\n" +
        "SELECT * FROM products;\r\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(3);
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
      expect(symbols[0].selectionRange.startColumn).toBe(1);
      expect(symbols[1].selectionRange.startLineNumber).toBe(5);
      expect(symbols[1].selectionRange.startColumn).toBe(1);
      expect(symbols[2].selectionRange.startLineNumber).toBe(7);
      expect(symbols[2].selectionRange.startColumn).toBe(1);
    });

    it("produces accurate positions for realistic multi-statement file with LF", () => {
      const content =
        "-- comment line 1\n" +
        "\n" +
        "SELECT * FROM users;\n" +
        "\n" +
        "SELECT * FROM orders;\n" +
        "\n" +
        "SELECT * FROM products;\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(3);
      expect(symbols[0].selectionRange.startLineNumber).toBe(3);
      expect(symbols[0].selectionRange.startColumn).toBe(1);
      expect(symbols[1].selectionRange.startLineNumber).toBe(5);
      expect(symbols[1].selectionRange.startColumn).toBe(1);
      expect(symbols[2].selectionRange.startLineNumber).toBe(7);
      expect(symbols[2].selectionRange.startColumn).toBe(1);
    });

    it("produces consistent positions regardless of normalization order", () => {
      const crlfContent = "SELECT a;\r\nSELECT b;\r\nSELECT c;\r\n";
      const lfContent = "SELECT a;\nSELECT b;\nSELECT c;\n";

      const crlfSymbols = sqlOutlineProvider(crlfContent);
      const lfSymbols = sqlOutlineProvider(lfContent);

      expect(crlfSymbols[0].selectionRange.startLineNumber).toBe(lfSymbols[0].selectionRange.startLineNumber);
      expect(crlfSymbols[1].selectionRange.startLineNumber).toBe(lfSymbols[1].selectionRange.startLineNumber);
      expect(crlfSymbols[2].selectionRange.startLineNumber).toBe(lfSymbols[2].selectionRange.startLineNumber);
    });

    it("computes correct column for indented statements", () => {
      const content = "  SELECT * FROM users;\n    SELECT * FROM orders;\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(2);
      expect(symbols[0].selectionRange.startColumn).toBe(3);
      expect(symbols[1].selectionRange.startColumn).toBe(5);
    });

    it("computes correct column for indented statements with CRLF", () => {
      const content = "  SELECT * FROM users;\r\n    SELECT * FROM orders;\r\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(2);
      expect(symbols[0].selectionRange.startColumn).toBe(3);
      expect(symbols[1].selectionRange.startColumn).toBe(5);
    });

    it("produces accurate positions for CREATE TABLE with CRLF", () => {
      const content = "CREATE TABLE users (\r\n  id INT\r\n);\r\nCREATE TABLE orders (\r\n  id INT\r\n);\r\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(2);
      expect(symbols[0].selectionRange.startLineNumber).toBe(1);
      expect(symbols[0].selectionRange.startColumn).toBe(1);
      expect(symbols[0].name).toBe("users");
      expect(symbols[1].selectionRange.startLineNumber).toBe(4);
      expect(symbols[1].selectionRange.startColumn).toBe(1);
      expect(symbols[1].name).toBe("orders");
    });

    it("produces accurate positions for CREATE TABLE with LF", () => {
      const content = "CREATE TABLE users (\n  id INT\n);\nCREATE TABLE orders (\n  id INT\n);\n";
      const symbols = sqlOutlineProvider(content);
      expect(symbols.length).toBe(2);
      expect(symbols[0].selectionRange.startLineNumber).toBe(1);
      expect(symbols[0].selectionRange.startColumn).toBe(1);
      expect(symbols[0].name).toBe("users");
      expect(symbols[1].selectionRange.startLineNumber).toBe(4);
      expect(symbols[1].selectionRange.startColumn).toBe(1);
      expect(symbols[1].name).toBe("orders");
    });
  });
});
