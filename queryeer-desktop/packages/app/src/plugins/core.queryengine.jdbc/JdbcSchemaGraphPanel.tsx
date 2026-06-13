import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { filesAreStructurallyIdentical } from "../../renderer/shell/file-entity-utils";
import { getGraphDocumentRepository } from "../core.graph/GraphDocumentRepository";
import { getVisibleVertexIds, setAllVerticesVisible, subscribeToVisibleVertices, toggleVisibleVertex } from "../core.graph/graph-visible-vertices-store";
import "./JdbcSchemaGraphPanel.css";

export function JdbcSchemaGraphPanel({ context }: { context: PluginContext }): ReactNode {
  const [activeFileId, setActiveFileId] = useState<string | null>(() => context.fileMediator.getActiveFileId());
  const [files, setFiles] = useState(() => context.files.listFiles());
  const [query, setQuery] = useState("");
  const [graph, setGraph] = useState(() => {
    const initialFileId = context.fileMediator.getActiveFileId();
    const initialFile = initialFileId ? context.files.getFile(initialFileId) : undefined;
    return initialFile ? getGraphDocumentRepository().getGraphForFile(initialFile) : null;
  });

  useEffect(() => {
    return context.fileMediator.onActiveFileChanged((id) => setActiveFileId(id));
  }, [context.fileMediator]);

  useEffect(() => {
    return context.files.subscribe((next) => {
      setFiles((previous) => filesAreStructurallyIdentical(previous, next) ? previous : next);
    });
  }, [context.files]);

  const activeFile = useMemo(() => {
    if (!activeFileId) return null;
    return files.find((f) => f.fileId === activeFileId) ?? null;
  }, [activeFileId, files]);

  useEffect(() => {
    if (!activeFile) {
      setGraph(null);
      return;
    }
    const repository = getGraphDocumentRepository();
    let disposed = false;
    const unsubscribe = repository.subscribe((fileId) => {
      if (fileId === activeFile.fileId) {
        setGraph(repository.getGraphForFile(activeFile));
      }
    });
    const existing = repository.getGraphForFile(activeFile);
    setGraph(existing);
    if (!existing) {
      void repository.openFile(activeFile).then((loaded) => {
        if (!disposed) {
          setGraph(loaded);
        }
      });
    }
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [activeFile]);

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
