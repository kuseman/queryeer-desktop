import type { LayoutStatusItemContribution } from "../../contracts/extensions/LayoutExtension";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";

type StatusBarProps = {
  statusItemsLeft: LayoutStatusItemContribution[];
  statusItemsRight: LayoutStatusItemContribution[];
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
};

export function StatusBar({ statusItemsLeft, statusItemsRight, executeCommand }: StatusBarProps) {
  return (
    <footer className="shell-status-bar" aria-label="Status bar">
      <div className="shell-status-bar-left">
        {statusItemsLeft.map((item) => (
          <div key={item.id} className="shell-status-item">
            <StatusItemContent item={item} executeCommand={executeCommand} />
          </div>
        ))}
      </div>
      <div className="shell-status-bar-right">
        {statusItemsRight.map((item) => (
          <div key={item.id} className="shell-status-item">
            <StatusItemContent item={item} executeCommand={executeCommand} />
          </div>
        ))}
      </div>
    </footer>
  );
}

type StatusItemContentProps = {
  item: LayoutStatusItemContribution;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
};

export function StatusItemContent({ item, executeCommand }: StatusItemContentProps) {
  if (!item.commandId) {
    return <>{item.render()}</>;
  }
  return (
    <span
      role="button"
      className="shell-status-item-interactive"
      tabIndex={0}
      onClick={() => {
        void executeCommand(item.commandId!);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          void executeCommand(item.commandId!);
        }
      }}
    >
      {item.render()}
    </span>
  );
}