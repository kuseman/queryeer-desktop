import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";

type CommandHandler = () => void | Promise<void>;

export class CommandBus {
  private readonly commands = new Map<string, CommandHandler>();

  public register(commandId: string, handler: CommandHandler): void {
    this.commands.set(commandId, handler);
  }

  public listCommandIds(): string[] {
    return [...this.commands.keys()];
  }

  public async execute(commandId: string): Promise<CommandExecutionResult> {
    const handler = this.commands.get(commandId);
    if (!handler) {
      return {
        commandId,
        executed: false,
        reason: "not-registered"
      };
    }

    await handler();
    return {
      commandId,
      executed: true
    };
  }
}
