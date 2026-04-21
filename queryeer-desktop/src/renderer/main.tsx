import React from "react";
import { createRoot } from "react-dom/client";
import { ShellApp } from "./shell/ShellApp";
import { bootstrapShell } from "./shell/bootstrap";
import "./styles/base.css";

async function startApp(): Promise<void> {
  const {
    hostState,
    extensions,
    filesRegistry,
    fileMediator,
    workspaceService,
    commandExecution,
    diagnostics
  } = await bootstrapShell();

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ShellApp
        hostState={hostState}
        extensions={extensions}
        filesRegistry={filesRegistry}
        fileMediator={fileMediator}
        workspaceService={workspaceService}
        commandExecution={commandExecution}
        diagnostics={diagnostics}
      />
    </React.StrictMode>
  );
}

void startApp();
