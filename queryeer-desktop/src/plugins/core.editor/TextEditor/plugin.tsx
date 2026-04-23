import type { Plugin } from "../../../contracts/plugin/Plugin";
import { getTextEditorRegistry } from "./TextEditorRegistry";
import { registerTextEditorCommands } from "./commands";
import { registerTextEditorKeybindings } from "./keybindings";
import { TextEditorComponent } from "./TextEditorComponent";
import { preloadMonaco } from "./MonacoTextEditorApi";

export { getTextEditorRegistry } from "./TextEditorRegistry";

export const coreEditorTextPlugin: Plugin = {
  manifest: {
    id: "core.editor.text",
    name: "Core Editor Text",
    version: "0.1.0",
    kind: "core",
    description: "Monaco-based text editor for core.editor",
    dependencies: ["core.editor"]
  },
  activate: (context) => {
    const textRegistry = getTextEditorRegistry();
    textRegistry.setFilesRegistry(context.files);
    textRegistry.setFileMediator(context.fileMediator);

    registerTextEditorCommands(context, textRegistry);
    registerTextEditorKeybindings(context);

    void preloadMonaco();

    context.layout.registerEditor({
      id: "core.editor.text",
      title: "Text Editor",
      order: 10,
      supportedContentCategories: ["text"],
      openIntents: ["view", "edit"],
      priority: 200,
      render: ({ activeFile } = {}) => {
        return <TextEditorComponent file={activeFile} registry={textRegistry} />;
      }
    });
  }
};
