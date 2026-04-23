import type { Plugin } from "../../contracts/plugin/Plugin";
import { coreEditorTextPlugin } from "./TextEditor/plugin";
import { coreEditorImagePlugin } from "./ImageEditor/plugin";

export const coreEditorPlugin: Plugin = {
  manifest: {
    id: "core.editor",
    name: "Core Editor",
    version: "0.1.0",
    kind: "core",
    description: "Pluggable editor system - owns the editor registry and delegates to editor-type plugins",
    dependencies: ["core.layout"]
  },
  activate: (context) => {
    coreEditorTextPlugin.activate(context);
    coreEditorImagePlugin.activate(context);
  }
};