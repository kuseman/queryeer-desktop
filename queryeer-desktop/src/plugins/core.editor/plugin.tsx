import type { Plugin } from "../../contracts/plugin/Plugin";
import type { Selection, TextRange } from "../../contracts/editor/EditorApi";
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
        },
        {
          id: "core.editor.texteditor.acceptSuggestionOnEnter",
          moduleId: "core.editor.texteditor",
          title: "Accept Suggestion on Enter",
          description: "Controls whether pressing Enter accepts a completion suggestion. 'off' means Enter always inserts a new line (use Tab to accept suggestions).",
          sectionPath: ["Editor", "Suggestions"],
          tags: ["suggest", "completion", "enter", "accept"],
          type: "enum",
          defaultValue: "off",
          options: [
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
            { value: "smart", label: "Smart" }
          ]
        }
      ]
    });

    coreEditorTextPlugin.activate(context);
    coreEditorImagePlugin.activate(context);

    context.assistant.registerToolContribution({
      id: "core.editor.getSelection",
      title: "Get Editor Selection",
      description: "Fetch the active editor selection/document/query with fileId, Monaco document version, range, expectedText, and text. Before editing selected text, call this tool and pass its exact fileId, version, range, and expectedText to core.editor.replaceRange. If an edit fails because the document changed, call this tool again before retrying.",
      order: 5,
      when: "hasActiveTextEditor",
      inputSchema: {
        type: "object",
        properties: {}
      },
      invoke: () => {
        const editor = context.editors.getActiveEditor();
        const selection = editor?.selection?.getSelection() ?? null;
        const selectedText = editor?.selection?.getSelectedText() ?? null;
        const version = editor?.versionedTextEdit?.getVersionId();
        if (!editor?.fileId || version === undefined) {
          return { ok: false, message: "No active editable text document" };
        }
        if (!selection || !selectedText) {
          return {
            ok: true,
            message: "No editor selection is active.",
            data: {
              fileId: editor.fileId,
              version,
              selection: null,
              text: ""
            }
          };
        }
        const range = selectionToRange(selection);
        return {
          ok: true,
          message: `Fetched selection from v${version}.`,
          data: {
            fileId: editor.fileId,
            version,
            range,
            expectedText: selectedText,
            text: selectedText
          }
        };
      }
    });

    context.assistant.registerToolContribution({
      id: "core.editor.getDocument",
      title: "Get Editor Document",
      description: "Fetch the full active editor document/query with fileId, Monaco document version, and text. Use this when no selection is active, when selection context is insufficient, or after an edit failure asks you to re-read editor context. For whole-document rewrites, call core.editor.replaceDocument instead of calculating a full-document range.",
      order: 6,
      when: "hasActiveTextEditor",
      inputSchema: {
        type: "object",
        properties: {}
      },
      invoke: () => {
        const editor = context.editors.getActiveEditor();
        const content = editor?.content?.getContent();
        const version = editor?.versionedTextEdit?.getVersionId();
        if (!editor?.fileId || content === undefined || version === undefined) {
          return { ok: false, message: "No active editable text document" };
        }
        return {
          ok: true,
          message: `Fetched document v${version}.`,
          data: {
            fileId: editor.fileId,
            version,
            text: content
          }
        };
      }
    });

    context.assistant.registerToolContribution({
      id: "core.editor.replaceDocument",
      title: "Replace Editor Document",
      description: "Replace the full active editor document only if the supplied Monaco document version still matches. Use this for whole-document rewrites after calling core.editor.getDocument. Pass the exact fileId, version, and replacement text from the fresh document response; do not use core.editor.replaceRange for full-document rewrites. Do not include expectedText unless copying it exactly from core.editor.getDocument.",
      order: 9,
      when: "hasActiveTextEditor",
      inputSchema: {
        type: "object",
        required: ["fileId", "version", "text"],
        properties: {
          fileId: { type: "string" },
          version: { type: "number" },
          expectedText: { type: "string" },
          text: { type: "string" }
        }
      },
      getApproval: ({ input }) => {
        const parsed = parseDocumentEditInput(input);
        if (!parsed.ok) {
          return {
            title: "Replace editor document",
            summary: parsed.message
          };
        }
        return {
          title: "Replace editor document",
          summary: `Replace full document ${parsed.value.fileId} at v${parsed.value.version}`,
          details: [
            { label: "File", value: parsed.value.fileId },
            { label: "Version", value: String(parsed.value.version) }
          ],
          before: parsed.value.expectedText,
          after: parsed.value.text
        };
      },
      invoke: ({ input }) => {
        const parsed = parseDocumentEditInput(input);
        if (!parsed.ok) {
          return { ok: false, message: parsed.message };
        }
        const editor = context.editors.getActiveEditor();
        const currentText = editor?.content?.getContent();
        if (!editor?.fileId || editor.fileId !== parsed.value.fileId || !editor.versionedTextEdit || currentText === undefined) {
          return { ok: false, message: "The requested file is not the active editable document" };
        }
        if (sameToolText(currentText, parsed.value.text)) {
          return {
            ok: false,
            message: "The replacement text is identical to the current document. Check that the tool arguments were not swapped: text must be the desired new document, not the old document.",
            data: {
              ...(parsed.value.expectedText !== undefined ? { expectedTextLooksDifferent: !sameToolText(currentText, parsed.value.expectedText) } : {})
            }
          };
        }
        const result = editor.versionedTextEdit.replaceRange(
          parsed.value.version,
          documentRangeFromText(currentText),
          parsed.value.text
        );
        if (result.ok) {
          return { ok: true, message: `Replaced document. Document is now v${result.version}.`, data: result };
        }
        if (result.reason === "versionMismatch") {
          return {
            ok: false,
            message: `The document changed since this edit was prepared. Re-read the editor document and try again. Expected v${result.expectedVersion}, current v${result.actualVersion}.`
          };
        }
        if (result.reason === "invalidRange") {
          return {
            ok: false,
            message: `The editor document range is invalid: ${result.message}. Re-read the editor document and try again.`
          };
        }
        return { ok: false, message: "Editor rejected the document replacement", data: result };
      }
    });

    context.assistant.registerToolContribution({
      id: "core.editor.replaceRange",
      title: "Replace Text Range",
      description: "Replace a small text range in the active editor only if the supplied Monaco document version still matches. First call core.editor.getSelection or core.editor.getDocument, then use the exact fileId and version from that fresh response. Include expectedText whenever replacing existing text. For whole-document rewrites, use core.editor.replaceDocument instead. If this tool returns stale version, invalid range, or expectedText mismatch, re-fetch editor context and retry at most once.",
      order: 10,
      when: "hasActiveTextEditor",
      inputSchema: {
        type: "object",
        required: ["fileId", "version", "range", "text"],
        properties: {
          fileId: { type: "string" },
          version: { type: "number" },
          range: {
            type: "object",
            required: ["startLineNumber", "startColumn", "endLineNumber", "endColumn"],
            properties: {
              startLineNumber: { type: "number" },
              startColumn: { type: "number" },
              endLineNumber: { type: "number" },
              endColumn: { type: "number" }
            }
          },
          expectedText: { type: "string" },
          text: { type: "string" }
        }
      },
      getApproval: ({ input }) => {
        const parsed = parseTextEditInput(input);
        if (!parsed.ok) {
          return {
            title: "Replace editor text",
            summary: parsed.message
          };
        }
        return {
          title: "Replace editor text",
          summary: `Replace range ${formatRange(parsed.value.range)} in ${parsed.value.fileId} at v${parsed.value.version}`,
          details: [
            { label: "File", value: parsed.value.fileId },
            { label: "Version", value: String(parsed.value.version) },
            { label: "Range", value: formatRange(parsed.value.range) }
          ],
          before: parsed.value.expectedText,
          after: parsed.value.text
        };
      },
      invoke: ({ input }) => {
        const parsed = parseTextEditInput(input);
        if (!parsed.ok) {
          return { ok: false, message: parsed.message };
        }
        const editor = context.editors.getActiveEditor();
        if (!editor?.fileId || editor.fileId !== parsed.value.fileId || !editor.versionedTextEdit) {
          return { ok: false, message: "The requested file is not the active editable document" };
        }
        if (parsed.value.expectedText !== undefined) {
          const currentText = editor.selection?.getContentFromRange?.(parsed.value.range);
          if (currentText === undefined) {
            return { ok: false, message: "The active editor cannot verify the expected text for this range" };
          }
          if (normalizeToolText(currentText) !== normalizeToolText(parsed.value.expectedText)) {
            return {
              ok: false,
              message: "The text at the requested range does not match expectedText. Re-read the editor context and use the exact range from context. For whole-document rewrites, use core.editor.replaceDocument instead of core.editor.replaceRange.",
              data: textMismatchData(currentText, parsed.value.expectedText)
            };
          }
        }
        const result = editor.versionedTextEdit.replaceRange(
          parsed.value.version,
          parsed.value.range,
          parsed.value.text
        );
        if (result.ok) {
          return { ok: true, message: `Applied edit. Document is now v${result.version}.`, data: result };
        }
        if (result.reason === "versionMismatch") {
          return {
            ok: false,
            message: `The document changed since this edit was prepared. Re-read the editor context and try again. Expected v${result.expectedVersion}, current v${result.actualVersion}.`
          };
        }
        if (result.reason === "invalidRange") {
          return {
            ok: false,
            message: `The requested editor range is invalid: ${result.message}. Re-read the editor context and use the exact range from context.`
          };
        }
        return { ok: false, message: "Editor rejected the edit", data: result };
      }
    });

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

