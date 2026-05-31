import { useMemo } from "react";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import fooEditorStyles from "./foo-editor.css";

const STYLE_ID = "example-custom-editor-styles";

export function injectFooEditorStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = fooEditorStyles;
  document.head.appendChild(style);
}

type FooEditorProps = {
  fileUri: string;
  file?: FileEntity;
  pluginContext: PluginContext;
};

export function FooEditor({ fileUri, file, pluginContext: context }: FooEditorProps) {
  const metadata = useMemo(() => {
    const name = fileUri.split("/").pop() ?? "unknown";
    return { fileName: name, fileType: "application/x-foo" };
  }, [fileUri]);

  const EditorComponent = context.components.FrameworkEditor;

  return (
    <div className="foo-editor">
      <div className="foo-editor-header">
        <h2>Foo Editor — {metadata.fileName}</h2>
      </div>
      <div className="foo-editor-metadata">
        <dl>
          <dt>File</dt>
          <dd>{metadata.fileName}</dd>
          <dt>Type</dt>
          <dd>{metadata.fileType}</dd>
        </dl>
      </div>
      <div className="foo-editor-editor">
        <EditorComponent file={file} />
      </div>
      <div className="foo-editor-placeholder">
        <p>This example demonstrates:</p>
        <ul>
          <li>Custom MIME type registration (<code>application/x-foo</code>)</li>
          <li>Custom editor via <code>FrameworkEditor</code> component</li>
          <li>Tooltip section contribution</li>
          <li>Context menu provider — <strong>select text and right-click for Rot13</strong></li>
          <li>Outline provider (parses <code>key: value</code> headers)</li>
          <li>MIME type icon</li>
        </ul>
      </div>
    </div>
  );
}
