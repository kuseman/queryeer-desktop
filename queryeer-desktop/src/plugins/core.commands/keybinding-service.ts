import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { UserKeybindingsDocument } from "../../contracts/commands/Keybindings";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";
import { createContextKeyService } from "./context-key-service";
import {
  eventToNormalizedKey,
  normalizeKeybindingKey,
  resolveKeybindingState,
  type KeybindingDiagnostics,
  type ResolvedKeybinding
} from "./keybinding-resolver";
import { evaluateWhenExpression } from "./when-evaluator";

export type KeybindingService = {
  initialize: (extensions: ExtensionSnapshot) => Promise<void>;
  updateExtensions: (extensions: ExtensionSnapshot) => Promise<void>;
  diagnostics: () => KeybindingDiagnostics;
  dispose: () => void;
};

export type KeybindingServiceOptions = {
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  getUserKeybindings: () => Promise<UserKeybindingsDocument>;
};

function shouldSkipForInput(when: string | undefined, contextInputFocus: boolean): boolean {
  if (!contextInputFocus) {
    return false;
  }
  const expr = (when ?? "global").toLowerCase();
  return !expr.includes("inputfocus");
}

export function createKeybindingService(options: KeybindingServiceOptions): KeybindingService {
  const contextKeys = createContextKeyService();
  let resolved: ResolvedKeybinding[] = [];
  let diagnostics: KeybindingDiagnostics = {
    invalidUserBindings: [],
    duplicateBindings: []
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const normalized = eventToNormalizedKey(event);
    if (!normalized) {
      return;
    }

    const contextSnapshot = contextKeys.snapshot();
    const inputFocus = Boolean(contextSnapshot.inputFocus);

    const matched = [...resolved]
      .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
      .find((binding) => {
        if (normalizeKeybindingKey(binding.key) !== normalized) {
          return false;
        }
        if (shouldSkipForInput(binding.when, inputFocus)) {
          return false;
        }
        return evaluateWhenExpression(binding.when, contextSnapshot);
      });

    if (!matched) {
      return;
    }

    event.preventDefault();
    void options.executeCommand(matched.commandId);
  };

  document.addEventListener("keydown", onKeyDown);

  return {
    initialize: async (extensions) => {
      const user = await options.getUserKeybindings();
      const state = resolveKeybindingState(extensions, user);
      resolved = state.resolved;
      diagnostics = state.diagnostics;
    },
    updateExtensions: async (extensions) => {
      const user = await options.getUserKeybindings();
      const state = resolveKeybindingState(extensions, user);
      resolved = state.resolved;
      diagnostics = state.diagnostics;
    },
    diagnostics: () => diagnostics,
    dispose: () => {
      document.removeEventListener("keydown", onKeyDown);
      contextKeys.dispose();
    }
  };
}
