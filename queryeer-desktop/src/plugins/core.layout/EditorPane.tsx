import type { FileEntity } from "../../contracts/files/FileEntity";
import type { LayoutEditorContribution, LayoutWelcomeContribution } from "../../contracts/extensions/LayoutExtension";

type EditorPaneProps = {
  activeFile: FileEntity | null;
  activeEditor: LayoutEditorContribution | null;
  welcomes: LayoutWelcomeContribution[];
};

export function EditorPane({ activeFile, activeEditor, welcomes }: EditorPaneProps) {
  return (
    <div className="shell-editor-content">
      {activeEditor ? (
        <div key={activeEditor.id} className="shell-editor-pane">{activeEditor.render({ activeFile: activeFile ?? undefined })}</div>
      ) : welcomes.length > 0 ? (
        welcomes.map((welcome) => (
          <article key={welcome.id} className="panel-card panel-card-wide">
            {welcome.render()}
          </article>
        ))
      ) : null}
    </div>
  );
}
