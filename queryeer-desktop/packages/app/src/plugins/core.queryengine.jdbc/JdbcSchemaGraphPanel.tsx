import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import type { GraphDocument } from "@queryeer/api/graph";
import { getVisibleVertexIds, setAllVerticesVisible, subscribeToVisibleVertices, toggleVisibleVertex } from "../core.graph/graph-visible-vertices-store";
import "./JdbcSchemaGraphPanel.css";

function resolveGraphDocument(file: { metadata?: Record<string, unknown> } | null | undefined): GraphDocument | null {
  const candidate = file?.metadata?.graphDocument;
  if (!candidate || typeof candidate !== "object") return null;
  const graph = candidate as Partial<GraphDocument>;
  if (typeof graph.id !== "string" || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges)) return null;
  return graph as GraphDocument;
}

export function JdbcSchemaGraphPanel({ context }: { context: PluginContext }): ReactNode {
  const [activeFileId, setActiveFileId] = useState<string | null>(() => context.fileMediator.getActiveFileId());
  const [files, setFiles] = useState(() => context.files.listFiles());
  const [query, setQuery] = useState("");

  useEffect(() => {
    return context.fileMediator.onActiveFileChanged((id) => setActiveFileId(id));
  }, [context.fileMediator]);

  useEffect(() => {
    return context.files.subscribe((next) => setFiles(next));
  }, [context.files]);

  const graph = useMemo(() => {
    if (!activeFileId) return null;
    const file = files.find((f) => f.fileId === activeFileId);
    return resolveGraphDocument(file);
  }, [activeFileId, files]);

  const graphId = graph?.id ?? "";
  const [, forceRender] = useState(0);
  useEffect(() => subscribeToVisibleVertices(() => forceRender((n) => n + 1)), []);
  const visibleVertexIds = getVisibleVertexIds(graphId);

  const toggle = useCallback((id: string, visible: boolean) => {
    if (graphId) toggleVisibleVertex(graphId, id, visible);
  }, [graphId]);

  const vertices = graph?.vertices ?? [];

  const filtered = useMemo(() => {
    if (!query) return vertices;
    const q = query.toLowerCase();
    return vertices.filter((v) => v.label.toLowerCase().includes(q));
  }, [vertices, query]);

  const allVisible = graphId ? visibleVertexIds.size > 0 && visibleVertexIds.size === vertices.length : false;

  const handleToggleAll = useCallback(() => {
    if (!graphId) return;
    if (allVisible) {
      for (const v of vertices) toggleVisibleVertex(graphId, v.id, false);
    } else {
      setAllVerticesVisible(graphId, vertices.map((v) => v.id));
    }
  }, [graphId, allVisible, vertices]);

  if (!graph || vertices.length === 0) {
    return (
      <div className="jdbc-schema-graph-panel">
        <div className="jdbc-schema-graph-empty">No schema graph is active.</div>
      </div>
    );
  }

  return (
    <div className="jdbc-schema-graph-panel">
      <div className="jdbc-schema-graph-search">
        <input
          type="text"
          placeholder="Filter tables..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="jdbc-schema-graph-count">
        <button type="button" className="jdbc-schema-graph-toggle-all" onClick={handleToggleAll}>
          {allVisible ? "Deselect all" : "Select all"}
        </button>
        <span>{visibleVertexIds.size}/{vertices.length}</span>
      </div>
      <div className="jdbc-schema-graph-list">
        {filtered.map((v) => (
          <label key={v.id} className="jdbc-schema-graph-item">
            <input
              type="checkbox"
              checked={visibleVertexIds.has(v.id)}
              onChange={(e) => toggle(v.id, e.target.checked)}
            />
            <span className="jdbc-schema-graph-item-label">{v.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
