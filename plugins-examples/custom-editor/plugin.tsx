import type { Plugin } from "@queryeer/api/plugin/Plugin";
import type { OutlineSymbol } from "@queryeer/api/extensions/OutlineExtension";
import { registerFooMimeTypes } from "./mime-types.js";
import { registerFooEditorContextMenu } from "./context-menu.js";
import { FooEditor, injectFooEditorStyles } from "./FooEditor.js";

export const customEditorPlugin: Plugin = {
  manifest: {
    id: "example.custom-editor",
    name: "Custom Foo Editor",
    version: "0.1.0",
    kind: "feature",
    description: "A custom editor for .foo files with tooltip and context menu contributions",
    dependencies: ["core.editor"]
  },
  activate: (context) => {
    injectFooEditorStyles();

    registerFooMimeTypes(context.files);

    context.files.mimeIcons.registerMimeIcon({
      moduleId: "example.custom-editor",
      mimeType: "application/x-foo",
      icon: ({ className }) => <span className={className}>&#x1F4C4;</span>
    });

    context.layout.registerEditor({
      id: "example.custom-editor.foo",
      title: "Foo Editor",
      order: 30,
      supportedMimeTypes: ["application/x-foo"],
      openIntents: ["view", "edit"],
      priority: 100,
      render: ({ activeFile } = {}) => {
        if (!activeFile) {
          return <div className="foo-editor-empty">No active file.</div>;
        }
        return <FooEditor fileUri={activeFile.uri} file={activeFile} pluginContext={context} />;
      }
    });

    context.tooltip.registerTooltipSection({
      id: "example.custom-editor.tooltip",
      order: 50,
      render: ({ file }) => {
        if (file.mimeType !== "application/x-foo") return null;
        return {
          label: "Foo File",
          value: `.foo custom file — ${file.uri.split("/").pop() ?? file.uri}`
        };
      }
    });

    context.outline.registerOutlineProvider({
      mimeType: "application/x-foo",
      provider: (content: string): OutlineSymbol[] => {
        const lines = content.split("\n");
        return lines
          .map<OutlineSymbol | null>((line, index) => {
            const trimmed = line.trim();
            if (trimmed.length === 0) return null;
            const headerMatch = trimmed.match(/^(\w+):/);
            if (!headerMatch) return null;
            const lineNum = index + 1;
            return {
              id: `line-${lineNum}`,
              name: headerMatch[1],
              detail: trimmed,
              kind: "Property",
              range: {
                startLineNumber: lineNum, startColumn: 1,
                endLineNumber: lineNum, endColumn: trimmed.length + 1
              },
              selectionRange: {
                startLineNumber: lineNum, startColumn: 1,
                endLineNumber: lineNum, endColumn: headerMatch[1].length + 1
              }
            };
          })
          .filter((s): s is OutlineSymbol => s !== null);
      }
    });

    registerFooEditorContextMenu(context);
  }
};
