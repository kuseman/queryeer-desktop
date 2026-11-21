import type { ContributionOwners } from "../../core/plugin-runtime/ContributionOwnership";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { PluginDiagnostics } from "../../core/plugin-runtime/PluginDiagnostics";
import type { PluginHostState } from "../../core/plugin-runtime/PluginHost";
import type { KeybindingDiagnostics } from "../core.commands/keybinding-resolver";

export type RuntimeData = {
  hostState: PluginHostState;
  diagnostics: PluginDiagnostics;
  extensions: ExtensionSnapshot;
  keybindingDiagnostics: KeybindingDiagnostics;
  owners: ContributionOwners;
};

/** Reads the plugin host's state when asked, so the view shows what is registered now and not at startup. */
export type RuntimeDataSource = {
  getHostState: () => PluginHostState;
  getDiagnostics: () => PluginDiagnostics;
  getExtensions: () => ExtensionSnapshot;
  getKeybindingDiagnostics: () => KeybindingDiagnostics;
  getContributionOwners: () => ContributionOwners;
};

let source: RuntimeDataSource | null = null;

export function setRuntimeDataSource(next: RuntimeDataSource | null): void {
  source = next;
}

export function getRuntimeData(): RuntimeData | null {
  if (!source) {
    return null;
  }
  return {
    hostState: source.getHostState(),
    diagnostics: source.getDiagnostics(),
    extensions: source.getExtensions(),
    keybindingDiagnostics: source.getKeybindingDiagnostics(),
    owners: source.getContributionOwners()
  };
}
