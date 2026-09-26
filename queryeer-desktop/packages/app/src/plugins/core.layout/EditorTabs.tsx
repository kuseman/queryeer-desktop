import { useState, useCallback, useEffect } from "react";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type {
  LayoutEditorContribution,
  LayoutActionIconRenderer,
  TabContextMenuContribution,
  TabContextMenuAction,
  TabHeaderStyleContribution,
  TabTitleContribution
} from "@queryeer/api/extensions/LayoutExtension";
import type { TooltipSectionContribution } from "@queryeer/api/extensions/TooltipExtension";
import type { MimeCapability, MimeIconProps } from "@queryeer/api/files/FilesRegistry";
import { TabTooltip, buildTabTooltip } from "./TabTooltip";
import { DocumentIcon } from "../../renderer/icons/DocumentIcon";
import { MaximizeEditorGroupIcon, RestoreEditorGroupIcon } from "../../renderer/icons/LayoutIcons";
import { getExpressionRuntime } from "../../plugins/core.expressions/runtime";

type HoveredTab = {
  fileId: string;
  rect: DOMRect;
};

type TabDropIndicator = {
  fileId: string;
  position: "before" | "after";
};

type DraggedTab = {
  editorGroupId: string;
  fileId: string;
};

const EDITOR_TAB_DRAG_TYPE = "application/x-queryeer-editor-tab";

type EditorTabsProps = {
  openFiles: FileEntity[];
  activeFileId: string | null;
  editorGroupId?: string;
  editorGroupIndex?: number;
  editorGroupCount?: number;
  editorsById: Map<string, LayoutEditorContribution>;
  tabsRef: React.Ref<HTMLDivElement>;
  onSelectFile: (fileId: string) => void;
  onCloseFile: (fileId: string) => void;
  onMoveFile?: (sourceGroupId: string, fileId: string, targetGroupId: string, targetIndex: number) => void;
  tooltipContributions?: TooltipSectionContribution[];
  tabContextMenus?: TabContextMenuContribution[];
  tabHeaderStyleContributions?: TabHeaderStyleContribution[];
  tabTitleContributions?: TabTitleContribution[];
  hasMimeCapability?: (mimeType: string, capability: MimeCapability) => boolean;
  getMimeIcon?: (mimeType: string) => ((props: MimeIconProps) => JSX.Element) | undefined;
  onTabContextMenuAction?: (actionId: string, file: FileEntity) => void;
  onTabContextMenuOpen?: (file: FileEntity | null) => void;
  canMaximizeGroup?: boolean;
  isGroupMaximized?: boolean;
  onToggleMaximizeGroup?: () => void;
};

