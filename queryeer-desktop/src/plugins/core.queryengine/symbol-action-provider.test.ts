import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { SymbolAction } from "./symbol-action-types";

const mocks = vi.hoisted(() => ({
  resolveSymbolAtPositionMock: vi.fn(),
  actions: [] as SymbolAction[]
}));

vi.mock("./symbol-action-invoke", () => ({
  resolveSymbolAtPosition: mocks.resolveSymbolAtPositionMock
}));

vi.mock("./symbol-action-registry", () => ({
  getSymbolActionRegistry: () => ({
    getSymbolActions: () => mocks.actions
  })
}));

import { SymbolActionProvider } from "./symbol-action-provider";

function materializeFunctions(value: unknown): unknown {
  if (typeof value === "string") {
    return Function(`return (${value});`)();
  }
  if (Array.isArray(value)) {
    return value.map((item) => materializeFunctions(item));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = materializeFunctions(item);
    }
    return next;
  }
  return value;
}

describe("SymbolActionProvider", () => {
  const originalAppShell = window.appShell;
  const file: FileEntity = {
    fileId: "file-1",
    version: 1,
    uri: "file:///query.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date(0).toISOString()
  };

  beforeEach(() => {
    mocks.resolveSymbolAtPositionMock.mockReset();
    mocks.actions.length = 0;
    window.appShell = {
      ...originalAppShell,
      evaluateExpression: async (params) => {
        const keys = Object.keys(params.context);
        const values = Object.values(params.context);
        const fn = materializeFunctions(params.functions);
        return Function(...keys, "fn", `return (${params.expression});`)(...values, fn);
      }
    };
  });

  afterEach(() => {
    window.appShell = originalAppShell;
  });

  it("exposes symbol fullName and attributes to query templates", async () => {
    const executeQuery = vi.fn(async () => {});
    const provider = new SymbolActionProvider({
      getFile: () => file,
      getModelContent: () => "select * from sales.dbo.orders",
      isQueryRunning: () => false,
      executeQuery
    });
    mocks.resolveSymbolAtPositionMock.mockResolvedValue({
      kind: "table",
      name: "dbo.orders",
      fullName: "sa]les.dbo.orders",
      detail: "TABLE",
      attributes: { database: "sa]les", schema: "dbo", name: "orders" }
    });
    mocks.actions.push({
      id: "describe",
      label: "Describe",
      when: "",
      query: "select '${symbol.fullName}' /* ${symbol.attributes.database}.${symbol.attributes.name} */"
    });

    const items = await provider.getItems({
      fileId: "file-1",
      mimeType: "application/sql",
      selection: null,
      position: { lineNumber: 1, column: 22 }
    });

    items[0]?.run();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executeQuery).toHaveBeenCalledWith(
      "file-1",
      "select 'sa]les.dbo.orders' /* sa]les.orders */"
    );
  });
});
