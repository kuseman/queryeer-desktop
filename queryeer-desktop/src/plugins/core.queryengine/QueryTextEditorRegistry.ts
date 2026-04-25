import { TextEditorRegistry } from "../core.editor/TextEditor/TextEditorRegistry";
import { registerTextEditorRepository } from "../core.editor/TextEditor/TextEditorModelRepository";

const queryRegistry = new TextEditorRegistry();
registerTextEditorRepository(queryRegistry);

export const queryTextRegistry = queryRegistry;
