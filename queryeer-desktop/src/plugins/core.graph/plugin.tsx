import type { Plugin } from "../../contracts/plugin/Plugin";
import type { OutputContext } from "../../contracts/extensions/OutputExtension";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { GraphActionInvocation, GraphDocument } from "../../contracts/graph";
import { getOutputRegistry } from "../core.queryengine/output/OutputRegistry";
import { GraphViewer } from "./GraphViewer";
import { GRAPH_DOCUMENT_EDITOR_ID, GRAPH_DOCUMENT_EXTENSION, GRAPH_DOCUMENT_MIME_TYPE } from "./constants";
import { GraphIcon } from "./GraphIcon";
import { createSampleGraphDocument } from "./sample-graph";
import "./graph.css";

function QueryPlanGraphOutput({ context }: { context: OutputContext }): JSX.Element {
  const artifact = context.artifacts.find((candidate) => candidate.kind === "graph" && candidate.capability === "plan");

  if (!artifact) {
    return <div className="graph-output-empty">Query plan feature was reported, but no graph artifact was provided.</div>;
  }

  return <GraphViewer graph={artifact.graph} />;
}

function GraphDocumentEditor({ activeFile }: { activeFile?: FileEntity }): JSX.Element {
  const graph = resolveGraphDocument(activeFile);

  if (!activeFile) {
    return <div className="graph-output-empty">No graph document is active.</div>;
  }

  if (!graph) {
    return (
      <div className="graph-output-empty">
        This graph file does not contain an embedded graph document yet.
      </div>
    );
  }

  return <GraphViewer graph={graph} onEntityAction={handleGraphDocumentAction} />;
}

export async function handleGraphDocumentAction(invocation: GraphActionInvocation): Promise<void> {
  if (invocation.actionId !== "copy-id") {
    return;
  }
  await navigator.clipboard?.writeText(invocation.entityId);
}

function resolveGraphDocument(file: FileEntity | undefined): GraphDocument | null {
  const candidate = file?.metadata?.graphDocument;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const graph = candidate as Partial<GraphDocument>;
  if (typeof graph.id !== "string" || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges)) {
    return null;
  }
  return graph as GraphDocument;
}

export const coreGraphPlugin: Plugin = {
  manifest: {
    id: "core.graph",
    name: "Core Graph",
    version: "0.1.0",
    kind: "core",
    description: "Graph visualization framework and query plan output contributor",
    dependencies: ["core.queryengine", "core.files"],
    providesCapabilities: ["graph.view"]
  },
  activate: (context) => {
    context.files.capabilities.registerCapabilities(GRAPH_DOCUMENT_MIME_TYPE, ["viewable"]);
    context.files.capabilities.registerContentCategory(GRAPH_DOCUMENT_MIME_TYPE, "text");
    context.files.capabilities.registerLabel?.(GRAPH_DOCUMENT_MIME_TYPE, "Graph");
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
      render: ({ activeFile } = {}) => <GraphDocumentEditor activeFile={activeFile} />
    });

    context.commands.registerCommand({
      id: "core.graph.openSample",
      title: "Open Sample Graph",
      category: "Graph",
      handler: async () => {
        const file = await context.fileMediator.createUntitledFile({
          mimeType: GRAPH_DOCUMENT_MIME_TYPE,
          extension: GRAPH_DOCUMENT_EXTENSION,
          title: "SampleGraph"
        });
        context.files.updateFile(file.fileId, {
          metadata: {
            ...(file.metadata ?? {}),
            workspaceTransient: true,
            graphDocument: createSampleGraphDocument()
          }
        });
      }
    });

    context.menu.registerMenuItem({
      id: "core.graph.dev.openSample",
      parentId: "core.menu.tools.dev",
      label: "Open Sample Graph",
      order: 60,
      commandId: "core.graph.openSample"
    });

    getOutputRegistry().register({
      id: "core.graph.queryPlanOutput",
      capability: "plan",
      mode: "adhoc",
      title: "Plan",
      priority: 50,
      render: (context) => <QueryPlanGraphOutput context={context} />
    });
  }
};
