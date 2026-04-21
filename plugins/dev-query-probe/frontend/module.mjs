import React, { useState } from "react";

function QueryProbePanel() {
  const [executionId, setExecutionId] = useState("probe-exec-1");

  return React.createElement(
    "div",
    { className: "panel-card" },
    React.createElement("h3", null, "Query Probe (External)"),
    React.createElement("p", null, "Runs/cancels a backend query for development diagnostics."),
    React.createElement(
      "div",
      { className: "backend-actions" },
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            const id = `probe-exec-${Date.now()}`;
            setExecutionId(id);
            void window.appShell.executeBackendQuery({
              queryExecutionId: id,
              engineId: "payloadbuilder",
              text: "select * from dev_probe"
            });
          }
        },
        "Run probe query"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            void window.appShell.cancelBackendQuery({
              queryExecutionId: executionId,
              reason: "dev-probe-cancel"
            });
          }
        },
        "Cancel last probe"
      )
    ),
    React.createElement("p", null, `Last execution: ${executionId}`)
  );
}

export const pluginModule = {
  manifest: {
    id: "dev.query-probe",
    name: "Dev Query Probe",
    version: "0.1.0",
    kind: "feature",
    description: "External developer-only backend query probe panel",
    providesCapabilities: ["dev.query.probe"],
    requiredCapabilities: []
  },
  plugin: {
    manifest: {
      id: "dev.query-probe",
      name: "Dev Query Probe",
      version: "0.1.0",
      kind: "feature",
      description: "External developer-only backend query probe panel",
      providesCapabilities: ["dev.query.probe"],
      requiredCapabilities: []
    },
    activate: (context) => {
      context.layout.registerEditor({
        id: "dev.query-probe.editor",
        title: "Query Probe",
        order: 10,
        supportedMimeTypes: ["application/x-payloadbuilder"],
        render: () => React.createElement(QueryProbePanel)
      });

      context.files.registerMimeResolver((_uri, hint) => {
        if (hint?.extension === "pb" || hint?.extension === "pbq") {
          return "application/x-payloadbuilder";
        }
        return undefined;
      });
    }
  }
};
