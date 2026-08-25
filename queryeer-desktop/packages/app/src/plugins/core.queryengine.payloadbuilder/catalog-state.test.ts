import { describe, expect, it } from "vitest";
import {
  applyEngineStatePatch,
  emptyCatalogDocument,
  isEngineStateCurrent,
  parseCatalogDocument,
  setSelectedEnvironmentId,
  setInstanceProperty,
  toEngineState,
  upsertInstance,
  validateAlias
} from "./catalog-state";

describe("payloadbuilder catalog state", () => {
  it("requires alias", () => {
    expect(() => validateAlias("   ")).toThrow("Alias is required");
  });

  it("upserts aliases into the document", () => {
    const start = emptyCatalogDocument();

    const next = upsertInstance(start, {
      alias: "jdbc1",
      catalogId: "Jdbc"
    });

    expect(next.instancesByAlias.jdbc1?.catalogId).toBe("Jdbc");
    expect(next.instancesByAlias.jdbc1?.properties).toEqual({});
  });

  it("sets instance properties", () => {
    const start = upsertInstance(emptyCatalogDocument(), {
      alias: "jdbc1",
      catalogId: "Jdbc"
    });

    const next = setInstanceProperty(start, "jdbc1", "database", "appdb");

    expect(next.instancesByAlias.jdbc1?.properties?.database).toBe("appdb");
  });

  it("builds engineState only when aliases exist", () => {
    expect(toEngineState(emptyCatalogDocument())).toBeUndefined();

    const withAlias = upsertInstance(emptyCatalogDocument(), {
      alias: "jdbc1",
      catalogId: "Jdbc",
      properties: {
        database: "appdb"
      }
    });

    expect(toEngineState(withAlias)).toEqual({
      payloadbuilder: {
        catalogs: {
          jdbc1: {
            catalogId: "Jdbc",
            properties: {
              database: "appdb"
            }
          }
        }
      }
    });
  });

  it("applies engine patch merges and removals", () => {
    const start = parseCatalogDocument({
      instancesByAlias: {
        jdbc1: {
          catalogId: "Jdbc",
          properties: {
            database: "appdb",
            schema: "public"
          }
        },
        jdbc2: {
          catalogId: "Jdbc",
          properties: {
            database: "old"
          }
        }
      }
    });

    const patched = applyEngineStatePatch(start, {
      payloadbuilder: {
        catalogs: {
          jdbc1: {
            properties: {
              database: "reporting"
            }
          },
          jdbc2: null,
          jdbc3: {
            catalogId: "Jdbc",
            properties: {
              database: "newdb"
            }
          }
        }
      }
    });

    expect(patched.instancesByAlias.jdbc1?.properties).toEqual({
      database: "reporting",
      schema: "public"
    });
    expect(patched.instancesByAlias.jdbc2).toBeUndefined();
    expect(patched.instancesByAlias.jdbc3?.catalogId).toBe("Jdbc");
  });

  it("stores selected environment id in engine state", () => {
    const next = setSelectedEnvironmentId(emptyCatalogDocument(), "prod");
    expect(toEngineState(next)).toEqual({
      payloadbuilder: {
        selectedEnvironmentId: "prod",
        catalogs: {}
      }
    });
  });

  it("applies defaultCatalogAlias from engine state patch", () => {
    const start = upsertInstance(emptyCatalogDocument(), {
      alias: "jdbc1",
      catalogId: "Jdbc"
    });
    start.defaultCatalogAlias = "jdbc1";

    const patched = applyEngineStatePatch(start, {
      payloadbuilder: {
        catalogs: {},
        defaultCatalogAlias: "jdbc2"
      }
    });

    expect(patched.defaultCatalogAlias).toBe("jdbc2");
  });

  it("preserves existing defaultCatalogAlias when patch does not include it", () => {
    const start = upsertInstance(emptyCatalogDocument(), {
      alias: "jdbc1",
      catalogId: "Jdbc"
    });
    start.defaultCatalogAlias = "jdbc1";

    const patched = applyEngineStatePatch(start, {
      payloadbuilder: {
        catalogs: {}
      }
    });

    expect(patched.defaultCatalogAlias).toBe("jdbc1");
  });

  it("rejects a completion patch after its connection changed", () => {
    const current = parseCatalogDocument({
      instancesByAlias: {
        jdbc1: { catalogId: "Jdbc", properties: { connectionId: "second", database: "production" } }
      }
    });
    const submitted = {
      payloadbuilder: {
        catalogs: {
          jdbc1: { catalogId: "Jdbc", properties: { connectionId: "first", database: "appdb" } }
        }
      }
    };
    const patch = {
      payloadbuilder: {
        catalogs: {
          jdbc1: { catalogId: "Jdbc", properties: { database: "reporting" } }
        }
      }
    };

    expect(isEngineStateCurrent(current, submitted, patch)).toBe(false);
  });

  it("accepts a completion patch when submitted catalog state is still current", () => {
    const current = parseCatalogDocument({
      selectedEnvironmentId: "prod",
      instancesByAlias: {
        jdbc1: { catalogId: "Jdbc", properties: { connectionId: "first", database: "appdb" } }
      }
    });
    const submitted = {
      payloadbuilder: {
        selectedEnvironmentId: "prod",
        catalogs: {
          jdbc1: {
            catalogId: "Jdbc",
            properties: { connectionId: "first", database: "appdb", password: "runtime-only" }
          }
        }
      }
    };
    const patch = {
      payloadbuilder: {
        catalogs: {
          jdbc1: { catalogId: "Jdbc", properties: { database: "reporting" } }
        }
      }
    };

    expect(isEngineStateCurrent(current, submitted, patch)).toBe(true);
  });

  it("rejects session-only completion metadata after catalog state changed", () => {
    const current = parseCatalogDocument({
      instancesByAlias: {
        mongo: { catalogId: "mongodb", properties: { connectionId: "current", legacyProperty: "persisted" } }
      }
    });
    const submitted = {
      payloadbuilder: {
        catalogs: {
          mongo: { catalogId: "mongodb", properties: { connectionId: "submitted" } }
        }
      }
    };

    expect(isEngineStateCurrent(current, submitted, {
      payloadbuilder: { sessionId: "12" }
    })).toBe(false);
  });

  it("rejects session-only completion metadata after environment changed", () => {
    const current = parseCatalogDocument({ selectedEnvironmentId: "prod" });
    const submitted = {
      payloadbuilder: {
        selectedEnvironmentId: "dev",
        catalogs: {}
      }
    };

    expect(isEngineStateCurrent(current, submitted, {
      payloadbuilder: { sessionId: "12" }
    })).toBe(false);
  });
});
