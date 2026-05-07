import React, { useEffect, useState } from "react";
import { getQuickCommandService } from "./service";
import { getKeybindingLabel } from "../core.commands/keybinding-label-accessor";
import { subscribeKeybindingsRuntime } from "../core.commands/keybindings-runtime-accessor";

void React;

export function QuickCommandButton(): JSX.Element | null {
  const [ready, setReady] = useState(() => getQuickCommandService() !== null);
  const [shortcutVersion, setShortcutVersion] = useState(0);

  useEffect(() => {
    if (!ready) {
      // poll once after mount in case service initializes slightly after render
      const id = setTimeout(() => setReady(getQuickCommandService() !== null), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [ready]);

  useEffect(() => {
    return subscribeKeybindingsRuntime(() => {
      setShortcutVersion((version) => version + 1);
    });
  }, []);

  if (!ready) {
    return null;
  }

  void shortcutVersion;
  const shortcutLabel = getKeybindingLabel("core.quickcommand.open") ?? "Unbound";

  return (
    <button
      type="button"
      className="quick-command-button"
      aria-label={`Quick Command (${shortcutLabel})`}
      onClick={() => getQuickCommandService()?.open()}
    >
      <span className="quick-command-button-icon" aria-hidden="true">⌨</span>
      <span className="quick-command-button-label">Quick Command…</span>
      <span className="quick-command-button-hint" aria-hidden="true">{shortcutLabel}</span>
    </button>
  );
}
