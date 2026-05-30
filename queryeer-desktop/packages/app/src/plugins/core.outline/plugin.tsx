import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { createOutlineStore, getOutlineStore } from "./OutlineStore";
import { OutlineView } from "./OutlineView";
import "./outline.css";

export const coreOutlinePlugin: Plugin = {
  manifest: {
    id: "core.outline",
    name: "Core Outline",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["outline.view"]
  },
  activate: (context) => {
    const store = createOutlineStore();

    context.layout.registerView({
      id: "core.outline.view",
      title: "Outline",
      defaultZone: "secondarySidebar",
      order: 20,
      canMoveZones: false,
      canCollapse: true,
      isOpen: false,
      flex: 1,
      maxHeight: 300,
      when: "outlineSupported",
      panelActions: [
        {
          id: "core.outline.help",
          icon: "?",
          title: "How the outline works",
          commandId: "core.outline.showHelp"
        }
      ],
      render: () => <OutlineView store={store} editorRegistry={context.editors} />
    });

    context.commands.registerCommand({
      id: "core.outline.goToSymbol",
      title: "Go to Symbol in Editor",
      category: "Outline",
      handler: () => {
        const state = getOutlineStore().getState();
        if (state.symbols.length > 0) {
          getOutlineStore().setSelectedSymbolId(state.symbols[0].id);
        }
      }
    });

    context.commands.registerCommand({
      id: "core.outline.showHelp",
      title: "Show Outline Help",
      category: "Outline",
      handler: () => {
        getOutlineStore().setShowHelp(true);
      }
    });
  }
};