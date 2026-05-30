import type { KeybindingContribution } from "../../contracts/commands/KeybindingExtension";

export function normalizeAcceleratorForPlatform(accelerator: string, platform: string): string {
  return accelerator
    .replace(/CmdOrCtrl/g, platform === "darwin" ? "Cmd" : "Ctrl")
    .replace(/\bCommand\b/g, "Cmd")
    .replace(/\bControl\b/g, "Ctrl")
    .replace(/\bPlus\b/g, "+");
}

export function resolveGlobalAcceleratorsByCommand(
  keybindings: KeybindingContribution[],
  platform: string
): Map<string, string> {
  const map = new Map<string, string>();
  for (const binding of [...keybindings].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const isGlobal = (binding.scope ?? "global") === "global";
    const isGlobalWhen = binding.when === undefined || binding.when === "global";
    if (!isGlobal || !isGlobalWhen || map.has(binding.commandId)) {
      continue;
    }
    map.set(binding.commandId, normalizeAcceleratorForPlatform(binding.key, platform));
  }
  return map;
}

export function resolveFirstAcceleratorsByCommand(
  keybindings: KeybindingContribution[],
  platform: string
): Map<string, string> {
  const map = new Map<string, string>();
  for (const binding of [...keybindings].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (map.has(binding.commandId)) {
      continue;
    }
    map.set(binding.commandId, normalizeAcceleratorForPlatform(binding.key, platform));
  }
  return map;
}
