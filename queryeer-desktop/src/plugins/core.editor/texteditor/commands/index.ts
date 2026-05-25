import type { PluginContext } from "../../../../contracts/plugin/Plugin";
import type { TextEditorRegistry } from "../TextEditorRegistry";
import type { TextRange } from "../types";

function runDocumentCommand(command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"): void {
  if (typeof window !== "undefined" && window.appShell) {
    if (command === "undo") {
      void window.appShell.undo();
      return;
    }
    if (command === "redo") {
      void window.appShell.redo();
      return;
    }
    if (command === "cut") {
      void window.appShell.cut();
      return;
    }
    if (command === "copy") {
      void window.appShell.copy();
      return;
    }
    if (command === "paste") {
      void window.appShell.paste();
      return;
    }
    void window.appShell.selectAll();
    return;
  }

  if (typeof document === "undefined") {
    return;
  }
  document.execCommand(command);
}

function executeEditCommand(
  registry: TextEditorRegistry,
  command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"
): void {
  const editor = registry.getCommandTargetEditor();
  if (editor?.getModel()) {
    editor.focus();
    if (command === "undo") {
      editor.undo();
      return;
    }
    if (command === "redo") {
      editor.redo();
      return;
    }
    if (command === "cut" || command === "copy" || command === "paste") {
      runDocumentCommand(command);
      return;
    }
    editor.selectAll();
    return;
  }

  runDocumentCommand(command);
}

