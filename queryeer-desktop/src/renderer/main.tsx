import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { ShellAppProps } from "./shell/ShellApp";
import { ShellApp } from "./shell/ShellApp";
import { bootstrapShell } from "./shell/bootstrap";
import { installGlobalExternalLinkHandler } from "./shell/external-link-handler";
import "@glideapps/glide-data-grid/dist/index.css";
import "./styles/base.css";

type BootstrapResult = Awaited<ReturnType<typeof bootstrapShell>>;

function App({
  bootstrap,
  ...shellProps
}: {
  bootstrap: BootstrapResult;
} & Omit<ShellAppProps, "extensions">) {
  const [extensions, setExtensions] = useState(bootstrap.extensions);

  useEffect(() => {
    bootstrap.onMenuRebuild(() => {
      setExtensions(bootstrap.getExtensions());
    });
  }, [bootstrap]);

  useEffect(() => installGlobalExternalLinkHandler(), []);

  return <ShellApp {...shellProps} extensions={extensions} />;
}

async function startApp(): Promise<void> {
  const bootstrap = await bootstrapShell();

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App
        bootstrap={bootstrap}
        filesRegistry={bootstrap.filesRegistry}
        fileMediator={bootstrap.fileMediator}
        workspaceService={bootstrap.workspaceService}
        executeCommand={bootstrap.executeCommand}
        canExecuteCommand={bootstrap.canExecuteCommand}
        onCommandContextChanged={bootstrap.onCommandContextChanged}
      />
    </React.StrictMode>
  );
}

void startApp();
