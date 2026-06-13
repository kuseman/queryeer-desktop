import { useEffect, useState } from "react";
import type { Plugin } from "@queryeer/api/plugin/Plugin";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { GraphActionInvocation, GraphDocument } from "@queryeer/api/graph";
import { GraphViewer } from "./GraphViewer";
import { GRAPH_DOCUMENT_EDITOR_ID, GRAPH_DOCUMENT_EXTENSION, GRAPH_DOCUMENT_MIME_TYPE } from "./constants";
import { GraphIcon } from "./GraphIcon";
import { getEditorRegistryHost } from "../../core/plugin-runtime/ExtensionRegistry";
import { getGraphDocumentRepository } from "./GraphDocumentRepository";
import "./graph.css";

function GraphDocumentEditor({ activeFile }: { activeFile?: FileEntity }): JSX.Element {
  const [graph, setGraph] = useState<GraphDocument | null>(() => activeFile ? getGraphDocumentRepository().getGraphForFile(activeFile) : null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeFile) {
      setGraph(null);
      setLoading(false);
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
    if (existing) {
      setLoading(false);
      return () => {
        disposed = true;
        unsubscribe();
      };
    }
    setLoading(activeFile.uri.startsWith("file:"));
    void repository.openFile(activeFile).then((loaded) => {
      if (!disposed) {
        setGraph(loaded);
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [activeFile]);

  if (!activeFile) {
    return <div className="graph-output-empty">No graph document is active.</div>;
  }

  if (loading) {
    return <div className="graph-output-empty">Loading graph document...</div>;
  }

  if (!graph) {
    return (
      <div className="graph-output-empty">
        This graph file does not contain an embedded graph document yet.
      </div>
    );
  }

  return (
    <GraphViewer
      graph={graph}
      initialPropertiesPanelCollapsed={activeFile.mimeType !== GRAPH_DOCUMENT_MIME_TYPE}
      onEntityAction={handleGraphDocumentAction}
    />
  );
}

export async function handleGraphDocumentAction(invocation: GraphActionInvocation): Promise<void> {
  if (invocation.actionId !== "copy-id") {
    return;
  }
  await navigator.clipboard?.writeText(invocation.entityId);
}

export const coreGraphPlugin: Plugin = {
  manifest: {
    id: "core.graph",
    name: "Core Graph",
    version: "0.1.0",
    kind: "core",
    description: "Graph visualization framework and graph document viewer",
    dependencies: ["core.files"],
    providesCapabilities: ["graph.view"]
  },
  activate: (context) => {
    getEditorRegistryHost().registerContentRepository(getGraphDocumentRepository());
    context.files.capabilities.registerCapabilities(GRAPH_DOCUMENT_MIME_TYPE, ["viewable", "backupable"]);
    context.files.capabilities.registerContentCategory(GRAPH_DOCUMENT_MIME_TYPE, "text");
    context.files.capabilities.registerLabel?.(GRAPH_DOCUMENT_MIME_TYPE, "Graph");
    context.files.capabilities.registerPreferredExtension?.(GRAPH_DOCUMENT_MIME_TYPE, GRAPH_DOCUMENT_EXTENSION);
    context.files.registerMimeResolver((_uri, hint) => {
      return hint?.extension?.toLowerCase() === GRAPH_DOCUMENT_EXTENSION ? GRAPH_DOCUMENT_MIME_TYPE : undefined;
    });
    context.files.mimeIcons.registerMimeIcon({
      moduleId: "core.graph",
      mimeType: GRAPH_DOCUMENT_MIME_TYPE,
      icon: GraphIcon
    });

    context.layout.registerEditor({
      id: GRAPH_DOCUMENT_EDITOR_ID,
      title: "Graph Viewer",
      order: 30,
      supportedMimeTypes: [GRAPH_DOCUMENT_MIME_TYPE],
      openIntents: ["view", "edit"],
      priority: 500,
      canSplit: true,
      render: ({ activeFile } = {}) => <GraphDocumentEditor activeFile={activeFile} />
    });
  }
};
