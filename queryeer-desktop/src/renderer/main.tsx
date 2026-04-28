import React from "react";
import { createRoot } from "react-dom/client";
import { ShellApp } from "./shell/ShellApp";
import { bootstrapShell } from "./shell/bootstrap";
import "./styles/base.css";

async function startApp(): Promise<void> {
  const {
    extensions,
    filesRegistry,
    fileMediator,
    workspaceService,
    executeCommand,
    canExecuteCommand,
    onCommandContextChanged
  } = await bootstrapShell();

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ShellApp
        extensions={extensions}
        filesRegistry={filesRegistry}
        fileMediator={fileMediator}
        workspaceService={workspaceService}
        executeCommand={executeCommand}
        canExecuteCommand={canExecuteCommand}
        onCommandContextChanged={onCommandContextChanged}
      />
    </React.StrictMode>
  );
}

void startApp();
