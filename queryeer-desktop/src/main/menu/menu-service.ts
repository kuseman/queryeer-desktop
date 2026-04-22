import { Menu, MenuItem, app, ipcMain } from "electron";
import type { MenuItemContribution } from "../../contracts/extensions/MenuExtension";

export type CommandInfo = {
  id: string;
  accelerator?: string;
};

const STANDARD_MENUS: Record<string, { role: Electron.MenuItemConstructorOptions["role"] }> = {
  "file": { role: "fileMenu" },
  "edit": { role: "editMenu" },
  "window": { role: "windowMenu" }
};

export class MenuService {
  private executeCommand: (commandId: string) => Promise<void> = async () => {};
  private menuItems: MenuItemContribution[] = [];
  private commands: CommandInfo[] = [];

  public wireIpc(): void {
    ipcMain.handle("menu:build", async (_event, items: unknown[], commands: unknown[]) => {
      try {
        this.menuItems = items as MenuItemContribution[];
        this.commands = commands as CommandInfo[];
        const menu = this.buildMenu();
        Menu.setApplicationMenu(menu);
        return { success: true };
      } catch (err) {
        console.error("[menu:build] Error:", err);
        return { success: false };
      }
    });
  }

  public setExecuteCommand(fn: (commandId: string) => Promise<void>): void {
    this.executeCommand = fn;
  }

  public buildMenu(): Menu {
    const menu = new Menu();

    const sortedItems = [...this.menuItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const rootItems = sortedItems
      .filter((item) => !item.parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    for (const item of rootItems) {
      const menuItem = this.createMenuItem(item);
      if (menuItem) {
        menu.append(menuItem);
      }
    }

    if (process.platform === "darwin") {
      menu.insert(0, new MenuItem({ label: app.name, role: "appMenu" }));
    }

    return menu;
  }

  private createMenuItem(contribution: MenuItemContribution): MenuItem | null {
    const children = this.menuItems
      .filter((item) => item.parentId === contribution.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const standardMenu = STANDARD_MENUS[contribution.id];
    if (standardMenu) {
      return new MenuItem({ label: contribution.label, role: standardMenu.role });
    }

    if (children.length > 0) {
      const submenu = new Menu();
      for (const child of children) {
        const childMenuItem = this.createMenuItem(child);
        if (childMenuItem) {
          submenu.append(childMenuItem);
        }
      }

      return new MenuItem({
        label: contribution.label,
        submenu
      });
    }

    const command = contribution.commandId
      ? this.commands.find((c) => c.id === contribution.commandId)
      : undefined;

    return new MenuItem({
      label: contribution.label,
      accelerator: command?.accelerator,
      click: () => {
        if (contribution.commandId) {
          void this.executeCommand(contribution.commandId);
        }
      }
    });
  }
}