export function EditorTabs({
  openFiles,
  activeFileId,
  editorGroupId,
  editorGroupIndex = 0,
  editorGroupCount = 1,
  editorsById,
  tabsRef,
  onSelectFile,
  onCloseFile,
  onMoveFile,
  tooltipContributions = [],
  tabContextMenus = [],
  tabHeaderStyleContributions = [],
  tabTitleContributions = [],
  hasMimeCapability,
  getMimeIcon,
  onTabContextMenuAction,
  onTabContextMenuOpen,
  canMaximizeGroup = false,
  isGroupMaximized = false,
  onToggleMaximizeGroup
}: EditorTabsProps) {
  const [hoveredTab, setHoveredTab] = useState<HoveredTab | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileEntity } | null>(null);
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<TabDropIndicator | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    if (onTabContextMenuOpen) {
      onTabContextMenuOpen(null);
    }
  }, [onTabContextMenuOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = () => closeContextMenu();
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [contextMenu, closeContextMenu]);

  useEffect(() => {
    const clearDragState = () => {
      setDraggedFileId(null);
      setDropIndicator(null);
    };
    document.addEventListener("dragend", clearDragState);
    document.addEventListener("drop", clearDragState, true);
    return () => {
      document.removeEventListener("dragend", clearDragState);
      document.removeEventListener("drop", clearDragState, true);
    };
  }, []);

  const handleDragStart = useCallback((event: React.DragEvent, fileId: string) => {
    if (!editorGroupId || !onMoveFile || (event.target as HTMLElement).closest(".shell-editor-tab-close")) {
      event.preventDefault();
      return;
    }
    const payload: DraggedTab = { editorGroupId, fileId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(EDITOR_TAB_DRAG_TYPE, JSON.stringify(payload));
    setHoveredTab(null);
    setDraggedFileId(fileId);
  }, [editorGroupId, onMoveFile]);

  const handleDragOverTab = useCallback((event: React.DragEvent<HTMLDivElement>, fileId: string) => {
    if (!event.dataTransfer.types.includes(EDITOR_TAB_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setDropIndicator({ fileId, position: event.clientX < rect.left + rect.width / 2 ? "before" : "after" });
    scrollTabListAtEdge(event.currentTarget.parentElement, event.clientX);
  }, []);

  const finishDrop = useCallback((event: React.DragEvent, targetIndex: number) => {
    if (!editorGroupId || !onMoveFile) {
      return;
    }
    const draggedTab = readDraggedTab(event.dataTransfer);
    if (!draggedTab) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onMoveFile(draggedTab.editorGroupId, draggedTab.fileId, editorGroupId, targetIndex);
    setDropIndicator(null);
  }, [editorGroupId, onMoveFile]);

  const handleDropOnTab = useCallback((event: React.DragEvent, fileId: string) => {
    const index = openFiles.findIndex((file) => file.fileId === fileId);
    if (index < 0) {
      return;
    }
    finishDrop(event, index + (dropIndicator?.fileId === fileId && dropIndicator.position === "after" ? 1 : 0));
  }, [dropIndicator, finishDrop, openFiles]);

  const handleDragOverList = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(EDITOR_TAB_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndicator(openFiles.length > 0
      ? { fileId: openFiles[openFiles.length - 1].fileId, position: "after" }
      : null
    );
    scrollTabListAtEdge(event.currentTarget, event.clientX);
  }, [openFiles]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: FileEntity) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, file });
      onTabContextMenuOpen?.(file);
    },
    [onTabContextMenuOpen]
  );

  const handleActionClick = useCallback(
    (action: TabContextMenuAction) => {
      if (contextMenu && onTabContextMenuAction) {
        onTabContextMenuAction(action.id, contextMenu.file);
      }
      setContextMenu(null);
    },
    [contextMenu, onTabContextMenuAction]
  );

  if (openFiles.length === 0) {
    return null;
  }

  const tooltipProps = hoveredTab
      ? buildTabTooltip(
         openFiles.find((f) => f.fileId === hoveredTab.fileId),
         tooltipContributions,
         editorGroupId
       )
    : { sections: [] };

  const allActions = tabContextMenus
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((contrib) => contrib.actions)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const orderedTabHeaderStyleContributions = [...tabHeaderStyleContributions].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  const orderedTabTitleContributions = [...tabTitleContributions].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  return (
    <div ref={tabsRef} className="shell-editor-tabs">
      <div
        className={`shell-editor-tabs-list ${dropIndicator ? "is-drag-over" : ""}`.trim()}
        onDragOver={handleDragOverList}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropIndicator(null);
          }
        }}
        onDrop={(event) => finishDrop(event, openFiles.length)}
      >
        {openFiles.map((file) => {
          const editor = file.editorId ? editorsById.get(file.editorId) : undefined;
          const title = composeTabTitle({
            file,
            editor,
            tabTitleContributions: orderedTabTitleContributions,
            hasMimeCapability,
            isActive: activeFileId === file.fileId
          });

          let titleClassName = "shell-editor-tab-title";
          const styleContext = {
            file,
            isActive: activeFileId === file.fileId,
            editorGroupId,
            hasCapability: (capability: MimeCapability) =>
              hasMimeCapability?.(file.mimeType, capability) ?? false
          };

          const tabHeaderStyle = orderedTabHeaderStyleContributions
            .map((contribution) => contribution.render(styleContext))
            .filter((style): style is NonNullable<typeof style> => style !== null)
            .reduce(
              (acc, style) => ({
                className: [acc.className, style.className].filter(Boolean).join(" "),
                indicatorClassName: [acc.indicatorClassName, style.indicatorClassName].filter(Boolean).join(" "),
                style: { ...acc.style, ...style.style },
                statusIcon: style.statusIcon ?? acc.statusIcon,
                statusIconTitle: style.statusIconTitle ?? acc.statusIconTitle
              }),
              {
                className: "",
                indicatorClassName: "",
                style: undefined as React.CSSProperties | undefined,
                statusIcon: undefined as LayoutActionIconRenderer | undefined,
                statusIconTitle: undefined as string | undefined
              }
            );

          if (file.diskState === "deletedOnDisk") {
            titleClassName += " is-deleted";
          } else if (file.diskState === "modifiedOnDisk" && file.dirtyVsDisk) {
            titleClassName += " is-modified";
          }

          return (
            <div
              key={file.fileId}
              data-file-id={file.fileId}
              className={`shell-editor-tab ${activeFileId === file.fileId ? "is-active" : ""} ${draggedFileId === file.fileId ? "is-dragging" : ""} ${dropIndicator?.fileId === file.fileId ? `is-drop-${dropIndicator.position}` : ""} ${tabHeaderStyle.className}`.trim()}
              style={tabHeaderStyle.style}
              draggable={Boolean(editorGroupId && onMoveFile)}
              onDragStart={(event) => handleDragStart(event, file.fileId)}
              onDragOver={(event) => handleDragOverTab(event, file.fileId)}
              onDrop={(event) => handleDropOnTab(event, file.fileId)}
              onDragEnd={() => {
                setDraggedFileId(null);
                setDropIndicator(null);
              }}
              onContextMenu={(e) => handleContextMenu(e, file)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredTab({ fileId: file.fileId, rect });
              }}
              onMouseLeave={() => setHoveredTab(null)}
            >
              {tabHeaderStyle.indicatorClassName && (
                <span className={`shell-editor-tab-indicator ${tabHeaderStyle.indicatorClassName}`.trim()} />
              )}
              <div
                role="button"
                className="shell-editor-tab-button"
                onClick={() => onSelectFile(file.fileId)}
              >
                {tabHeaderStyle.statusIcon && (() => {
                  const StatusIcon = tabHeaderStyle.statusIcon;
                  return (
                    <span className="shell-editor-tab-status-icon" aria-label={tabHeaderStyle.statusIconTitle}>
                      <StatusIcon className="shell-editor-tab-status-icon-svg" />
                    </span>
                  );
                })()}
                {(() => {
                  const icon = getMimeIcon ? getMimeIcon(file.mimeType) : undefined;
                  const IconComponent = icon ?? DocumentIcon;
                  return <IconComponent className="shell-editor-tab-icon" />;
                })()}
                <span className={titleClassName}>{title}</span>
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
      {canMaximizeGroup && onToggleMaximizeGroup && (
        <div className="shell-editor-tabs-actions">
          <button
            type="button"
            className={`shell-editor-group-maximize ${isGroupMaximized ? "is-restore" : ""}`.trim()}
            aria-label={isGroupMaximized ? "Restore editor groups" : "Maximize editor group"}
            aria-pressed={isGroupMaximized}
            title={isGroupMaximized ? "Restore editor groups" : "Maximize editor group"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleMaximizeGroup();
            }}
          >
            {isGroupMaximized
              ? <RestoreEditorGroupIcon className="shell-editor-group-maximize-icon" />
              : <MaximizeEditorGroupIcon className="shell-editor-group-maximize-icon" />}
          </button>
        </div>
      )}
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
      {contextMenu && (
        <div
          className="shell-context-menu shell-tab-context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {allActions
            .filter((action) => {
              if (!action.enabledWhen) return true;
              const contextEditor = contextMenu.file.editorId
                ? editorsById.get(contextMenu.file.editorId)
                : undefined;
              try {
                return getExpressionRuntime().evaluateBooleanSync(
                  action.enabledWhen,
                  buildTabContextMenuExpressionContext({
                    file: contextMenu.file,
                    editor: contextEditor,
                    editorGroupId,
                    editorGroupIndex,
                    editorGroupCount,
                    editorGroupFileCount: openFiles.length,
                    hasMimeCapability
                  }),
                  { mode: "when", source: `tabContextMenu:${action.id}`, timeoutMs: 50 }
                );
              } catch {
                return true;
              }
            })
            .map((action) => (
              <div
                key={action.id}
                className="shell-context-menu__item shell-tab-context-menu-item"
                onClick={() => handleActionClick(action)}
              >
                {action.icon && <span className={`shell-tab-context-menu-icon ${action.icon}`} />}
                <span className="shell-tab-context-menu-label">{action.label}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function readDraggedTab(dataTransfer: DataTransfer): DraggedTab | null {
  try {
    const value = JSON.parse(dataTransfer.getData(EDITOR_TAB_DRAG_TYPE)) as Partial<DraggedTab>;
    return typeof value.editorGroupId === "string" && typeof value.fileId === "string"
      ? { editorGroupId: value.editorGroupId, fileId: value.fileId }
      : null;
  } catch {
    return null;
  }
}

function scrollTabListAtEdge(tabList: HTMLElement | null, clientX: number): void {
  if (!tabList) {
    return;
  }
  const rect = tabList.getBoundingClientRect();
  const edgeSize = 28;
  if (clientX < rect.left + edgeSize) {
    tabList.scrollLeft -= edgeSize;
  } else if (clientX > rect.right - edgeSize) {
    tabList.scrollLeft += edgeSize;
  }
}

type ComposeTabTitleParams = {
  file: FileEntity;
  editor: LayoutEditorContribution | undefined;
  tabTitleContributions: TabTitleContribution[];
  hasMimeCapability?: (mimeType: string, capability: MimeCapability) => boolean;
  isActive: boolean;
};

export function composeTabTitle({
  file,
  editor,
  tabTitleContributions,
  hasMimeCapability,
  isActive
}: ComposeTabTitleParams): string {
  const baseTitle = resolveBaseTabTitle(file, editor);
  let main = baseTitle;
  let prefix = "";
  let suffix = "";
  const hasCapability = (capability: MimeCapability) => hasMimeCapability?.(file.mimeType, capability) ?? false;
  for (const contribution of tabTitleContributions) {
    const value = contribution.render({
      file,
      isActive,
      hasCapability,
      baseTitle
    });
    if (!value) {
      continue;
    }
    if (typeof value.mainOverride === "string") {
      main = value.mainOverride;
    }
    if (typeof value.prefix === "string") {
      prefix += value.prefix;
    }
    if (typeof value.suffix === "string") {
      suffix += value.suffix;
    }
  }
  return `${prefix}${main}${suffix}`;
}

type BuildTabContextMenuExpressionContextParams = {
  file: FileEntity;
  editor: LayoutEditorContribution | undefined;
  editorGroupId: string | undefined;
  editorGroupIndex: number;
  editorGroupCount: number;
  editorGroupFileCount: number;
  hasMimeCapability?: (mimeType: string, capability: MimeCapability) => boolean;
};

export function buildTabContextMenuExpressionContext({
  file,
  editor,
  editorGroupId,
  editorGroupIndex,
  editorGroupCount,
  editorGroupFileCount,
  hasMimeCapability
}: BuildTabContextMenuExpressionContextParams) {
  const hasLeftEditorGroup = editorGroupIndex > 0;
  const hasRightEditorGroup = editorGroupIndex < editorGroupCount - 1;
  return {
    uri: file.uri,
    mimeType: file.mimeType,
    fileId: file.fileId,
    dirtyVsDisk: file.dirtyVsDisk,
    dirtyVsBackend: file.dirtyVsBackend,
    editable: hasMimeCapability?.(file.mimeType, "editable") ?? false,
    canSplit: editor?.canSplit === true,
    editorGroupId,
    editorGroupIndex,
    editorGroupCount,
    editorGroupFileCount,
    hasLeftEditorGroup,
    hasRightEditorGroup,
    canMoveToLeftGroup: hasLeftEditorGroup,
    canMoveToRightGroup: hasRightEditorGroup || editorGroupFileCount > 1
  };
}

function resolveBaseTabTitle(file: FileEntity, editor: LayoutEditorContribution | undefined): string {
  if (file.uri.startsWith("file://")) {
    return file.uri.split("/").pop() ?? file.uri;
  }
  if (file.uri.startsWith("untitled:")) {
    return decodeURIComponent(file.uri.slice(8));
  }
  return editor?.title ?? file.uri;
}
