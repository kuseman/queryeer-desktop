import { useState, useCallback, useEffect } from "react";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type {
  LayoutEditorContribution,
  TabContextMenuContribution,
  TabContextMenuAction,
  TabHeaderStyleContribution,
  TabTitleContribution
} from "../../contracts/extensions/LayoutExtension";
import type { TooltipSectionContribution } from "../../contracts/extensions/TooltipExtension";
import type { MimeCapability, MimeIconProps } from "../../contracts/files/FilesRegistry";
import { TabTooltip, buildTabTooltip } from "./TabTooltip";
import { DocumentIcon } from "../../renderer/icons/DocumentIcon";

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
  tabContextMenus?: TabContextMenuContribution[];
  tabHeaderStyleContributions?: TabHeaderStyleContribution[];
  tabTitleContributions?: TabTitleContribution[];
  hasMimeCapability?: (mimeType: string, capability: MimeCapability) => boolean;
  getMimeIcon?: (mimeType: string) => ((props: MimeIconProps) => JSX.Element) | undefined;
  onTabContextMenuAction?: (actionId: string, file: FileEntity) => void;
  onTabContextMenuOpen?: (file: FileEntity | null) => void;
  tabBackgroundOpacity?: number;
};

function applyOpacityToHex(hex: string, alpha: number): string {
  const sanitized = hex.replace("#", "");
  const bigint = parseInt(sanitized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function EditorTabs({
  openFiles,
  activeFileId,
  editorsById,
  tabsRef,
  onSelectFile,
  onCloseFile,
  tooltipContributions = [],
  tabContextMenus = [],
  tabHeaderStyleContributions = [],
  tabTitleContributions = [],
  hasMimeCapability,
  getMimeIcon,
  onTabContextMenuAction,
  onTabContextMenuOpen,
  tabBackgroundOpacity = 0.08
}: EditorTabsProps) {
  const [hoveredTab, setHoveredTab] = useState<HoveredTab | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileEntity } | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    if (onTabContextMenuOpen) {
      onTabContextMenuOpen(null as unknown as FileEntity);
    }
  }, [onTabContextMenuOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = () => closeContextMenu();
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [contextMenu, closeContextMenu]);

  if (openFiles.length === 0) {
    return null;
  }

  const tooltipProps = hoveredTab
    ? buildTabTooltip(
        openFiles.find((f) => f.fileId === hoveredTab.fileId),
        tooltipContributions
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

  return (
    <div ref={tabsRef} className="shell-editor-tabs">
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
              style: { ...acc.style, ...style.style }
            }),
            { className: "", indicatorClassName: "", style: undefined as React.CSSProperties | undefined }
          );

        let finalStyle = tabHeaderStyle.style;
        const bg = finalStyle?.backgroundColor;
        if (typeof bg === "string" && bg.startsWith("#")) {
          finalStyle = { ...finalStyle, backgroundColor: applyOpacityToHex(bg, tabBackgroundOpacity) };
        }

        if (file.diskState === "deletedOnDisk") {
          titleClassName += " is-deleted";
        } else if (file.diskState === "modifiedOnDisk" && file.dirtyVsDisk) {
          titleClassName += " is-modified";
        }

        return (
          <div
            key={file.fileId}
            data-file-id={file.fileId}
            className={`shell-editor-tab ${activeFileId === file.fileId ? "is-active" : ""} ${tabHeaderStyle.className}`.trim()}
            style={finalStyle}
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
          className="shell-tab-context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {allActions.map((action) => (
            <div
              key={action.id}
              className="shell-tab-context-menu-item"
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

function resolveBaseTabTitle(file: FileEntity, editor: LayoutEditorContribution | undefined): string {
  if (file.uri.startsWith("file://")) {
    return file.uri.split("/").pop() ?? file.uri;
  }
  if (file.uri.startsWith("untitled:")) {
    return file.uri.slice(8);
  }
  return editor?.title ?? file.uri;
}
