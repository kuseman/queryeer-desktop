import React from "react";
import { createRoot } from "react-dom/client";
import { ShellApp } from "./shell/ShellApp";
import { bootstrapShell } from "./shell/bootstrap";
import "./styles/base.css";

async function startApp(): Promise<void> {
  const { hostState, extensions, commandExecution, diagnostics } =
    await bootstrapShell();

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ShellApp
        hostState={hostState}
        extensions={extensions}
        commandExecution={commandExecution}
        diagnostics={diagnostics}
      />
    </React.StrictMode>
  );
}

void startApp();
