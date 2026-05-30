import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { PluginDiagnostics } from "../../core/plugin-runtime/PluginDiagnostics";
import type { PluginHostState } from "../../core/plugin-runtime/PluginHost";
import type { KeybindingDiagnostics } from "../core.commands/keybinding-resolver";

let runtimeData: {
  hostState: PluginHostState;
  diagnostics: PluginDiagnostics;
  extensions: ExtensionSnapshot;
  keybindingDiagnostics: KeybindingDiagnostics;
  commandExecution: { commandId: string; executed: boolean; reason?: string };
} | null = null;

export function setRuntimeData(data: {
  hostState: PluginHostState;
  diagnostics: PluginDiagnostics;
  extensions: ExtensionSnapshot;
  keybindingDiagnostics: KeybindingDiagnostics;
  commandExecution: { commandId: string; executed: boolean; reason?: string };
}): void {
  runtimeData = data;
}

export function getRuntimeData(): {
  hostState: PluginHostState;
  diagnostics: PluginDiagnostics;
  extensions: ExtensionSnapshot;
  keybindingDiagnostics: KeybindingDiagnostics;
  commandExecution: { commandId: string; executed: boolean; reason?: string };
} | null {
  return runtimeData;
}
