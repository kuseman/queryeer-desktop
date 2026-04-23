import type { FileEntity } from "../../contracts/files/FileEntity";
import type { LayoutEditorContribution } from "../../contracts/extensions/LayoutExtension";

type EditorTabsProps = {
  openFiles: FileEntity[];
  activeFileId: string | null;
  editorsById: Map<string, LayoutEditorContribution>;
  tabsRef: React.RefObject<HTMLDivElement>;
  onSelectFile: (fileId: string) => void;
  onCloseFile: (fileId: string) => void;
};

export function EditorTabs({
  openFiles,
  activeFileId,
  editorsById,
  tabsRef,
  onSelectFile,
  onCloseFile
}: EditorTabsProps) {
  if (openFiles.length === 0) {
    return null;
  }

  const tabTitle = (file: FileEntity, editor: LayoutEditorContribution | undefined) => {
    return file.uri.startsWith("file://")
      ? file.uri.split("/").pop()
      : editor?.title ?? file.uri;
  };

  return (
    <div ref={tabsRef} className="shell-editor-tabs">
      {openFiles.map((file) => {
        const editor = file.editorId ? editorsById.get(file.editorId) : undefined;
        const title = tabTitle(file, editor);
        const dirtyMark = file.dirtyVsDisk || file.dirtyVsBackend ? " •" : "";
        return (
          <div
            key={file.fileId}
            data-file-id={file.fileId}
            className={`shell-editor-tab ${activeFileId === file.fileId ? "is-active" : ""}`}
          >
            <div
              role="button"
              className="shell-editor-tab-button"
              onClick={() => onSelectFile(file.fileId)}
            >
              <span className="shell-editor-tab-title">{`${title}${dirtyMark}`}</span>
            </div>
            <span
              role="button"
              className="shell-editor-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseFile(file.fileId);
              }}
              aria-label={`Close ${title}`}
            >
              ×
            </span>
          </div>
        );
      })}
    </div>
  );
}