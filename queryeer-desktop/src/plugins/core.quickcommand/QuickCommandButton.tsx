import React, { useEffect, useState } from "react";
import { getQuickCommandService } from "./service";

void React;

export function QuickCommandButton(): JSX.Element | null {
  const [ready, setReady] = useState(() => getQuickCommandService() !== null);

  useEffect(() => {
    if (!ready) {
      // poll once after mount in case service initializes slightly after render
      const id = setTimeout(() => setReady(getQuickCommandService() !== null), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <button
      type="button"
      className="quick-command-button"
      aria-label="Quick Command (Ctrl+Shift+P)"
      onClick={() => getQuickCommandService()?.open()}
    >
      <span className="quick-command-button-icon" aria-hidden="true">⌨</span>
      <span className="quick-command-button-label">Quick Command…</span>
      <span className="quick-command-button-hint" aria-hidden="true">Ctrl+Shift+P</span>
    </button>
  );
}
