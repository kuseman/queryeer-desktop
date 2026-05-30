import type { LayoutStatusItemContribution } from "@queryeer/api/extensions/LayoutExtension";
import type { CommandExecutionResult } from "@queryeer/api/plugin/Plugin";

type StatusBarProps = {
  statusItemsLeft: LayoutStatusItemContribution[];
  statusItemsRight: LayoutStatusItemContribution[];
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  canExecuteCommand: (commandId: string) => boolean;
};

export function StatusBar({ statusItemsLeft, statusItemsRight, executeCommand, canExecuteCommand }: StatusBarProps) {
  return (
    <footer className="shell-status-bar" aria-label="Status bar">
      <div className="shell-status-bar-left">
        {statusItemsLeft.map((item) => (
          <div key={item.id} className="shell-status-item">
            <StatusItemContent item={item} executeCommand={executeCommand} canExecuteCommand={canExecuteCommand} />
          </div>
        ))}
      </div>
      <div className="shell-status-bar-right">
        {statusItemsRight.map((item) => (
          <div key={item.id} className="shell-status-item">
            <StatusItemContent item={item} executeCommand={executeCommand} canExecuteCommand={canExecuteCommand} />
          </div>
        ))}
      </div>
    </footer>
  );
}

type StatusItemContentProps = {
  item: LayoutStatusItemContribution;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  canExecuteCommand: (commandId: string) => boolean;
};

export function StatusItemContent({ item, executeCommand, canExecuteCommand }: StatusItemContentProps) {
  if (!item.commandId) {
    return <>{item.render()}</>;
  }
  const isDisabled = !canExecuteCommand(item.commandId);
  return (
    <span
      role="button"
      className="shell-status-item-interactive"
      tabIndex={0}
      aria-disabled={isDisabled}
      onClick={() => {
        if (isDisabled) {
          return;
        }
        void executeCommand(item.commandId!);
      }}
      onKeyDown={(e) => {
        if (isDisabled) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          void executeCommand(item.commandId!);
        }
      }}
    >
      {item.render()}
    </span>
  );
}
