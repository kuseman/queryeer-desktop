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
    context.commands.registerCommand({
      id: "core.layout.openEditor",
      title: "Open Editor",
      handler: async () => {
        console.log("Editor open command executed");
      }
    });

    context.commands.registerCommand({
      id: "core.layout.closeEditor",
      title: "Close Editor",
      handler: async () => {
        console.log("Editor close command executed");
      }
    });

    context.commands.registerCommand({
      id: "core.layout.toggleDevTools",
      title: "Toggle Developer Tools",
      handler: async () => {
        console.log("Toggle DevTools command executed");
      }
    });

    context.menu.registerMenuItem({
      id: "core.layout.menu.view.toggleDevTools",
      label: "Toggle Developer Tools",
      order: 40,
      parentId: "core.menu.view",
      commandId: "core.layout.toggleDevTools"
    });

    context.layout.setShellDefaults({
      visibleZones: [
        "menuBar",
        "toolBar",
        "statusBar",
        "primarySidebar",
        "mainArea"
      ],
      sidebarWidths: {
        primary: 280,
        secondary: 320
      },
      statusBarHeight: 24
    });

    context.layout.registerToolbarAction({
      id: "core.layout.toolbar.togglePrimarySidebar",
      title: "",
      order: 10,
      commandId: "core.layout.togglePrimarySidebar",
      icon: "sidebar-primary"
    });

    context.layout.registerToolbarAction({
      id: "core.layout.toolbar.toggleSecondarySidebar",
      title: "",
      order: 20,
      commandId: "core.layout.toggleSecondarySidebar",
      icon: "sidebar-secondary"
    });

    context.layout.registerStatusItem({
      id: "core.layout.status.runtime",
      alignment: "left",
      order: 10,
      render: () => <span>Layout: ready</span>
    });

    context.layout.registerView({
      id: "core.layout.view.primary",
      title: "Primary",
      defaultZone: "primarySidebar",
      order: 10,
      canMoveZones: true,
      render: () => (
        <div>
          <p>Primary sidebar slot for dockable plugin views.</p>
        </div>
      )
    });

    context.layout.registerView({
      id: "core.layout.view.secondary",
      title: "Secondary",
      defaultZone: "secondarySidebar",
      order: 10,
      canMoveZones: true,
      render: () => (
        <div>
          <p>Secondary sidebar slot for context tools and inspectors.</p>
        </div>
      )
    });

    context.layout.registerWelcome({
      id: "core.layout.welcome",
      order: 10,
      render: () => (
        <div className="panel-card">
          <h3>Workspace ready</h3>
          <p>
            Shell zones are active: menu, toolbar, status bar, sidebars, and main area.
          </p>
        </div>
      )
    });
  }
};
