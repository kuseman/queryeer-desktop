import type { Plugin } from "../../contracts/plugin/Plugin";
import { coreEditorTextPlugin } from "./texteditor/plugin";
import { coreEditorImagePlugin } from "./imageeditor/plugin";

export const coreEditorPlugin: Plugin = {
  manifest: {
    id: "core.editor",
    name: "Core Editor",
    version: "0.1.0",
    kind: "core",
    description: "Pluggable editor system - owns the editor registry and delegates to editor-type plugins",
    dependencies: ["core.layout"],
    providesCapabilities: ["editor"]
  },
  activate: (context) => {
    context.settings.registerSettings({
      moduleId: "core.editor.texteditor",
      title: "Editor",
      order: 30,
      settings: [
        {
          id: "core.editor.texteditor.fontSize",
          moduleId: "core.editor.texteditor",
          title: "Font Size",
          description: "Controls editor font size in pixels.",
          sectionPath: ["Editor", "Font"],
          tags: ["font", "size", "text"],
          type: "number",
          defaultValue: 13,
          constraints: {
            min: 8,
            max: 32
          }
        },
        {
          id: "core.editor.texteditor.fontFamily",
          moduleId: "core.editor.texteditor",
          title: "Font Family",
          description: "Controls the editor font family.",
          sectionPath: ["Editor", "Font"],
          tags: ["font", "family", "typography"],
          type: "string",
          defaultValue: "JetBrains Mono, Consolas, monospace"
        },
        {
          id: "core.editor.texteditor.wordWrap",
          moduleId: "core.editor.texteditor",
          title: "Word Wrap",
          description: "Controls how lines should wrap in the editor.",
          sectionPath: ["Editor", "Formatting"],
          tags: ["wrap", "line"],
          type: "enum",
          defaultValue: "off",
          options: [
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
            { value: "wordWrapColumn", label: "Word Wrap Column" }
          ]
        },
        {
          id: "core.editor.texteditor.tabSize",
          moduleId: "core.editor.texteditor",
          title: "Tab Size",
          description: "The number of spaces a tab is equal to.",
          sectionPath: ["Editor", "Formatting"],
          tags: ["tab", "indent"],
          type: "number",
          defaultValue: 4,
          constraints: {
            min: 1,
            max: 12
          }
        },
        {
          id: "core.editor.texteditor.insertSpaces",
          moduleId: "core.editor.texteditor",
          title: "Insert Spaces",
          description: "Insert spaces when pressing Tab.",
          sectionPath: ["Editor", "Formatting"],
          tags: ["tab", "spaces", "indent"],
          type: "boolean",
          defaultValue: true
        },
        {
          id: "core.editor.texteditor.lineNumbers",
          moduleId: "core.editor.texteditor",
          title: "Line Numbers",
          description: "Controls the display of line numbers.",
          sectionPath: ["Editor", "Appearance"],
          tags: ["line", "numbers", "gutter"],
          type: "enum",
          defaultValue: "on",
          options: [
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
            { value: "relative", label: "Relative" }
          ]
        },
        {
          id: "core.editor.texteditor.minimap.enabled",
          moduleId: "core.editor.texteditor",
          title: "Minimap Enabled",
          description: "Controls whether the editor minimap is shown.",
          sectionPath: ["Editor", "Appearance"],
          tags: ["minimap", "preview"],
          type: "boolean",
          defaultValue: true
        },
        {
          id: "core.editor.texteditor.renderWhitespace",
          moduleId: "core.editor.texteditor",
          title: "Render Whitespace",
          description: "Controls how whitespace characters are rendered in the editor.",
          sectionPath: ["Editor", "Appearance"],
          tags: ["whitespace", "spaces", "tabs"],
          type: "enum",
          defaultValue: "selection",
          options: [
            { value: "none", label: "None" },
            { value: "boundary", label: "Boundary" },
            { value: "selection", label: "Selection" },
            { value: "all", label: "All" }
          ]
        },
        {
          id: "core.editor.texteditor.cursorBlinking",
          moduleId: "core.editor.texteditor",
          title: "Cursor Blinking",
          description: "Controls the cursor animation style.",
          sectionPath: ["Editor", "Cursor"],
          tags: ["cursor", "blinking"],
          type: "enum",
          defaultValue: "blink",
          options: [
            { value: "blink", label: "Blink" },
            { value: "smooth", label: "Smooth" },
            { value: "phase", label: "Phase" },
            { value: "solid", label: "Solid" }
          ]
        }
      ]
    });

    coreEditorTextPlugin.activate(context);
    coreEditorImagePlugin.activate(context);

    context.quickcommand.registerProvider({
      when: "hasActiveTextEditor",
      prefix: ">",
      label: "Editor",
      order: 10,
      getItems: (_query, _ctx) => {
        const actions = [
          { id: "editor.find", title: "Find", description: "Open find widget", commandId: "core.editor.text.find" },
          { id: "editor.toggleComment", title: "Toggle Line Comment", description: "Comment or uncomment lines", commandId: "core.editor.text.toggleCommentLine" },
          { id: "editor.trimWhitespace", title: "Trim Trailing Whitespace", description: "Remove trailing whitespace from all lines", commandId: "core.editor.text.trimTrailingWhitespace" },
          { id: "editor.selectAll", title: "Select All", description: "Select all content in the editor", commandId: "core.editor.text.selectAll" }
        ];

        return actions.map((a) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          action: () => {
            void context.commands.executeCommand(a.commandId);
          }
        }));
      }
    });
  }
};
