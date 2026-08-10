import type { Plugin } from "@queryeer/api/plugin/Plugin";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { HelloWorldPanel, injectHelloWorldStyles } from "./HelloWorldPanel.js";

export const helloWorldPlugin: Plugin = {
  manifest: {
    id: "example.hello-world",
    name: "Hello World Panel",
    version: "0.1.0",
    kind: "feature",
    description: "A minimal example plugin that adds a Hello World sidebar panel"
  },
  activate: (context) => {
    injectHelloWorldStyles();

    const greetCommandId = "example.hello-world.greet";

    context.commands.registerCommand({
      id: greetCommandId,
      title: "Hello World: Greet",
      handler: () => {
        context.notifications.notify({
          title: "Hello World",
          message: "Greetings from the Hello World plugin!",
          severity: "info"
        });
      }
    });

    context.quickcommand.registerProvider({
      prefix: ">",
      label: "Hello World",
      order: 100,
      getItems: () => [
        {
          id: greetCommandId,
          title: "Hello World: Greet",
          action: () => {
            void context.commands.executeCommand(greetCommandId);
          }
        }
      ]
    });

    context.layout.registerView({
      id: "example.hello-world.panel",
      title: "Hello World",
      defaultZone: "secondarySidebar",
      order: 100,
      render: () => <HelloWorldPanel context={context} />
    });

    context.tooltip.registerTooltipSection({
      id: "example.hello-world.tooltip",
      order: 100,
      render: ({ file }) => ({
        label: "Hello World",
        value: `File: ${file.uri}`
      })
    });
  }
};
