import type { ContextMenuProvider } from "@queryeer/api/extensions/ContextMenuExtension";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";

function rot13(str: string): string {
  return str.replace(/[a-zA-Z]/g, (char) => {
    const code = char.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

export function registerFooEditorContextMenu(context: PluginContext): void {
  const provider: ContextMenuProvider = {
    id: "example.custom-editor.foo",
    getItems: async (ctx) => {
      if (ctx.mimeType !== "application/x-foo") {
        return [];
      }
      return [
        {
          id: "example.custom-editor.rot13",
          label: "Transform Selection (Rot13)",
          order: 10,
          run: () => {
            const editor = context.editors.getActiveEditor();
            const selection = editor?.selection?.getSelection();
            const selectedText = editor?.selection?.getSelectedText();
            if (!selection || !selectedText) {
              context.notifications.notify({
                title: "Rot13 Transform",
                message: "Select text in the Foo Editor first, then right-click.",
                severity: "info"
              });
              return;
            }
            const range = {
              startLineNumber: selection.selectionStartLineNumber,
              startColumn: selection.selectionStartColumn,
              endLineNumber: selection.positionLineNumber,
              endColumn: selection.positionColumn
            };
            const version = editor?.versionedTextEdit?.getVersionId();
            if (version === undefined) {
              return;
            }
            const result = editor?.versionedTextEdit?.replaceRange(
              version,
              range,
              rot13(selectedText)
            );
            if (result && !result.ok) {
              context.notifications.notify({
                title: "Rot13 Transform Failed",
                message: result.reason ?? "Unknown error",
                severity: "error"
              });
            }
          }
        }
      ];
    }
  };

  context.contextMenu.registerProvider(provider);
}
