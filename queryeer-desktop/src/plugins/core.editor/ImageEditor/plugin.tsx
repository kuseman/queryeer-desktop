import type { Plugin } from "../../../contracts/plugin/Plugin";

export const coreEditorImagePlugin: Plugin = {
  manifest: {
    id: "core.editor.image",
    name: "Core Editor Image",
    version: "0.1.0",
    kind: "core",
    description: "Image editor for core.editor",
    dependencies: ["core.editor"]
  },
  activate: (context) => {
    context.layout.registerEditor({
      id: "core.editor.image",
      title: "Image Editor",
      order: 50,
      supportedContentCategories: ["image"],
      openIntents: ["view", "edit"],
      priority: 100,
      render: ({ activeFile } = {}) => {
        if (!activeFile) {
          return <div className="image-editor">No active file.</div>;
        }
        return <div className="image-editor">Image: {activeFile.uri}</div>;
      }
    });
  }
};