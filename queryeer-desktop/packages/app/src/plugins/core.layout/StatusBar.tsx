import type { LayoutStatusItemContribution } from "@queryeer/api/extensions/LayoutExtension";
import type { CommandExecutionResult } from "@queryeer/api/plugin/Plugin";
import PluginErrorBoundary from "./PluginErrorBoundary";
import { memo } from "react";

type StatusBarProps = {
  statusItemsLeft: LayoutStatusItemContribution[];
  statusItemsRight: LayoutStatusItemContribution[];
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  canExecuteCommand: (commandId: string) => boolean;
};

function StatusBarComponent({ statusItemsLeft, statusItemsRight, executeCommand, canExecuteCommand }: StatusBarProps) {
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

export const StatusBar = memo(StatusBarComponent);

type StatusItemContentProps = {
  item: LayoutStatusItemContribution;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  canExecuteCommand: (commandId: string) => boolean;
};

function StatusItemContentComponent({ item, executeCommand, canExecuteCommand }: StatusItemContentProps) {
  if (!item.commandId) {
    return <PluginErrorBoundary pluginId={item.id}>{item.render()}</PluginErrorBoundary>;
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
      <PluginErrorBoundary pluginId={item.id}>{item.render()}</PluginErrorBoundary>
    </span>
  );
}

export const StatusItemContent = memo(StatusItemContentComponent);
