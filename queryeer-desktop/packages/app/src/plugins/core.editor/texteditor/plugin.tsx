import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getTextEditorRegistry } from "./TextEditorRegistry";
import { getEditorRegistryHost } from "../../../core/plugin-runtime/ExtensionRegistry";
import { getOutlineRegistry } from "../../../core/plugin-runtime/ExtensionRegistry";
import { registerTextEditorCommands } from "./commands";
import { registerTextEditorKeybindings } from "./keybindings";
import { TextEditorComponent } from "./TextEditorComponent";
import { preloadMonaco } from "./MonacoTextEditorApi";
import { registerTextEditorMimeTypes } from "./mime-types";
import { TextIcon } from "./TextIcon";
import { EditorCursorPositionIndicator } from "./EditorCursorPositionIndicator";
import {
  jsonOutlineProvider,
  xmlOutlineProvider,
  yamlOutlineProvider,
  sqlOutlineProvider,
  customPatternProvider
} from "./outline-providers";

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
    getEditorRegistryHost().registerContentRepository(textRegistry);
    registerTextEditorMimeTypes(context.files);

    context.files.mimeIcons.registerMimeIcon({
      moduleId: "core.editor.text",
      mimeType: "text/plain",
      icon: TextIcon
    });

    context.outline.registerOutlineProvider({ mimeType: "application/json", provider: jsonOutlineProvider });
    context.outline.registerOutlineProvider({ mimeType: "application/xml", provider: xmlOutlineProvider });
    context.outline.registerOutlineProvider({ mimeType: "application/yaml", provider: yamlOutlineProvider });
    context.outline.registerOutlineProvider({ mimeType: "application/sql", provider: sqlOutlineProvider });
    context.outline.registerOutlineProvider({ mimeType: "application/plbsql", provider: sqlOutlineProvider });

    const textMimeTypes = [
      "application/json", "application/xml", "application/yaml",
      "application/sql", "application/plbsql",
      "text/plain", "text/html", "text/css", "text/javascript", "text/typescript",
      "text/csv", "text/markdown"
    ];
    for (const mimeType of textMimeTypes) {
      context.outline.registerSupplementaryOutlineProvider({ mimeType, provider: customPatternProvider });
    }

    registerTextEditorCommands(context, textRegistry);
    registerTextEditorKeybindings(context);

    context.layout.registerStatusItem({
      id: "core.editor.text.statusItem",
      alignment: "left",
      order: 10,
      render: () => <EditorCursorPositionIndicator />
    });

    void preloadMonaco();

    const editorRegistryHost = getEditorRegistryHost();

    context.layout.registerEditor({
      id: "core.editor.text",
      title: "Text Editor",
      order: 10,
      supportedContentCategories: ["text"],
      openIntents: ["view", "edit"],
      priority: 200,
      render: ({ activeFile } = {}) => {
        return <TextEditorComponent
          file={activeFile}
          registry={textRegistry}
          editorRegistryHost={editorRegistryHost}
          outlineRegistry={getOutlineRegistry()}
        />;
      }
    });
  }
};