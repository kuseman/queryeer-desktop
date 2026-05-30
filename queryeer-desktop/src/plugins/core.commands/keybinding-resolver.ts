import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import {
  KEYBINDINGS_SCHEMA_VERSION,
  emptyUserKeybindingsDocument,
  type UserKeybindingsDocument
} from "../../contracts/commands/Keybindings";
import type { KeybindingContribution } from "../../contracts/commands/KeybindingExtension";

export type ResolvedKeybinding = KeybindingContribution & {
  source: "default" | "user";
  normalizedKey: string;
};

export type KeybindingDiagnostics = {
  invalidUserBindings: {
    commandId: string;
    key: string;
    reason: "unknown-command" | "invalid-key";
  }[];
  duplicateBindings: {
    key: string;
    when?: string;
    winnerCommandId: string;
    shadowedCommandId: string;
  }[];
};

export type KeybindingResolverState = {
  resolved: ResolvedKeybinding[];
  diagnostics: KeybindingDiagnostics;
  sourceDocument: UserKeybindingsDocument;
};

export function normalizeKeybindingKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "esc") return "escape";
      if (lower === "del") return "delete";
      if (lower === "ins") return "insert";
      if (lower === "return") return "enter";
      if (lower === "spacebar") return "space";
      if (lower === "cmdorctrl") {
        const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? "");
        return isMac ? "meta" : "ctrl";
      }
      if (lower === "cmd") return "meta";
      if (lower === "ctrl") return "ctrl";
      if (lower === "alt") return "alt";
      if (lower === "shift") return "shift";
      return lower;
    })
    .join("+");
}

export function eventToNormalizedKey(event: KeyboardEvent): string {
  const tokens: string[] = [];
  if (event.ctrlKey) tokens.push("ctrl");
  if (event.metaKey) tokens.push("meta");
  if (event.altKey) tokens.push("alt");
  if (event.shiftKey) tokens.push("shift");

  const normalizedCode = normalizeEventKey(event);
  if (normalizedCode.length > 0) {
    tokens.push(normalizedCode);
  }
  return tokens.join("+");
}

function normalizeEventKey(event: KeyboardEvent): string {
  const key = event.key;
  if (key.length === 1) {
    return key.toLowerCase();
  }
  const map: Record<string, string> = {
    " ": "space",
    Escape: "escape",
    Enter: "enter",
    ArrowUp: "arrowup",
    ArrowDown: "arrowdown",
    ArrowLeft: "arrowleft",
    ArrowRight: "arrowright"
  };
  return (map[key] ?? key).toLowerCase();
}

function normalizeContribution(
  contribution: KeybindingContribution,
  source: "default" | "user"
): ResolvedKeybinding {
  return {
    ...contribution,
    normalizedKey: normalizeKeybindingKey(contribution.key),
    source
  };
}

function hasSimpleKeySyntax(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const parts = trimmed.split("+").map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) {
    return false;
  }
  return parts.every((part) => /^[A-Za-z0-9]+$/.test(part) || part.length === 1);
}

function matchesUnbound(binding: KeybindingContribution, document: UserKeybindingsDocument): boolean {
  return document.unbound.some((entry) => {
    if (entry.commandId !== binding.commandId) {
      return false;
    }
    if (entry.when === undefined) {
      return true;
    }
    return (binding.when ?? "global") === entry.when;
  });
}

function buildDefaultKeybindings(extensions: ExtensionSnapshot): KeybindingContribution[] {
  return [...extensions.keybindings];
}

export function resolveKeybindingState(
  extensions: ExtensionSnapshot,
  userDocument: UserKeybindingsDocument | null
): KeybindingResolverState {
  const document =
    userDocument && userDocument.version === KEYBINDINGS_SCHEMA_VERSION
      ? userDocument
      : emptyUserKeybindingsDocument();

  const knownCommands = new Set(extensions.commands.map((command) => command.id));
  const diagnostics: KeybindingDiagnostics = {
    invalidUserBindings: [],
    duplicateBindings: []
  };

  const defaults = buildDefaultKeybindings(extensions)
    .filter((binding) => !matchesUnbound(binding, document))
    .map((binding) => normalizeContribution(binding, "default"));

  const validUser = document.bindings
    .map((binding, index) => ({
      ...binding,
      id: `user.keybinding.${index}`,
      scope: binding.scope ?? "global",
      when: binding.when ?? "global",
      order: 1_000_000 + index
    }))
    .filter((binding) => {
      if (!knownCommands.has(binding.commandId)) {
        diagnostics.invalidUserBindings.push({
          commandId: binding.commandId,
          key: binding.key,
          reason: "unknown-command"
        });
        return false;
      }
      if (!hasSimpleKeySyntax(binding.key)) {
        diagnostics.invalidUserBindings.push({
          commandId: binding.commandId,
          key: binding.key,
          reason: "invalid-key"
        });
        return false;
      }
      return true;
    })
    .map((binding) => normalizeContribution(binding, "user"));

  const merged = [...defaults, ...validUser].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const byUniqueBinding = new Map<string, ResolvedKeybinding>();

  for (const candidate of merged) {
    const identity = `${candidate.normalizedKey}|${candidate.when ?? "global"}`;
    const existing = byUniqueBinding.get(identity);
    if (existing) {
      diagnostics.duplicateBindings.push({
        key: candidate.key,
        when: candidate.when,
        winnerCommandId: candidate.commandId,
        shadowedCommandId: existing.commandId
      });
    }
    byUniqueBinding.set(identity, candidate);
  }

  return {
    resolved: [...byUniqueBinding.values()],
    diagnostics,
    sourceDocument: document
  };
}
