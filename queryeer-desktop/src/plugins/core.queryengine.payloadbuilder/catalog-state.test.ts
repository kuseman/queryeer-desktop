import { describe, expect, it } from "vitest";
import {
  applyEngineStatePatch,
  emptyCatalogDocument,
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
});
