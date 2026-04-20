export type CommandHandler = () => void | Promise<void>;

export type CommandExtension = {
  id: string;
  title: string;
  handler: CommandHandler;
};
