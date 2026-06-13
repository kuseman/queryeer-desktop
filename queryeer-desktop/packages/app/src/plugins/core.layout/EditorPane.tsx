import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type {
  LayoutEditorContribution,
  LayoutEditorInstanceContext,
  LayoutWelcomeContribution
} from "@queryeer/api/extensions/LayoutExtension";
import PluginErrorBoundary from "./PluginErrorBoundary";

type EditorPaneProps = {
  activeFile: FileEntity | null;
  activeEditor: LayoutEditorContribution | null;
  editorInstanceContext: LayoutEditorInstanceContext;
  welcomes: LayoutWelcomeContribution[];
};

export function EditorPane({ activeFile, activeEditor, editorInstanceContext, welcomes }: EditorPaneProps) {
  return (
    <div className="shell-editor-content">
      {activeEditor ? (
        <PluginErrorBoundary pluginId={activeEditor.id} pluginName={activeEditor.title}>
          <div
            key={activeEditor.id}
            className="shell-editor-pane"
            data-editor-instance-id={editorInstanceContext.editorInstanceId}
          >
            {activeEditor.render({
              ...editorInstanceContext,
              activeFile: activeFile ?? undefined
            })}
          </div>
        </PluginErrorBoundary>
      ) : welcomes.length > 0 ? (
        welcomes.map((welcome) => (
          <PluginErrorBoundary key={welcome.id} pluginId={welcome.id}>
            <article className="panel-card panel-card-wide">
              {welcome.render()}
            </article>
          </PluginErrorBoundary>
        ))
      ) : null}
    </div>
  );
}
