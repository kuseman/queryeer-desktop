import type { PluginContext } from "../../../../contracts/plugin/Plugin";
import type { TextEditorRegistry } from "../TextEditorRegistry";
import type { TextRange } from "../types";

export function registerTextEditorCommands(
  context: PluginContext,
  registry: TextEditorRegistry
): void {
  context.commands.registerCommand({
    id: "core.editor.text.undo",
    title: "Undo",
    handler: async () => {
      registry.getActiveEditor()?.pushUndoStop();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.redo",
    title: "Redo",
    handler: async () => {
      registry.getActiveEditor()?.popUndoStop();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.format",
    title: "Format Document",
    handler: async () => {
      await registry.getActiveEditor()?.format();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.formatSelection",
    title: "Format Selection",
    handler: async () => {
      const editor = registry.getActiveEditor();
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
      registry.getActiveEditor()?.find("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.findNext",
    title: "Find Next",
    handler: async () => {
      registry.getActiveEditor()?.findNext("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.findPrevious",
    title: "Find Previous",
    handler: async () => {
      registry.getActiveEditor()?.findPrevious("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.closeFindWidget",
    title: "Close Find Widget",
    handler: async () => {
      registry.getActiveEditor()?.closeFindWidget();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.goToDefinition",
    title: "Go to Definition",
    handler: async () => {
      await registry.getActiveEditor()?.goToDefinition();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.peekDefinition",
    title: "Peek Definition",
    handler: async () => {
      await registry.getActiveEditor()?.peekDefinition();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.goToTypeDefinition",
    title: "Go to Type Definition",
    handler: async () => {
      await registry.getActiveEditor()?.goToTypeDefinition();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.goToImplementation",
    title: "Go to Implementation",
    handler: async () => {
      await registry.getActiveEditor()?.goToImplementation();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.peekImplementation",
    title: "Peek Implementation",
    handler: async () => {
      await registry.getActiveEditor()?.peekImplementation();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.findReferences",
    title: "Find References",
    handler: async () => {
      await registry.getActiveEditor()?.findReferences();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.toggleCommentLine",
    title: "Toggle Line Comment",
    handler: async () => {
      registry.getActiveEditor()?.toggleCommentLine();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.addCommentLine",
    title: "Add Line Comment",
    handler: async () => {
      registry.getActiveEditor()?.addCommentLine();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.removeCommentLine",
    title: "Remove Line Comment",
    handler: async () => {
      registry.getActiveEditor()?.removeCommentLine();
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.insertSnippet",
    title: "Insert Snippet",
    handler: async () => {
      registry.getActiveEditor()?.insertSnippetAtCursor("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.selectAll",
    title: "Select All",
    handler: async () => {
      const editor = registry.getActiveEditor();
      const model = editor?.getModel();
      if (editor && model) {
        editor.setSelection({
          selectionStartLineNumber: 1,
          selectionStartColumn: 1,
          positionLineNumber: model.lineCount,
          positionColumn: model.lineAt(model.lineCount).range.endColumn
        });
      }
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.copyLineUp",
    title: "Copy Line Up",
    handler: async () => {
      registry.getActiveEditor()?.insertSnippet("\n");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.copyLineDown",
    title: "Copy Line Down",
    handler: async () => {
      registry.getActiveEditor()?.insertSnippet("\n");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.moveLineUp",
    title: "Move Line Up",
    handler: async () => {
      registry.getActiveEditor()?.insertSnippet("\n");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.moveLineDown",
    title: "Move Line Down",
    handler: async () => {
      registry.getActiveEditor()?.insertSnippet("\n");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.deleteLine",
    title: "Delete Line",
    handler: async () => {
      const editor = registry.getActiveEditor();
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
      registry.getActiveEditor()?.insertSnippet("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.sortLinesAscending",
    title: "Sort Lines Ascending",
    handler: async () => {
      registry.getActiveEditor()?.insertSnippet("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.sortLinesDescending",
    title: "Sort Lines Descending",
    handler: async () => {
      registry.getActiveEditor()?.insertSnippet("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.trimTrailingWhitespace",
    title: "Trim Trailing Whitespace",
    handler: async () => {
      const editor = registry.getActiveEditor();
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
    id: "core.editor.textindent",
    title: "Indent",
    handler: async () => {
      registry.getActiveEditor()?.insertSnippet("");
    }
  });

  context.commands.registerCommand({
    id: "core.editor.text.outdent",
    title: "Outdent",
    handler: async () => {
      registry.getActiveEditor()?.insertSnippet("");
    }
  });
}