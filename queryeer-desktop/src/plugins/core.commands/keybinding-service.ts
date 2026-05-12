import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { UserKeybindingsDocument } from "../../contracts/commands/Keybindings";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";
import { createContextKeyService } from "./context-key-service";
import type { ContextChain } from "./context-chain";
import {
  eventToNormalizedKey,
  normalizeKeybindingKey,
  resolveKeybindingState,
  type KeybindingDiagnostics,
  type ResolvedKeybinding
} from "./keybinding-resolver";
import { evaluateWhenExpression } from "./when-evaluator";
import { updateKeybindingLabels } from "./keybinding-label-accessor";

export type KeybindingService = {
  initialize: (extensions: ExtensionSnapshot) => Promise<void>;
  updateExtensions: (extensions: ExtensionSnapshot) => Promise<void>;
  diagnostics: () => KeybindingDiagnostics;
  dispose: () => void;
};

export type KeybindingServiceOptions = {
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  getUserKeybindings: () => Promise<UserKeybindingsDocument>;
  /** When provided, context snapshots come from the shared chain instead of an isolated DOM tracker. */
  contextChain?: ContextChain;
};

function isFunctionKeybinding(key: string): boolean {
  return /(^|\+)(F([1-9]|1[0-9]|2[0-4]))$/i.test(key);
}

function shouldSkipForInput(when: string | undefined, contextInputFocus: boolean, key: string): boolean {
  if (!contextInputFocus) {
    return false;
  }
  if (isFunctionKeybinding(key)) {
    return false;
  }
  const expr = (when ?? "global").toLowerCase();
  if (expr.includes("editorfocus")) {
    return false;
  }
  return !expr.includes("inputfocus");
}

export function createKeybindingService(options: KeybindingServiceOptions): KeybindingService {
  const contextKeys = options.contextChain ? null : createContextKeyService();
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

    const rawContextSnapshot = options.contextChain?.getEffectiveContext() ?? contextKeys!.snapshot();
    const contextSnapshot = {
      ...rawContextSnapshot,
      editorFocus: Boolean(rawContextSnapshot.editorFocus || rawContextSnapshot.editorTextFocus)
    };
    const inputFocus = Boolean(rawContextSnapshot.inputFocus);

    const matched = [...resolved]
      .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
      .find((binding) => {
        if (normalizeKeybindingKey(binding.key) !== normalized) {
          return false;
        }
        if (shouldSkipForInput(binding.when, inputFocus, binding.key)) {
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

  document.addEventListener("keydown", onKeyDown, true);

  return {
    initialize: async (extensions) => {
      const user = await options.getUserKeybindings();
      const state = resolveKeybindingState(extensions, user);
      resolved = state.resolved;
      diagnostics = state.diagnostics;
      updateKeybindingLabels(resolved);
    },
    updateExtensions: async (extensions) => {
      const user = await options.getUserKeybindings();
      const state = resolveKeybindingState(extensions, user);
      resolved = state.resolved;
      diagnostics = state.diagnostics;
      updateKeybindingLabels(resolved);
    },
    diagnostics: () => diagnostics,
    dispose: () => {
      document.removeEventListener("keydown", onKeyDown, true);
      contextKeys?.dispose();
    }
  };
}
