import { describe, expect, it } from "vitest";
import type { JdbcSchemaObject } from "./jdbc-navigation-types";
import { collectObjects, searchableObjectNames, toObjectDetail } from "./jdbc-assistant-tools";

describe("jdbc assistant tools", () => {
  it("collects tables and views with database and schema path", () => {
    const snapshot: JdbcSchemaObject[] = [{
      id: "database:SalesDb",
      name: "SalesDb",
      kind: "database",
      attributes: {},
      children: [{
        id: "SalesDb.dbo",
        name: "dbo",
        kind: "schema",
        attributes: { catalog: "SalesDb" },
        children: [
          {
            id: "SalesDb.dbo.Customer",
            name: "Customer",
            kind: "table",
            fullName: "dbo.Customer",
            attributes: { catalog: "SalesDb", schema: "dbo" },
            children: [{ id: "col:id", name: "id", kind: "column", attributes: { type: "int" } }]
          },
          {
            id: "SalesDb.dbo.ActiveCustomer",
            name: "ActiveCustomer",
            kind: "view",
            fullName: "dbo.ActiveCustomer",
            attributes: { catalog: "SalesDb", schema: "dbo" },
            children: []
          },
          {
            id: "proc:sync",
            name: "sync",
            kind: "procedure",
            attributes: {},
            children: []
          }
        ]
      }]
    }];

    expect(collectObjects(snapshot).map(({ object: _object, ...match }) => match)).toEqual([
      {
        name: "Customer",
        kind: "table",
        fullName: "dbo.Customer",
        database: "SalesDb",
        schema: "dbo"
      },
      {
        name: "ActiveCustomer",
        kind: "view",
        fullName: "dbo.ActiveCustomer",
        database: "SalesDb",
        schema: "dbo"
      }
    ]);
  });

  it("surfaces primary and foreign keys from cached snapshot children", () => {
    const table: JdbcSchemaObject = {
      id: "SalesDb.dbo.OrderLine",
      name: "OrderLine",
      kind: "table",
      fullName: "dbo.OrderLine",
      attributes: { catalog: "SalesDb", schema: "dbo" },
      children: []
    };
    const children: JdbcSchemaObject[] = [
      { id: "col:id", name: "id", kind: "column", attributes: { type: "int", primaryKey: true } },
      { id: "col:order_id", name: "order_id", kind: "column", attributes: { type: "int", foreignKey: true, referencesTable: "Order", referencesColumn: "id" } },
      { id: "pk:orderline", name: "PK_OrderLine", kind: "primary_key", attributes: { column: "id" } },
      { id: "fk:orderline_order", name: "FK_OrderLine_Order", kind: "foreign_key", attributes: { column: "order_id", referencesTable: "Order", referencesColumn: "id" } },
      {
        id: "idx:orderline_order",
        name: "IX_OrderLine_Order",
        kind: "index",
        attributes: { unique: false },
        children: [{ id: "idxcol:orderline_order:order_id", name: "order_id", kind: "index_column", attributes: { ordinal: 1, sortOrder: "DESC" } }]
      }
    ];

    const detail = toObjectDetail({
      name: table.name,
      kind: table.kind,
      fullName: table.fullName,
      database: "SalesDb",
      schema: "dbo",
      object: table
    }, children);

    expect(detail.primaryKeys).toEqual([
      { name: "PK_OrderLine", column: "id", attributes: { column: "id" } },
      { column: "id", attributes: { type: "int", primaryKey: true } }
    ]);
    expect(detail.foreignKeys).toEqual([
      { name: "FK_OrderLine_Order", column: "order_id", referencesTable: "Order", referencesColumn: "id", attributes: { column: "order_id", referencesTable: "Order", referencesColumn: "id" } },
      { column: "order_id", referencesTable: "Order", referencesColumn: "id", attributes: { type: "int", foreignKey: true, referencesTable: "Order", referencesColumn: "id" } }
    ]);
    expect(detail.indices).toEqual([
      {
        name: "IX_OrderLine_Order",
        columns: [{ name: "order_id", ordinal: 1, sortOrder: "DESC", attributes: { ordinal: 1, sortOrder: "DESC" } }],
        attributes: { unique: false }
      }
    ]);
  });

  it("surfaces columns and indexes nested under metadata folders", () => {
    const table: JdbcSchemaObject = {
      id: "SalesDb.dbo.OrderLine",
      name: "OrderLine",
      kind: "table",
      fullName: "dbo.OrderLine",
      attributes: { catalog: "SalesDb", schema: "dbo" },
      children: []
    };
    const children: JdbcSchemaObject[] = [
      {
        id: "columns_folder:SalesDb:dbo:OrderLine",
        name: "Columns",
        kind: "columns_folder",
        attributes: { catalog: "SalesDb", schema: "dbo", table: "OrderLine" },
        children: [{ id: "col:id", name: "id", kind: "column", attributes: { type: "int", primaryKey: true } }]
      },
      {
        id: "indexes_folder:SalesDb:dbo:OrderLine",
        name: "Indexes",
        kind: "indexes_folder",
        attributes: { catalog: "SalesDb", schema: "dbo", table: "OrderLine" },
        children: [{
          id: "idx:orderline_id",
          name: "IX_OrderLine_Id",
          kind: "index",
          attributes: {},
          children: [{ id: "idxcol:orderline_id:id", name: "id", kind: "index_column", attributes: { ordinal: 1, sortOrder: "ASC" } }]
        }]
      }
    ];

    const detail = toObjectDetail({
      name: table.name,
      kind: table.kind,
      fullName: table.fullName,
      database: "SalesDb",
      schema: "dbo",
      object: table
    }, children);

    expect(detail.columns).toEqual([{ name: "id", type: "int", nullable: undefined, attributes: { type: "int", primaryKey: true } }]);
    expect(detail.primaryKeys).toEqual([{ column: "id", attributes: { type: "int", primaryKey: true } }]);
    expect(detail.indices).toEqual([{
      name: "IX_OrderLine_Id",
      columns: [{ name: "id", ordinal: 1, sortOrder: "ASC", attributes: { ordinal: 1, sortOrder: "ASC" } }],
      attributes: {}
    }]);
    expect(detail.properties).toEqual([]);
  });

  it("does not use database name as searchable object text", () => {
    const snapshot: JdbcSchemaObject[] = [{
      id: "database:ProductService",
      name: "ProductService",
      kind: "database",
      attributes: {},
      children: [{
        id: "ProductService.dbo",
        name: "dbo",
        kind: "schema",
        attributes: { catalog: "ProductService" },
        children: [{
          id: "ProductService.dbo.Customer",
          name: "Customer",
          kind: "table",
          fullName: "dbo.Customer",
          attributes: { catalog: "ProductService", schema: "dbo" },
          children: []
        }]
      }]
    }];

    const match = collectObjects(snapshot)[0]!;

    expect(searchableObjectNames(match)).toEqual(["Customer", "dbo.Customer", "dbo.Customer"]);
    expect(searchableObjectNames(match)).not.toContain("ProductService.dbo.Customer");
  });
});
