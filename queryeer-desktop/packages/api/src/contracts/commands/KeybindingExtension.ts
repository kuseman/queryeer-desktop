export type KeybindingScope = "global" | "editor" | "terminal" | "explorer";

export type KeybindingContribution = {
  id: string;
  commandId: string;
  key: string;
  when?: string;
  scope?: KeybindingScope;
  order?: number;
};

export type KeybindingRegistry = {
  registerKeybinding: (contribution: KeybindingContribution) => void;
};
