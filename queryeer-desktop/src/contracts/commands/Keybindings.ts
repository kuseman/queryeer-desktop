export const KEYBINDINGS_SCHEMA_VERSION = 1;

export type UserKeybindingBinding = {
  commandId: string;
  key: string;
  when?: string;
  scope?: "global" | "editor" | "terminal" | "explorer";
};

export type UserKeybindingUnbound = {
  commandId: string;
  when?: string;
};

export type UserKeybindingsDocument = {
  version: typeof KEYBINDINGS_SCHEMA_VERSION;
  bindings: UserKeybindingBinding[];
  unbound: UserKeybindingUnbound[];
};

export function emptyUserKeybindingsDocument(): UserKeybindingsDocument {
  return {
    version: KEYBINDINGS_SCHEMA_VERSION,
    bindings: [],
    unbound: []
  };
}