export function registerTextEditorCommands(
  context: PluginContext,
  registry: TextEditorRegistry
): void {
  context.commands.registerCommand({
    id: "core.edit.undo",
    title: "Undo",
    handler: async () => {
      executeEditCommand(registry, "undo");
    }
  });

  context.commands.registerCommand({
    id: "core.edit.redo",
    title: "Redo",
    handler: async () => {
      executeEditCommand(registry, "redo");
    }
  });

  context.commands.registerCommand({
    id: "core.edit.cut",
    title: "Cut",
    handler: async () => {
      executeEditCommand(registry, "cut");
    }
  });

  context.commands.registerCommand({
    id: "core.edit.copy",
    title: "Copy",
    handler: async () => {
      executeEditCommand(registry, "copy");
    }
  });

  context.commands.registerCommand({
    id: "core.edit.paste",
    title: "Paste",
    handler: async () => {
      executeEditCommand(registry, "paste");
    }
  });

  context.commands.registerCommand({
    id: "core.edit.selectAll",
    title: "Select All",
    handler: async () => {
      executeEditCommand(registry, "selectAll");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.undo",
    title: "Undo",
    handler: async () => {
      executeEditCommand(registry, "undo");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.redo",
    title: "Redo",
    handler: async () => {
      executeEditCommand(registry, "redo");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.format",
    title: "Format Document",
    handler: async () => {
      await registry.getCommandTargetEditor()?.format();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.formatSelection",
    title: "Format Selection",
    handler: async () => {
      const editor = registry.getCommandTargetEditor();
      const selection = editor?.getSelection();
      if (editor && selection) {
        const range: TextRange = {
          startLineNumber: selection.selectionStartLineNumber,
          startColumn: selection.selectionStartColumn,
          endLineNumber: selection.positionLineNumber,
          endColumn: selection.positionColumn
        };
        await editor.formatRange(range);
      }
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.find",
    title: "Find",
    handler: async () => {
      registry.getCommandTargetEditor()?.find("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.findNext",
    title: "Find Next",
    handler: async () => {
      registry.getCommandTargetEditor()?.findNext("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.findPrevious",
    title: "Find Previous",
    handler: async () => {
      registry.getCommandTargetEditor()?.findPrevious("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.closeFindWidget",
    title: "Close Find Widget",
    handler: async () => {
      registry.getCommandTargetEditor()?.closeFindWidget();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.toggleCommentLine",
    title: "Toggle Line Comment",
    handler: async () => {
      registry.getCommandTargetEditor()?.toggleCommentLine();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.addCommentLine",
    title: "Add Line Comment",
    handler: async () => {
      registry.getCommandTargetEditor()?.addCommentLine();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.removeCommentLine",
    title: "Remove Line Comment",
    handler: async () => {
      registry.getCommandTargetEditor()?.removeCommentLine();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.insertSnippet",
    title: "Insert Snippet",
    handler: async () => {
      registry.getCommandTargetEditor()?.insertSnippetAtCursor("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.selectAll",
    title: "Select All",
    handler: async () => {
      executeEditCommand(registry, "selectAll");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.copyLineUp",
    title: "Copy Line Up",
    handler: async () => {
      registry.getCommandTargetEditor()?.copyLineUp();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.copyLineDown",
    title: "Copy Line Down",
    handler: async () => {
      registry.getCommandTargetEditor()?.copyLineDown();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.moveLineUp",
    title: "Move Line Up",
    handler: async () => {
      registry.getCommandTargetEditor()?.moveLineUp();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.moveLineDown",
    title: "Move Line Down",
    handler: async () => {
      registry.getCommandTargetEditor()?.moveLineDown();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.deleteLine",
    title: "Delete Line",
    handler: async () => {
      const editor = registry.getCommandTargetEditor();
      const selection = editor?.getSelection();
      if (editor && selection) {
        editor.executeEdits([{
          type: "delete",
          range: {
            startLineNumber: selection.selectionStartLineNumber,
            startColumn: 1,
            endLineNumber: selection.positionLineNumber + 1,
            endColumn: 1
          }
        }]);
      }
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.joinLines",
    title: "Join Lines",
    handler: async () => {
      registry.getCommandTargetEditor()?.joinLines();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.sortLinesAscending",
    title: "Sort Lines Ascending",
    handler: async () => {
      registry.getCommandTargetEditor()?.sortLinesAscending();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.sortLinesDescending",
    title: "Sort Lines Descending",
    handler: async () => {
      registry.getCommandTargetEditor()?.sortLinesDescending();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.trimTrailingWhitespace",
    title: "Trim Trailing Whitespace",
    handler: async () => {
      const editor = registry.getCommandTargetEditor();
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;
      const lines: { range: TextRange; newText: string }[] = [];
      for (let i = 1; i <= model.lineCount; i++) {
        const line = model.lineAt(i);
        const trimmed = line.text.trimEnd();
        if (trimmed !== line.text) {
          lines.push({
            range: line.range,
            newText: trimmed
          });
        }
      }
      editor.applyEdits(lines);
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.indent",
    title: "Indent",
    handler: async () => {
      registry.getCommandTargetEditor()?.indentLines();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.outdent",
    title: "Outdent",
    handler: async () => {
      registry.getCommandTargetEditor()?.outdentLines();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.transformToUppercase",
    title: "Transform to Uppercase",
    handler: async () => {
      registry.getCommandTargetEditor()?.transformToUppercase();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.transformToLowercase",
    title: "Transform to Lowercase",
    handler: async () => {
      registry.getCommandTargetEditor()?.transformToLowercase();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.transformToTitleCase",
    title: "Transform to Title Case",
    handler: async () => {
      registry.getCommandTargetEditor()?.transformToTitleCase();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.transformToSnakeCase",
    title: "Transform to Snake Case",
    handler: async () => {
      registry.getCommandTargetEditor()?.transformToSnakeCase();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.transformToCamelCase",
    title: "Transform to Camel Case",
    handler: async () => {
      registry.getCommandTargetEditor()?.transformToCamelCase();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.transformToPascalCase",
    title: "Transform to Pascal Case",
    handler: async () => {
      registry.getCommandTargetEditor()?.transformToPascalCase();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.transformToKebabCase",
    title: "Transform to Kebab Case",
    handler: async () => {
      registry.getCommandTargetEditor()?.transformToKebabCase();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.blockComment",
    title: "Toggle Block Comment",
    handler: async () => {
      registry.getCommandTargetEditor()?.blockComment();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.duplicateSelection",
    title: "Duplicate Selection",
    handler: async () => {
      registry.getCommandTargetEditor()?.duplicateSelection();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.removeDuplicateLines",
    title: "Delete Duplicate Lines",
    handler: async () => {
      registry.getCommandTargetEditor()?.removeDuplicateLines();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.reverseLines",
    title: "Reverse Lines",
    handler: async () => {
      registry.getCommandTargetEditor()?.reverseLines();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.insertLineBefore",
    title: "Insert Line Above",
    handler: async () => {
      registry.getCommandTargetEditor()?.insertLineBefore();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.insertLineAfter",
    title: "Insert Line Below",
    handler: async () => {
      registry.getCommandTargetEditor()?.insertLineAfter();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.insertCursorAbove",
    title: "Add Cursor Above",
    handler: async () => {
      registry.getCommandTargetEditor()?.insertCursorAbove();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.insertCursorBelow",
    title: "Add Cursor Below",
    handler: async () => {
      registry.getCommandTargetEditor()?.insertCursorBelow();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.insertCursorAtEndOfLines",
    title: "Add Cursors to Line Ends",
    handler: async () => {
      registry.getCommandTargetEditor()?.insertCursorAtEndOfLines();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.selectAllOccurrences",
    title: "Select All Occurrences",
    handler: async () => {
      registry.getCommandTargetEditor()?.selectAllOccurrences();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.addSelectionToNextFindMatch",
    title: "Add Selection to Next Find Match",
    handler: async () => {
      registry.getCommandTargetEditor()?.addSelectionToNextFindMatch();
    }
  });
}
