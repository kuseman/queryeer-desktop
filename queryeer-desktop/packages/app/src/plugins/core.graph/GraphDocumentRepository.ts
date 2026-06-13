import type { EditorContentRepository } from "@queryeer/api/editor/EditorCapability";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { GraphDocument } from "@queryeer/api/graph";
import {
  parseGraphDocument,
  parseGraphDocumentJson,
  serializeGraphDocument
} from "./graph-document-codec";

type GraphDocumentModel = {
  fileId?: string;
  uri: string;
  graph: GraphDocument;
  getContent(): string;
};

type SeedOptions = {
  notifyDirty?: boolean;
};

class GraphDocumentRepository implements EditorContentRepository {
  private readonly modelsByFileId = new Map<string, GraphDocumentModel>();
  private readonly modelsByUri = new Map<string, GraphDocumentModel>();
  private readonly listeners: Array<(fileId: string) => void> = [];
  private readonly dirtyListeners: Array<(fileId: string, text: string) => void> = [];

  public seedFile(file: FileEntity, graph: GraphDocument, options: SeedOptions = {}): void {
    const model = this.upsertModel(file.fileId, file.uri, graph);
    this.notify(file.fileId);
    if (options.notifyDirty === true) {
      this.notifyDirty(file.fileId, model.getContent());
    }
  }

  public async openFile(file: FileEntity): Promise<GraphDocument | null> {
    const existing = this.modelsByFileId.get(file.fileId);
    if (existing) {
      this.reindexUri(existing, file.uri);
      return existing.graph;
    }

    const metadataGraph = parseGraphDocument(file.metadata?.graphDocument);
    if (metadataGraph) {
      this.seedFile(file, metadataGraph);
      return metadataGraph;
    }

    if (!file.uri.startsWith("file:")) {
      return null;
    }

    try {
      const result = await window.appShell.readFile(file.uri);
      if (!result.success) {
        return null;
      }
      const graph = parseGraphDocumentJson(result.content);
      if (!graph) {
        return null;
      }
      this.seedFile(file, graph);
      return graph;
    } catch {
      return null;
    }
  }

  public getGraphForFile(file: FileEntity): GraphDocument | null {
    const existing = this.modelsByFileId.get(file.fileId);
    if (existing) {
      this.reindexUri(existing, file.uri);
      return existing.graph;
    }
    const metadataGraph = parseGraphDocument(file.metadata?.graphDocument);
    if (metadataGraph) {
      this.seedFile(file, metadataGraph);
      return metadataGraph;
    }
    return null;
  }

  public subscribe(listener: (fileId: string) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  public getModelForFile(fileId: string): { getContent(): string } | undefined {
    return this.modelsByFileId.get(fileId);
  }

  public getModelForUri(uri: string): { getContent(): string } | undefined {
    return this.modelsByUri.get(uri);
  }

  public updateModelContent(uri: string, content: string): void {
    const graph = parseGraphDocumentJson(content);
    if (!graph) {
      return;
    }
    const existing = this.modelsByUri.get(uri);
    if (existing) {
      existing.graph = graph;
      if (existing.fileId) {
        this.notify(existing.fileId);
      }
      return;
    }
    this.modelsByUri.set(uri, createModel(undefined, uri, graph));
  }

  public applyRecoveredContent(fileId: string, content: string): void {
    const graph = parseGraphDocumentJson(content);
    if (!graph) {
      return;
    }
    const existing = this.modelsByFileId.get(fileId);
    if (existing) {
      existing.graph = graph;
      this.notify(fileId);
      return;
    }
    this.modelsByFileId.set(fileId, createModel(fileId, "", graph));
    this.notify(fileId);
  }

  public onContentDirty(listener: (fileId: string, text: string) => void): () => void {
    this.dirtyListeners.push(listener);
    return () => {
      const index = this.dirtyListeners.indexOf(listener);
      if (index !== -1) {
        this.dirtyListeners.splice(index, 1);
      }
    };
  }

  public clearForTests(): void {
    this.modelsByFileId.clear();
    this.modelsByUri.clear();
    this.listeners.splice(0);
    this.dirtyListeners.splice(0);
  }

  private upsertModel(fileId: string, uri: string, graph: GraphDocument): GraphDocumentModel {
    const existing = this.modelsByFileId.get(fileId) ?? this.modelsByUri.get(uri);
    if (existing) {
      existing.fileId = fileId;
      existing.graph = graph;
      this.reindexUri(existing, uri);
      this.modelsByFileId.set(fileId, existing);
      return existing;
    }
    const model = createModel(fileId, uri, graph);
    this.modelsByFileId.set(fileId, model);
    this.modelsByUri.set(uri, model);
    return model;
  }

  private reindexUri(model: GraphDocumentModel, uri: string): void {
    if (model.uri === uri) {
      return;
    }
    if (model.uri) {
      this.modelsByUri.delete(model.uri);
    }
    model.uri = uri;
    this.modelsByUri.set(uri, model);
  }

  private notify(fileId: string): void {
    for (const listener of this.listeners) {
      listener(fileId);
    }
  }

  private notifyDirty(fileId: string, text: string): void {
    for (const listener of this.dirtyListeners) {
      listener(fileId, text);
    }
  }
}

function createModel(
  fileId: string | undefined,
  uri: string,
  graph: GraphDocument
): GraphDocumentModel {
  const model: GraphDocumentModel = {
    fileId,
    uri,
    graph,
    getContent: () => serializeGraphDocument(model.graph)
  };
  return model;
}

const repository = new GraphDocumentRepository();

export function getGraphDocumentRepository(): GraphDocumentRepository {
  return repository;
}
