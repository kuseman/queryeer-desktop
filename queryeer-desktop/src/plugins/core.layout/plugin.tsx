import type { Plugin } from "../../contracts/plugin/Plugin";

export const coreLayoutPlugin: Plugin = {
  manifest: {
    id: "core.layout",
    name: "Core Layout",
    version: "0.1.0",
    kind: "core",
    description: "Registers baseline panel layout capabilities"
  },
  activate: (context) => {
    context.panels.registerPanel({
      id: "core.layout.welcome",
      title: "Welcome",
      placement: "center",
      render: () => (
        <div className="panel-card">
          <h3>Plugin host online</h3>
          <p>
            Layout capability is active. Future modules will register tabs and panels
            through this extension point.
          </p>
        </div>
      )
    });
  }
};
