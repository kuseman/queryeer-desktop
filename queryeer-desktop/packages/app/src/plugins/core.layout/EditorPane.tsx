import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { LayoutEditorContribution, LayoutWelcomeContribution } from "@queryeer/api/extensions/LayoutExtension";
import PluginErrorBoundary from "./PluginErrorBoundary";

type EditorPaneProps = {
  activeFile: FileEntity | null;
  activeEditor: LayoutEditorContribution | null;
  welcomes: LayoutWelcomeContribution[];
};

export function EditorPane({ activeFile, activeEditor, welcomes }: EditorPaneProps) {
  return (
    <div className="shell-editor-content">
      {activeEditor ? (
        <PluginErrorBoundary pluginId={activeEditor.id} pluginName={activeEditor.title}>
          <div key={activeEditor.id} className="shell-editor-pane">{activeEditor.render({ activeFile: activeFile ?? undefined })}</div>
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
