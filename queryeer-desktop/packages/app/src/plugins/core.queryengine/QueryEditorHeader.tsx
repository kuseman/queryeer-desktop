import { useSyncExternalStore, type ReactNode } from "react";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { OutputContext } from "@queryeer/api/queryengine/OutputExtension";
import {
  getQueryEditorHeaderItems,
  subscribeQueryEditorHeaderItems
} from "./query-editor-header-registry";
import {
  getRegisteredQueryExecutableEngines,
  subscribeRegisteredQueryExecutableEngines
} from "./engine-registration";
import PluginErrorBoundary from "../core.layout/PluginErrorBoundary";

type Props = {
  outputContext: OutputContext;
  file: FileEntity | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

function hasContent(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean" || node === "") {
    return false;
  }
  return !Array.isArray(node) || node.some(hasContent);
}

export function QueryEditorHeader({ outputContext, file, collapsed, onToggleCollapsed }: Props): JSX.Element | null {
  const headerItems = useSyncExternalStore(
    subscribeQueryEditorHeaderItems,
    getQueryEditorHeaderItems,
    getQueryEditorHeaderItems
  );
  const engineRegistrations = useSyncExternalStore(
    subscribeRegisteredQueryExecutableEngines,
    getRegisteredQueryExecutableEngines,
    getRegisteredQueryExecutableEngines
  );
  const engineId = file?.engineBinding?.engineId
    ?? engineRegistrations.find((entry) => entry.mimeTypes.includes(file?.mimeType ?? ""))?.engineId;
  const context = { fileId: file?.fileId ?? "", file, outputContext };
  const renderedItems = headerItems
    .filter((item) => !item.engineId || item.engineId === engineId)
    .map((item) => {
      try {
        return { item, content: item.render(context) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[QueryEditorHeader] Error in contribution '${item.id}':`, error);
        return {
          item,
          content: (
            <div className="plugin-error-boundary">
              <p className="plugin-error-boundary-title">Plugin error: {item.id}</p>
              <p className="plugin-error-boundary-message">{message}</p>
            </div>
          )
        };
      }
    })
    .filter(({ content }) => hasContent(content));

  if (renderedItems.length === 0) {
    return null;
  }
  const collapsedTitle = renderedItems
    .map(({ item }) => item.title)
    .filter((title): title is string => Boolean(title?.trim()))
    .join(" \u00b7 ");

  return (
    <div className={`query-editor-header${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="query-editor-header-toggle"
        aria-label={collapsed ? "Expand editor header" : "Collapse editor header"}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        {collapsed ? "\u25b8" : "\u25be"}
      </button>
      {collapsed && collapsedTitle ? <span className="query-editor-header-title">{collapsedTitle}</span> : null}
      {!collapsed ? (
        <div className="query-editor-header-items">
          {renderedItems.map(({ item, content }) => (
            <div key={item.id} className="query-editor-header-item">
              <PluginErrorBoundary sourceName={item.id}>{content}</PluginErrorBoundary>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
