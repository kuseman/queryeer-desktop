import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setApplicationMenuMock: vi.fn()
}));

vi.mock("electron", () => {
  class MockMenu {
    public items: MockMenuItem[] = [];

    append(item: MockMenuItem): void {
      this.items.push(item);
    }

    insert(index: number, item: MockMenuItem): void {
      this.items.splice(index, 0, item);
    }
  }

  class MockMenuItem {
    public readonly label?: string;
    public readonly submenu?: MockMenu;
    public readonly click?: () => void;
    public readonly role?: string;

    constructor(options: {
      label?: string;
      submenu?: MockMenu;
      click?: () => void;
      role?: string;
    }) {
      this.label = options.label;
      this.submenu = options.submenu;
      this.click = options.click;
      this.role = options.role;
    }
  }

  return {
    Menu: Object.assign(MockMenu, {
      setApplicationMenu: mocks.setApplicationMenuMock
    }),
    MenuItem: MockMenuItem,
    app: { name: "Queryeer" },
    ipcMain: {
      handle: vi.fn()
    }
  };
});

import { MenuService } from "./menu-service.js";

describe("MenuService", () => {
  beforeEach(() => {
    mocks.setApplicationMenuMock.mockReset();
  });

  it("submenu parent keeps click handler when commandId is present", async () => {
    const service = new MenuService();
    const executed: string[] = [];
    service.setExecuteCommand(async (commandId: string) => {
      executed.push(commandId);
    });

    (service as unknown as { menuItems: unknown[] }).menuItems = [
      {
        id: "test.root",
        label: "Root"
      },
      {
        id: "core.files.menu.new",
        parentId: "test.root",
        label: "New",
        type: "submenu",
        commandId: "core.files.new"
      },
      {
        id: "core.files.menu.new.sql",
        parentId: "core.files.menu.new",
        label: "SQL",
        commandId: "core.files.new.fromMime.application/sql"
      }
    ];

    const menu = service.buildMenu() as unknown as {
      items: Array<{
        submenu?: {
          items: Array<{ label?: string; click?: () => void }>;
        };
      }>;
    };

    const rootItem = menu.items.find((item) => item.submenu?.items.some((child) => child.label === "New"));
    const newItem = rootItem?.submenu?.items.find((item) => item.label === "New");
    expect(newItem).toBeDefined();
    expect(typeof newItem?.click).toBe("function");

    newItem?.click?.();
    await Promise.resolve();

    expect(executed).toContain("core.files.new");
  });
});