function selectionToRange(selection: Selection): TextRange {
  if (selection.selectionStartLineNumber === selection.positionLineNumber) {
    return {
      startLineNumber: selection.selectionStartLineNumber,
      startColumn: Math.min(selection.selectionStartColumn, selection.positionColumn),
      endLineNumber: selection.positionLineNumber,
      endColumn: Math.max(selection.selectionStartColumn, selection.positionColumn)
    };
  }
  const startLineNumber = Math.min(selection.selectionStartLineNumber, selection.positionLineNumber);
  const endLineNumber = Math.max(selection.selectionStartLineNumber, selection.positionLineNumber);
  const startColumn = startLineNumber === selection.selectionStartLineNumber
    ? selection.selectionStartColumn
    : selection.positionColumn;
  const endColumn = endLineNumber === selection.positionLineNumber
    ? selection.positionColumn
    : selection.selectionStartColumn;
  return { startLineNumber, startColumn, endLineNumber, endColumn };
}

function formatRange(range: TextRange): string {
  return `${range.startLineNumber}:${range.startColumn}-${range.endLineNumber}:${range.endColumn}`;
}

export function normalizeToolText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function sameToolText(left: string, right: string): boolean {
  return normalizeToolText(left) === normalizeToolText(right);
}

export function documentRangeFromText(text: string): TextRange {
  const lines = normalizeToolText(text).split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: lines.length,
    endColumn: lastLine.length + 1
  };
}

