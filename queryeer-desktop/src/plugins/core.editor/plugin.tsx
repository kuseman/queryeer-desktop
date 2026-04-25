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
    context.settings.registerSettings({
      moduleId: "core.editor",
      title: "Editor",
      order: 30,
      settings: [
        {
          id: "core.editor.fontSize",
          moduleId: "core.editor",
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
          id: "core.editor.fontFamily",
          moduleId: "core.editor",
          title: "Font Family",
          description: "Controls the editor font family.",
          sectionPath: ["Editor", "Font"],
          tags: ["font", "family", "typography"],
          type: "string",
          defaultValue: "JetBrains Mono, Consolas, monospace"
        },
        {
          id: "core.editor.wordWrap",
          moduleId: "core.editor",
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
          id: "core.editor.tabSize",
          moduleId: "core.editor",
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
          id: "core.editor.insertSpaces",
          moduleId: "core.editor",
          title: "Insert Spaces",
          description: "Insert spaces when pressing Tab.",
          sectionPath: ["Editor", "Formatting"],
          tags: ["tab", "spaces", "indent"],
          type: "boolean",
          defaultValue: true
        },
        {
          id: "core.editor.lineNumbers",
          moduleId: "core.editor",
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
          id: "core.editor.minimap.enabled",
          moduleId: "core.editor",
          title: "Minimap Enabled",
          description: "Controls whether the editor minimap is shown.",
          sectionPath: ["Editor", "Appearance"],
          tags: ["minimap", "preview"],
          type: "boolean",
          defaultValue: true
        },
        {
          id: "core.editor.renderWhitespace",
          moduleId: "core.editor",
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
          id: "core.editor.formatOnSave",
          moduleId: "core.editor",
          title: "Format On Save",
          description: "Format files automatically when saving.",
          sectionPath: ["Editor", "Formatting"],
          tags: ["format", "save"],
          type: "boolean",
          defaultValue: false
        },
        {
          id: "core.editor.cursorBlinking",
          moduleId: "core.editor",
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
  }
};
