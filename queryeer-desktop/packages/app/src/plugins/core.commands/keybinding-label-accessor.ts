import { normalizeAcceleratorForPlatform } from "../../renderer/shell/accelerator-utils";
import type { ResolvedKeybinding } from "./keybinding-resolver";

const isMac = navigator.platform.toLowerCase().includes("mac");
const platform = isMac ? "darwin" : "win32";

let labelMap = new Map<string, string>();

export function updateKeybindingLabels(resolved: ResolvedKeybinding[]): void {
  const next = new Map<string, string>();
  for (const binding of resolved) {
    if (!next.has(binding.commandId)) {
      next.set(binding.commandId, normalizeAcceleratorForPlatform(binding.key, platform));
    }
  }
  labelMap = next;
}

export function getKeybindingLabel(commandId: string): string | undefined {
  return labelMap.get(commandId);
}
