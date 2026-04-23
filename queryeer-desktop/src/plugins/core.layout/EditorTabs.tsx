import { useState } from "react";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { LayoutEditorContribution } from "../../contracts/extensions/LayoutExtension";
import type { TooltipSectionContribution } from "../../contracts/extensions/TooltipExtension";
import { TabTooltip, buildTabTooltip } from "./TabTooltip";

type HoveredTab = {
  fileId: string;
  rect: DOMRect;
};

type EditorTabsProps = {
  openFiles: FileEntity[];
  activeFileId: string | null;
  editorsById: Map<string, LayoutEditorContribution>;
  tabsRef: React.RefObject<HTMLDivElement>;
  onSelectFile: (fileId: string) => void;
  onCloseFile: (fileId: string) => void;
  tooltipContributions?: TooltipSectionContribution[];
};

export function EditorTabs({
  openFiles,
  activeFileId,
  editorsById,
  tabsRef,
  onSelectFile,
  onCloseFile,
  tooltipContributions = []
}: EditorTabsProps) {
  const [hoveredTab, setHoveredTab] = useState<HoveredTab | null>(null);

  if (openFiles.length === 0) {
    return null;
  }

  const tabTitle = (file: FileEntity, editor: LayoutEditorContribution | undefined) => {
    return file.uri.startsWith("file://")
      ? file.uri.split("/").pop()
      : editor?.title ?? file.uri;
  };

  const tooltipProps = hoveredTab
    ? buildTabTooltip(
        openFiles.find((f) => f.fileId === hoveredTab.fileId)!,
        tooltipContributions
      )
    : { sections: [] };

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
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHoveredTab({ fileId: file.fileId, rect });
            }}
            onMouseLeave={() => setHoveredTab(null)}
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
      {hoveredTab && tooltipProps.sections.length > 0 && (
        <div
          className="shell-tab-tooltip"
          style={{
            left: hoveredTab.rect.left,
            top: hoveredTab.rect.bottom + 4
          }}
        >
          <TabTooltip {...tooltipProps} />
        </div>
      )}
    </div>
  );
}
