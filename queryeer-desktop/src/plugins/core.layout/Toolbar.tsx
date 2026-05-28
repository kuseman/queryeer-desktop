import type {
  LayoutActionIconRenderer,
  LayoutToolbarContribution,
  LayoutToolbarMenuContribution,
  LayoutToolbarSelectContribution,
  LayoutZone
} from "../../contracts/extensions/LayoutExtension";
import { GenericActionIcon, layoutToolbarIconMap } from "../../renderer/icons/LayoutIcons";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";
import { memo, useEffect, useState } from "react";

type ToolbarProps = {
  toolbarActions: LayoutToolbarContribution[];
  visibleZones: ReadonlySet<LayoutZone>;
  onToggleZone: (zone: LayoutZone) => void;
  canExecuteCommand: (commandId: string) => boolean;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  getCommandTitle: (commandId: string) => string | undefined;
  getCommandAccelerator: (commandId: string) => string | undefined;
};

const zoneToggleByCommand: Record<string, LayoutZone | undefined> = {
  "core.layout.togglePrimarySidebar": "primarySidebar",
  "core.layout.toggleSecondarySidebar": "secondarySidebar",
  "core.layout.togglePanel": "panel"
};

function ToolbarComponent({
  toolbarActions,
  visibleZones,
  onToggleZone,
  canExecuteCommand,
  executeCommand,
  getCommandTitle,
  getCommandAccelerator
}: ToolbarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".shell-toolbar-menu-wrap")) {
        return;
      }
      setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, []);
  const isZoneVisible = (zone: LayoutZone) => visibleZones.has(zone);
  const westActions = toolbarActions.filter((action) => (action.alignment ?? "west") === "west");
  const eastActions = toolbarActions.filter((action) => (action.alignment ?? "west") === "east");

  const renderIcon = (icon: string | LayoutActionIconRenderer | undefined) => {
    if (typeof icon === "function") {
      return <>{icon({ className: "shell-toolbar-icon" })}</>;
    }
    if (!icon) {
      return <GenericActionIcon className="shell-toolbar-icon" />;
    }
    const IconComponent = layoutToolbarIconMap[icon] ?? GenericActionIcon;
    return <IconComponent className="shell-toolbar-icon" />;
  };

  const renderSelect = (contribution: LayoutToolbarSelectContribution) => {
    if (contribution.isVisible && !contribution.isVisible()) {
      return null;
    }
    const options = contribution.getOptions();
    const value = contribution.getValue();
    const disabled = typeof contribution.disabled === "function"
      ? contribution.disabled()
      : (contribution.disabled ?? false);

    return (
      <label key={contribution.id} className="shell-toolbar-select-wrap" title={contribution.title}>
        {contribution.title ? <span className="shell-toolbar-select-label">{contribution.title}</span> : null}
        <select
          className="shell-toolbar-select"
          value={value}
          disabled={disabled || options.length === 0}
          onChange={(event) => {
            contribution.onChange(event.target.value);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const renderMenu = (contribution: LayoutToolbarMenuContribution) => {
    if (contribution.isVisible && !contribution.isVisible()) {
      return null;
    }
    const items = contribution.getItems();
    const disabled =
      typeof contribution.disabled === "function"
        ? contribution.disabled()
        : (contribution.disabled ?? false);
    const isOpen = openMenuId === contribution.id;

    return (
      <div key={contribution.id} className="shell-toolbar-menu-wrap">
        <button
          type="button"
          className="shell-toolbar-action"
          title={contribution.title}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          disabled={disabled || items.length === 0}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            setOpenMenuId((current) => (current === contribution.id ? null : contribution.id));
          }}
        >
          {renderIcon(contribution.icon)}
          <span>{contribution.title ?? "Menu"}</span>
        </button>
        {isOpen && items.length > 0 ? (
          <div className="shell-toolbar-menu" role="menu">
            {items.map((item) => (
              <button
                key={item.value}
                type="button"
                className="shell-context-menu__item shell-toolbar-menu-item"
                onClick={() => {
                  contribution.onSelect(item.value);
                  setOpenMenuId(null);
                }}
              >
                {renderIcon(item.icon)}
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderAction = (action: LayoutToolbarContribution) => {
    if (action.type === "separator") {
      return <span key={action.id} className="shell-toolbar-separator" role="separator" aria-hidden="true" />;
    }

    if (action.type === "select") {
      return renderSelect(action);
    }

    if (action.type === "menu") {
      return renderMenu(action);
    }

    const zoneToggle = zoneToggleByCommand[action.commandId];
    const isZoneToggle = zoneToggle !== undefined;
    const isDisabled = isZoneToggle ? false : !canExecuteCommand(action.commandId);
    const label = action.title ?? getCommandTitle(action.commandId);
    const accelerator = getCommandAccelerator(action.commandId);
    const tooltip = label ? (accelerator ? `${label} (${accelerator})` : label) : undefined;
    const isActive = zoneToggle ? isZoneVisible(zoneToggle) : (action.pressed?.() ?? false);

    return (
      <button
        key={action.id}
        type="button"
        className={`shell-toolbar-action ${isActive ? "is-active" : ""}`}
        title={tooltip}
        aria-label={tooltip ?? action.commandId}
        disabled={isDisabled}
        aria-pressed={zoneToggle || action.pressed ? isActive : undefined}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          if (isDisabled) {
            return;
          }
          const zoneToggle = zoneToggleByCommand[action.commandId];
          if (zoneToggle) {
            onToggleZone(zoneToggle);
            return;
          }
          void executeCommand(action.commandId);
        }}
      >
        {renderIcon(action.icon)}
        {action.title ? <span>{action.title}</span> : null}
      </button>
    );
  };

  return (
    <section className="shell-toolbar" aria-label="Tool bar">
      {toolbarActions.length === 0 ? (
        <span className="shell-toolbar-empty">No toolbar actions contributed yet.</span>
      ) : (
        <>
          <div className="shell-toolbar-group shell-toolbar-group-west">
            {westActions.map(renderAction)}
          </div>
          <div className="shell-toolbar-group shell-toolbar-group-east">
            {eastActions.map(renderAction)}
          </div>
        </>
      )}
    </section>
  );
}

export const Toolbar = memo(ToolbarComponent);
