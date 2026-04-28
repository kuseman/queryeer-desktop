import type { LayoutActionIconRenderer, LayoutToolbarContribution, LayoutZone } from "../../contracts/extensions/LayoutExtension";
import { GenericActionIcon, layoutToolbarIconMap } from "../../renderer/icons/LayoutIcons";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";

type ToolbarProps = {
  toolbarActions: LayoutToolbarContribution[];
  visibleZones: ReadonlySet<LayoutZone>;
  onToggleZone: (zone: LayoutZone) => void;
  canExecuteCommand: (commandId: string) => boolean;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  getCommandTitle: (commandId: string) => string | undefined;
  getCommandAccelerator: (commandId: string) => string | undefined;
};

const zoneToggleByCommand: Record<string, "primarySidebar" | "secondarySidebar" | undefined> = {
  "core.layout.togglePrimarySidebar": "primarySidebar",
  "core.layout.toggleSecondarySidebar": "secondarySidebar"
};

function isSidebarZone(zone: LayoutZone): zone is "primarySidebar" | "secondarySidebar" {
  return zone === "primarySidebar" || zone === "secondarySidebar";
}

export function Toolbar({
  toolbarActions,
  visibleZones,
  onToggleZone,
  canExecuteCommand,
  executeCommand,
  getCommandTitle,
  getCommandAccelerator
}: ToolbarProps) {
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

  const renderAction = (action: LayoutToolbarContribution) => {
    if (action.type === "separator") {
      return <span key={action.id} className="shell-toolbar-separator" role="separator" aria-hidden="true" />;
    }

    const zoneToggle = zoneToggleByCommand[action.commandId];
    const isZoneToggle = zoneToggle !== undefined;
    const isDisabled = isZoneToggle ? false : !canExecuteCommand(action.commandId);
    const label = action.title ?? getCommandTitle(action.commandId);
    const accelerator = getCommandAccelerator(action.commandId);
    const tooltip = label ? (accelerator ? `${label} (${accelerator})` : label) : undefined;
    const isActive = zoneToggle ? isZoneVisible(zoneToggle) : false;

    return (
      <button
        key={action.id}
        type="button"
        className={`shell-toolbar-action ${isActive ? "is-active" : ""}`}
        title={tooltip}
        aria-label={tooltip ?? action.commandId}
        disabled={isDisabled}
        aria-pressed={zoneToggle ? isActive : undefined}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          if (isDisabled) {
            return;
          }
          const zoneToggle = zoneToggleByCommand[action.commandId];
          if (zoneToggle && isSidebarZone(zoneToggle)) {
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
