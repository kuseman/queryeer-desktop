import { describe, expect, it } from "vitest";
import { parseMongoConnectionDefinitions } from "./mongodb-settings";

describe("mongodb settings", () => {
  it("parses connections and preserves secret references", () => {
    expect(parseMongoConnectionDefinitions([
      {
        connectionId: "mongo-1",
        title: "Production",
        connectionString: "mongodb+srv://cluster.example.net",
        authUsername: "queryeer",
        authPassword: { secretRef: "mongo-password" },
        authDatabase: "admin",
        enabled: false
      }
    ])).toEqual([
      {
        connectionId: "mongo-1",
        title: "Production",
        connectionString: "mongodb+srv://cluster.example.net",
        authUsername: "queryeer",
        authPassword: { secretRef: "mongo-password" },
        authDatabase: "admin",
        enabled: false
      }
    ]);
  });

  it("filters invalid and duplicate connections", () => {
    expect(parseMongoConnectionDefinitions([
      { connectionId: "", connectionString: "mongodb://localhost:27017" },
      { connectionId: "mongo-1", connectionString: "http://localhost:27017" },
      { connectionId: "mongo-1", connectionString: "mongodb://localhost:27017" },
      { connectionId: "mongo-1", connectionString: "mongodb://other:27017" }
    ])).toEqual([
      {
        connectionId: "mongo-1",
        title: undefined,
        connectionString: "mongodb://localhost:27017",
        authUsername: undefined,
        authPassword: undefined,
        authDatabase: undefined,
        enabled: true
      }
    ]);
  });
});
