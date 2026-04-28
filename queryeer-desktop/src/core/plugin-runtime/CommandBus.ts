import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";
import { evaluateWhenExpression, type ContextValues } from "../../plugins/core.commands/when-evaluator";

type CommandHandler = () => void | Promise<void>;

type CommandEntry = {
  handler: CommandHandler;
  enablement?: string;
};

export class CommandBus {
  private readonly commands = new Map<string, CommandEntry>();

  public constructor(private readonly getContextValues?: () => ContextValues) {}

  public register(commandId: string, handler: CommandHandler, enablement?: string): void {
    this.commands.set(commandId, {
      handler,
      enablement
    });
  }

  public listCommandIds(): string[] {
    return [...this.commands.keys()];
  }

  public canExecute(commandId: string): boolean {
    const entry = this.commands.get(commandId);
    if (!entry) {
      return false;
    }
    if (!entry.enablement) {
      return true;
    }
    try {
      return evaluateWhenExpression(entry.enablement, this.getContextValues?.() ?? {});
    } catch {
      return false;
    }
  }

  public async execute(commandId: string): Promise<CommandExecutionResult> {
    const entry = this.commands.get(commandId);
    if (!entry) {
      return {
        commandId,
        executed: false,
        reason: "not-registered"
      };
    }

    if (!this.canExecute(commandId)) {
      return {
        commandId,
        executed: false,
        reason: "disabled-by-enablement"
      };
    }

    await entry.handler();
    return {
      commandId,
      executed: true
    };
  }
}