function textMismatchData(actualText: string, expectedText: string): Record<string, unknown> {
  const actual = normalizeToolText(actualText);
  const expected = normalizeToolText(expectedText);
  return {
    actualLength: actual.length,
    expectedLength: expected.length,
    firstMismatchOffset: firstMismatchOffset(actual, expected),
    actualPreview: previewText(actual),
    expectedPreview: previewText(expected)
  };
}

function firstMismatchOffset(left: string, right: string): number | null {
  const max = Math.min(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    if (left[index] !== right[index]) {
      return index;
    }
  }
  return left.length === right.length ? null : max;
}

function previewText(text: string): string {
  return text.length <= 500 ? text : `${text.slice(0, 500)}...`;
}

type EditorTextEditInput = {
  fileId: string;
  version: number;
  range: TextRange;
  expectedText?: string;
  text: string;
};

type EditorDocumentEditInput = {
  fileId: string;
  version: number;
  expectedText?: string;
  text: string;
};

function parseTextEditInput(input: unknown): { ok: true; value: EditorTextEditInput } | { ok: false; message: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, message: "Tool input must be an object" };
  }
  const record = input as Record<string, unknown>;
  const range = record.range;
  if (typeof record.fileId !== "string" || !record.fileId.trim()) {
    return { ok: false, message: "Tool input requires fileId" };
  }
  if (typeof record.version !== "number" || !Number.isFinite(record.version)) {
    return { ok: false, message: "Tool input requires numeric version" };
  }
  if (!isTextRange(range)) {
    return { ok: false, message: "Tool input requires a valid range" };
  }
  if (typeof record.text !== "string") {
    return { ok: false, message: "Tool input requires text" };
  }
  if (record.expectedText !== undefined && typeof record.expectedText !== "string") {
    return { ok: false, message: "Tool input expectedText must be a string when provided" };
  }
  return {
    ok: true,
    value: {
      fileId: record.fileId,
      version: record.version,
      range,
      ...(record.expectedText !== undefined ? { expectedText: record.expectedText } : {}),
      text: record.text
    }
  };
}

function parseDocumentEditInput(input: unknown): { ok: true; value: EditorDocumentEditInput } | { ok: false; message: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, message: "Tool input must be an object" };
  }
  const record = input as Record<string, unknown>;
  if (typeof record.fileId !== "string" || !record.fileId.trim()) {
    return { ok: false, message: "Tool input requires fileId" };
  }
  if (typeof record.version !== "number" || !Number.isFinite(record.version)) {
    return { ok: false, message: "Tool input requires numeric version" };
  }
  if (typeof record.text !== "string") {
    return { ok: false, message: "Tool input requires text" };
  }
  if (record.expectedText !== undefined && typeof record.expectedText !== "string") {
    return { ok: false, message: "Tool input expectedText must be a string when provided" };
  }
  return {
    ok: true,
    value: {
      fileId: record.fileId,
      version: record.version,
      ...(record.expectedText !== undefined ? { expectedText: record.expectedText } : {}),
      text: record.text
    }
  };
}

function isTextRange(value: unknown): value is TextRange {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return ["startLineNumber", "startColumn", "endLineNumber", "endColumn"]
    .every((key) => typeof record[key] === "number" && Number.isInteger(record[key]) && record[key] > 0);
}
