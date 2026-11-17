import { describe, expect, it } from "vitest";
import type { JdbcConnectionSetupDefinition } from "@queryeer/api/queryengine/JdbcDialectExtension.js";
import { fieldsSubtitle, isFieldVisible, parseConnectionSetup, validateFields, withFieldDefaults } from "./jdbc-connection-fields";

const server: JdbcConnectionSetupDefinition = {
  fields: [
    { id: "host", label: "Host", type: "TEXT", required: true },
    { id: "port", label: "Port", type: "NUMBER", required: false, defaultValue: 3306 },
    { id: "database", label: "Database", type: "TEXT", required: false },
    { id: "authType", label: "Authentication", type: "SELECT", required: true, defaultValue: "PASSWORD", options: [{ value: "PASSWORD", label: "Password" }, { value: "KERBEROS", label: "Kerberos" }] },
    { id: "username", label: "Username", type: "TEXT", required: true, visibleWhen: { authType: "PASSWORD" } },
    { id: "password", label: "Password", type: "SECRET", required: true, visibleWhen: { authType: "PASSWORD" } }
  ]
};

describe("jdbc-connection-fields", () => {
  it("reads the fields of a dialects entry and ignores malformed ones", () => {
    expect(parseConnectionSetup({ fields: [{ id: "host", label: "Host", type: "TEXT", required: true }, { label: "no id" }] })).toEqual({
      fields: [{ id: "host", label: "Host", type: "TEXT", required: true }]
    });
    expect(parseConnectionSetup(undefined)).toBeUndefined();
    // Normalized: unknown types dropped, malformed options and visibleWhen ignored, required only when true
    expect(parseConnectionSetup({ fields: [
      { id: "a", label: "A", type: "COLOR", required: true },
      { id: "b", label: "B", type: "SELECT", required: "false", options: {}, visibleWhen: ["x"] },
      { id: "c", label: "C", type: "FILE_PATH", required: true, options: [{ value: 1, label: "One" }] }
    ] })).toEqual({ fields: [
      { id: "b", label: "B", type: "SELECT", required: false, description: undefined, options: undefined, defaultValue: undefined, visibleWhen: undefined },
      { id: "c", label: "C", type: "FILE_PATH", required: true, description: undefined, options: [{ value: "1", label: "One" }], defaultValue: undefined, visibleWhen: undefined }
    ] });
    expect(parseConnectionSetup({ fields: [] })).toBeUndefined();
  });

  it("requires visible required fields, never secrets", () => {
    expect(validateFields(server, {})).toEqual(["Host is required", "Username is required"]);
    expect(validateFields(server, { host: "db", username: "app" })).toEqual([]);
    // Username is hidden for Kerberos, so it is not required
    expect(validateFields(server, { host: "db", authType: "KERBEROS" })).toEqual([]);
  });

  it("evaluates visibleWhen against defaults too", () => {
    const username = server.fields[4];
    expect(isFieldVisible(username, server, {})).toBe(true);
    expect(isFieldVisible(username, server, { authType: "KERBEROS" })).toBe(false);
  });

  it("stores the defaults the form showed, but no secret", () => {
    expect(withFieldDefaults(server, { host: "db", port: 3307 })).toEqual({ host: "db", port: 3307, authType: "PASSWORD" });
  });

  it("builds host:port/database, with the default port", () => {
    expect(fieldsSubtitle(server, { host: "db", database: "shop" })).toBe("db:3306/shop");
    expect(fieldsSubtitle(server, {})).toBe("Host required");
  });

  it("uses the first required field for dialects without a host", () => {
    const file: JdbcConnectionSetupDefinition = { fields: [{ id: "filePath", label: "Database File", type: "TEXT", required: true }] };
    expect(fieldsSubtitle(file, { filePath: "/data/app.db" })).toBe("/data/app.db");
    expect(fieldsSubtitle(file, {})).toBe("Database File required");
  });
});
