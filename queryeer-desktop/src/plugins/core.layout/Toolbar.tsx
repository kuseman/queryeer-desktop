import type { LayoutToolbarActionContribution, LayoutZone } from "../../contracts/extensions/LayoutExtension";
import { GenericActionIcon, layoutToolbarIconMap } from "../../renderer/icons/LayoutIcons";

type ToolbarProps = {
  toolbarActions: LayoutToolbarActionContribution[];
  visibleZones: ReadonlySet<LayoutZone>;
  onToggleZone: (zone: LayoutZone) => void;
  canExecuteCommand: (commandId: string) => boolean;
};

const zoneToggleByCommand: Record<string, "primarySidebar" | "secondarySidebar" | undefined> = {
  "core.layout.togglePrimarySidebar": "primarySidebar",
  "core.layout.toggleSecondarySidebar": "secondarySidebar"
};

export function Toolbar({ toolbarActions, visibleZones, onToggleZone, canExecuteCommand }: ToolbarProps) {
  const isZoneVisible = (zone: LayoutZone) => visibleZones.has(zone);

  const renderIcon = (icon: string | undefined) => {
    if (!icon) {
      return <GenericActionIcon className="shell-toolbar-icon" />;
    }
    const IconComponent = layoutToolbarIconMap[icon] ?? GenericActionIcon;
    return <IconComponent className="shell-toolbar-icon" />;
  };

  return (
    <section className="shell-toolbar" aria-label="Tool bar">
      {toolbarActions.length === 0 ? (
        <span className="shell-toolbar-empty">No toolbar actions contributed yet.</span>
      ) : (
        toolbarActions.map((action) => (
          (() => {
            const isDisabled = !canExecuteCommand(action.commandId);
            return (
          <button
            key={action.id}
            type="button"
            className={`shell-toolbar-action ${
              zoneToggleByCommand[action.commandId] && isZoneVisible(zoneToggleByCommand[action.commandId] as "primarySidebar" | "secondarySidebar")
                ? "is-active"
                : ""
            }`}
            title={action.title}
            disabled={isDisabled}
            aria-pressed={
              zoneToggleByCommand[action.commandId]
                ? isZoneVisible(zoneToggleByCommand[action.commandId] as "primarySidebar" | "secondarySidebar")
                : undefined
            }
            onClick={() => {
              if (isDisabled) {
                return;
              }
              if (action.commandId === "core.layout.togglePrimarySidebar") {
                onToggleZone("primarySidebar");
                return;
              }
              if (action.commandId === "core.layout.toggleSecondarySidebar") {
                onToggleZone("secondarySidebar");
                return;
              }
            }}
          >
            {renderIcon(action.icon)}
            <span>{action.title}</span>
          </button>
            );
          })()
        ))
      )}
    </section>
  );
}
