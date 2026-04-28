import { useEffect, useMemo, useState } from "react";
import type { KeybindingContribution } from "../../contracts/extensions/KeybindingExtension";
import type { MenuItemContribution } from "../../contracts/extensions/MenuExtension";
import queryeerLogoUrl from "../../assets/icons/queryeer-logo.svg";
import { layoutToolbarIconMap } from "../../renderer/icons/LayoutIcons";
import {
  normalizeAcceleratorForPlatform,
  resolveGlobalAcceleratorsByCommand
} from "../../renderer/shell/accelerator-utils";

type CoreMenuBarProps = {
  menuItems: MenuItemContribution[];
  keybindings: KeybindingContribution[];
  executeCommand: (commandId: string) => Promise<unknown>;
  canExecuteCommand: (commandId: string) => boolean;
};

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function CoreMenuBar({ menuItems, keybindings, executeCommand, canExecuteCommand }: CoreMenuBarProps): JSX.Element {
  const [openPath, setOpenPath] = useState<string[]>([]);
  const [focusPath, setFocusPath] = useState<string[]>([]);
  const [menuBarFocused, setMenuBarFocused] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  const sortedItems = useMemo(
    () => [...menuItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [menuItems]
  );

  const rootItems = useMemo(() => sortedItems.filter((item) => !item.parentId), [sortedItems]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, MenuItemContribution[]>();
    for (const item of sortedItems) {
      if (!item.parentId) {
        continue;
      }
      const next = map.get(item.parentId) ?? [];
      next.push(item);
      map.set(item.parentId, next);
    }
    for (const [parentId, children] of map.entries()) {
      map.set(parentId, [...children].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    }
    return map;
  }, [sortedItems]);

  const itemById = useMemo(() => {
    const map = new Map<string, MenuItemContribution>();
    for (const item of sortedItems) {
      map.set(item.id, item);
    }
    return map;
  }, [sortedItems]);

  const acceleratorByCommand = useMemo(() => {
    const platform = window.appShell.platform;
    const map = new Map<string, string>();
    for (const item of sortedItems) {
      if (item.accelerator) {
        map.set(item.commandId ?? item.id, normalizeAcceleratorForPlatform(item.accelerator, platform));
      }
    }
    const globalFallback = resolveGlobalAcceleratorsByCommand(keybindings, platform);
    for (const [commandId, accelerator] of globalFallback.entries()) {
      if (!map.has(commandId)) {
        map.set(commandId, accelerator);
      }
    }
    return map;
  }, [keybindings, sortedItems]);

  const getChildren = (id: string): MenuItemContribution[] => {
    return childrenByParent.get(id) ?? [];
  };

  const getFocusableChildren = (id: string): MenuItemContribution[] => {
    return getChildren(id).filter((item) => item.type !== "separator");
  };

  const openRoot = (rootId: string) => {
    const rootChildren = getFocusableChildren(rootId);
    setMenuBarFocused(true);
    if (rootChildren.length === 0) {
      setOpenPath([]);
      setFocusPath([rootId]);
      return;
    }
    setOpenPath([rootId]);
    setFocusPath([rootId, rootChildren[0]!.id]);
  };

  const closeMenus = (keepMenuFocus: boolean) => {
    setOpenPath([]);
    setFocusPath((previous) => {
      const rootId = previous[0] ?? rootItems[0]?.id;
      if (!rootId || !keepMenuFocus) {
        return [];
      }
      return [rootId];
    });
    setMenuBarFocused(keepMenuFocus);
  };

  const executeItem = (itemId: string) => {
    const item = itemById.get(itemId);
    if (!item?.commandId) {
      closeMenus(false);
      return;
    }
    if (!canExecuteCommand(item.commandId)) {
      void executeCommand(item.commandId);
      closeMenus(false);
      return;
    }
    void executeCommand(item.commandId);
    closeMenus(false);
  };

  const cycleRoot = (direction: 1 | -1) => {
    if (rootItems.length === 0) {
      return;
    }
    const currentRootId = focusPath[0] ?? rootItems[0]!.id;
    const currentIndex = rootItems.findIndex((item) => item.id === currentRootId);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + direction + rootItems.length) % rootItems.length;
    const nextRoot = rootItems[nextIndex]!;

    if (openPath.length > 0) {
      openRoot(nextRoot.id);
      return;
    }

    setMenuBarFocused(true);
    setFocusPath([nextRoot.id]);
  };

  const moveWithinOpenMenu = (direction: 1 | -1) => {
    const depth = focusPath.length - 1;
    if (depth < 1) {
      return;
    }

    const parentId = openPath[depth - 1];
    if (!parentId) {
      return;
    }
    const siblings = getFocusableChildren(parentId);
    if (siblings.length === 0) {
      return;
    }

    const currentId = focusPath[depth];
    const currentIndex = siblings.findIndex((item) => item.id === currentId);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + direction + siblings.length) % siblings.length;
    const nextItem = siblings[nextIndex]!;

    setFocusPath((previous) => [...previous.slice(0, depth), nextItem.id]);
    setOpenPath((previous) => previous.slice(0, depth));
  };

  const openFocusedSubmenu = () => {
    const focusedId = focusPath[focusPath.length - 1];
    if (!focusedId) {
      return;
    }
    const children = getFocusableChildren(focusedId);
    if (children.length === 0) {
      return;
    }
    const depth = focusPath.length - 1;
    setOpenPath((previous) => [...previous.slice(0, depth), focusedId]);
    setFocusPath((previous) => [...previous, children[0]!.id]);
  };

  const activateFocused = () => {
    const focusedId = focusPath[focusPath.length - 1];
    if (!focusedId) {
      return;
    }
    const focusedItem = itemById.get(focusedId);
    if (focusedItem?.type === "separator") {
      return;
    }
    if (getChildren(focusedId).length > 0) {
      openFocusedSubmenu();
      return;
    }
    executeItem(focusedId);
  };

  useEffect(() => {
    void window.appShell.isWindowMaximized().then(setIsWindowMaximized);
    return window.appShell.onWindowStateChanged((state) => {
      setIsWindowMaximized(state.maximized);
    });
  }, []);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".shell-titlebar")) {
        return;
      }
      closeMenus(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [rootItems]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const active = menuBarFocused || openPath.length > 0;
      const inputTarget = isTextInputTarget(event.target);

      if (event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        if (active) {
          closeMenus(false);
          return;
        }
        if (rootItems.length > 0) {
          setMenuBarFocused(true);
          setFocusPath([rootItems[0]!.id]);
        }
        return;
      }

      if (!active) {
        return;
      }

      if (inputTarget && event.key !== "Escape") {
        return;
      }

      switch (event.key) {
        case "Escape": {
          event.preventDefault();
          if (openPath.length > 0) {
            closeMenus(true);
          } else {
            closeMenus(false);
          }
          return;
        }
        case "ArrowRight": {
          event.preventDefault();
          if (openPath.length === 0) {
            cycleRoot(1);
            return;
          }
          if (focusPath.length === 1) {
            cycleRoot(1);
            return;
          }
          openFocusedSubmenu();
          return;
        }
        case "ArrowLeft": {
          event.preventDefault();
          if (openPath.length <= 1) {
            cycleRoot(-1);
            return;
          }
          setOpenPath((previous) => previous.slice(0, -1));
          setFocusPath((previous) => previous.slice(0, -1));
          return;
        }
        case "ArrowDown": {
          event.preventDefault();
          if (openPath.length === 0) {
            const rootId = focusPath[0] ?? rootItems[0]?.id;
            if (rootId) {
              openRoot(rootId);
            }
            return;
          }
          moveWithinOpenMenu(1);
          return;
        }
        case "ArrowUp": {
          event.preventDefault();
          if (openPath.length === 0) {
            const rootId = focusPath[0] ?? rootItems[rootItems.length - 1]?.id;
            if (rootId) {
              openRoot(rootId);
            }
            return;
          }
          moveWithinOpenMenu(-1);
          return;
        }
        case "Enter":
        case " ": {
          event.preventDefault();
          if (openPath.length === 0) {
            const rootId = focusPath[0] ?? rootItems[0]?.id;
            if (rootId) {
              openRoot(rootId);
            }
            return;
          }
          activateFocused();
          return;
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusPath, menuBarFocused, openPath, rootItems]);

  const renderSubmenu = (parentId: string, depth: number): JSX.Element | null => {
    const items = getChildren(parentId);
    if (items.length === 0) {
      return null;
    }

    return (
      <div className={`shell-titlebar-dropdown ${depth > 1 ? "is-nested" : ""}`} role="menu">
        {items.map((item) => {
          if (item.type === "separator") {
            return (
              <div key={item.id} className="shell-titlebar-dropdown-entry shell-titlebar-dropdown-entry-separator">
                <div className="shell-titlebar-dropdown-separator" role="separator" aria-hidden="true" />
              </div>
            );
          }

          const hasChildren = getChildren(item.id).length > 0;
          const isDisabled = item.commandId ? !canExecuteCommand(item.commandId) : false;
          const isFocused = focusPath[depth] === item.id;
          const isOpen = openPath[depth] === item.id;
          return (
            <div key={item.id} className="shell-titlebar-dropdown-entry">
              <button
                type="button"
                className={`shell-titlebar-dropdown-item ${isFocused ? "is-focused" : ""}`}
                disabled={isDisabled}
                onMouseEnter={() => {
                  setMenuBarFocused(true);
                  setFocusPath((previous) => [...previous.slice(0, depth), item.id]);
                  if (hasChildren) {
                    const children = getFocusableChildren(item.id);
                    setOpenPath((previous) => [...previous.slice(0, depth), item.id]);
                    if (children.length > 0) {
                      setFocusPath((previous) => [...previous.slice(0, depth), item.id, children[0]!.id]);
                    }
                    return;
                  }
                  setOpenPath((previous) => previous.slice(0, depth));
                }}
                onClick={() => {
                  if (hasChildren) {
                    const children = getFocusableChildren(item.id);
                    setOpenPath((previous) => [...previous.slice(0, depth), item.id]);
                    if (children.length > 0) {
                      setFocusPath((previous) => [...previous.slice(0, depth), item.id, children[0]!.id]);
                    }
                    return;
                  }
                  executeItem(item.id);
                }}
              >
                <span className="shell-titlebar-dropdown-label-wrap">
                  {renderIcon(item.icon)}
                  <span className="shell-titlebar-dropdown-label">{item.label}</span>
                </span>
                <span className="shell-titlebar-dropdown-tail">
                  <span className="shell-titlebar-dropdown-accelerator">
                    {acceleratorByCommand.get(item.commandId ?? item.id) ?? ""}
                  </span>
                  {hasChildren ? <span className="shell-titlebar-dropdown-chevron">&gt;</span> : null}
                </span>
              </button>
              {hasChildren && isOpen ? renderSubmenu(item.id, depth + 1) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <header className="shell-titlebar">
      <div className="shell-titlebar-brand" aria-hidden="true">
        <img className="shell-titlebar-logo" src={queryeerLogoUrl} alt="" />
      </div>

      <nav className="shell-titlebar-menu" aria-label="Application menu">
        {rootItems.map((item) => {
          const isFocused = focusPath[0] === item.id;
          const isOpen = openPath[0] === item.id;
          const hasChildren = getChildren(item.id).length > 0;
          return (
            <div key={item.id} className="shell-titlebar-menu-root">
              <button
                type="button"
                className={`shell-titlebar-menu-item ${isFocused ? "is-focused" : ""} ${
                  isOpen ? "is-open" : ""
                }`}
                disabled={item.commandId ? !canExecuteCommand(item.commandId) : false}
                onClick={() => {
                  if (!hasChildren) {
                    executeItem(item.id);
                    return;
                  }
                  if (isOpen) {
                    closeMenus(true);
                    return;
                  }
                  openRoot(item.id);
                }}
                onMouseEnter={() => {
                  setMenuBarFocused(true);
                  setFocusPath([item.id]);
                  if (openPath.length > 0) {
                    openRoot(item.id);
                  }
                }}
              >
                {item.label}
              </button>
              {isOpen ? renderSubmenu(item.id, 1) : null}
            </div>
          );
        })}
      </nav>

      <div className="shell-titlebar-drag" />

      <div className="shell-titlebar-controls">
        <button
          type="button"
          className="shell-titlebar-control"
          aria-label="Minimize"
          onClick={() => window.appShell.windowMinimize()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          className="shell-titlebar-control"
          aria-label={isWindowMaximized ? "Restore" : "Maximize"}
          onClick={() => window.appShell.windowMaximize()}
        >
          {isWindowMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="2" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M2 3H1v8h8v-1" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="shell-titlebar-control shell-titlebar-control-close"
          aria-label="Close"
          onClick={() => window.appShell.windowClose()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1" />
            <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </header>
  );
}
  const renderIcon = (icon: string | undefined): JSX.Element => {
    if (!icon) {
      return <span className="shell-titlebar-dropdown-icon shell-titlebar-dropdown-icon-empty" aria-hidden="true" />;
    }
    const IconComponent = layoutToolbarIconMap[icon];
    if (!IconComponent) {
      return <span className="shell-titlebar-dropdown-icon shell-titlebar-dropdown-icon-empty" aria-hidden="true" />;
    }
    return <IconComponent className="shell-titlebar-dropdown-icon" />;
  };
