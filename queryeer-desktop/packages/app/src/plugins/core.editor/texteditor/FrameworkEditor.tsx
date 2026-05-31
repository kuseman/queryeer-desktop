import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { TextEditorComponent } from "./TextEditorComponent";
import { getTextEditorRegistry } from "./TextEditorRegistry";
import { getEditorRegistryHost } from "../../../core/plugin-runtime/ExtensionRegistry";
import { getOutlineRegistry } from "../../../core/plugin-runtime/ExtensionRegistry";

export function FrameworkEditor({ file }: { file?: FileEntity }) {
  return (
    <TextEditorComponent
      file={file}
      registry={getTextEditorRegistry()}
      editorRegistryHost={getEditorRegistryHost()}
      outlineRegistry={getOutlineRegistry()}
    />
  );
}
