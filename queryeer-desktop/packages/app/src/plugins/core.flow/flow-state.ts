import { useSyncExternalStore } from "react";
import type {
  FlowDocument,
  FlowExecutionResult,
  FlowRunMode
} from "./types";

type FlowDocumentByFileId = Map<string, FlowDocument>;
type FlowExecutionByFileId = Map<string, FlowExecutionResult>;
type ActiveNodeByFileId = Map<string, string | undefined>;

export type FlowStateSnapshot = {
  document: FlowDocument | undefined;
  execution: FlowExecutionResult | undefined;
  activeNodeId: string | undefined;
};

const EMPTY_FLOW_STATE_SNAPSHOT: FlowStateSnapshot = Object.freeze({
  document: undefined,
  execution: undefined,
  activeNodeId: undefined
});

class FlowStateStore {
  private readonly documentsByFileId: FlowDocumentByFileId = new Map();
  private readonly executionsByFileId: FlowExecutionByFileId = new Map();
  private readonly activeNodeByFileId: ActiveNodeByFileId = new Map();
  private readonly snapshotsByFileId = new Map<string, FlowStateSnapshot>();
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getDocument(fileId: string): FlowDocument | undefined {
    return this.documentsByFileId.get(fileId);
  }

  getExecution(fileId: string): FlowExecutionResult | undefined {
    return this.executionsByFileId.get(fileId);
  }

  getSnapshot(fileId: string | null): FlowStateSnapshot {
    if (!fileId) {
      return EMPTY_FLOW_STATE_SNAPSHOT;
    }

    const existingSnapshot = this.snapshotsByFileId.get(fileId);
    if (existingSnapshot) {
      return existingSnapshot;
    }

    const createdSnapshot = this.createSnapshot(fileId);
    this.snapshotsByFileId.set(fileId, createdSnapshot);
    return createdSnapshot;
  }

  setDocument(fileId: string, document: FlowDocument): void {
    const previousDocument = this.documentsByFileId.get(fileId);
    if (previousDocument === document) {
      return;
    }
    this.documentsByFileId.set(fileId, document);
    if (this.refreshSnapshot(fileId)) {
      this.emit();
    }
  }

  clearDocument(fileId: string): void {
    const changed = this.documentsByFileId.delete(fileId);
    if (changed && this.refreshSnapshot(fileId)) {
      this.emit();
    }
  }

  setExecution(fileId: string, execution: FlowExecutionResult): void {
    const previousExecution = this.executionsByFileId.get(fileId);
    if (previousExecution === execution) {
      return;
    }
    this.executionsByFileId.set(fileId, execution);
    if (this.refreshSnapshot(fileId)) {
      this.emit();
    }
  }

  clearExecution(fileId: string): void {
    const changed = this.executionsByFileId.delete(fileId);
    if (changed && this.refreshSnapshot(fileId)) {
      this.emit();
    }
  }

  setActiveNode(fileId: string, nodeId: string | undefined): void {
    const previous = this.activeNodeByFileId.get(fileId);
    if (previous === nodeId) {
      return;
    }
    if (nodeId) {
      this.activeNodeByFileId.set(fileId, nodeId);
    } else {
      this.activeNodeByFileId.delete(fileId);
    }
    if (this.refreshSnapshot(fileId)) {
      this.emit();
    }
  }

  clearAllExecutions(): void {
    if (this.executionsByFileId.size === 0) {
      return;
    }

    this.executionsByFileId.clear();
    for (const fileId of this.snapshotsByFileId.keys()) {
      this.refreshSnapshot(fileId);
    }
    this.emit();
  }

  clearAll(): void {
    if (this.documentsByFileId.size === 0 && this.executionsByFileId.size === 0) {
      return;
    }
    this.documentsByFileId.clear();
    this.executionsByFileId.clear();
    this.activeNodeByFileId.clear();
    this.snapshotsByFileId.clear();
    this.emit();
  }

  runModeForCursor(fileId: string, lineNumber: number): FlowRunMode | undefined {
    const document = this.getDocument(fileId);
    if (!document) {
      return undefined;
    }
    for (const node of document.nodes) {
      if (lineNumber >= node.range.metadataStartLine && lineNumber <= node.range.actionEndLine) {
        return { kind: "to-node", nodeId: node.metadata.id };
      }
    }
    return undefined;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private createSnapshot(fileId: string): FlowStateSnapshot {
    return {
      document: this.documentsByFileId.get(fileId),
      execution: this.executionsByFileId.get(fileId),
      activeNodeId: this.activeNodeByFileId.get(fileId)
    };
  }

  private refreshSnapshot(fileId: string): boolean {
    const previousSnapshot = this.snapshotsByFileId.get(fileId);
    const nextDocument = this.documentsByFileId.get(fileId);
    const nextExecution = this.executionsByFileId.get(fileId);
    const nextActiveNodeId = this.activeNodeByFileId.get(fileId);

    if (previousSnapshot
      && previousSnapshot.document === nextDocument
      && previousSnapshot.execution === nextExecution
      && previousSnapshot.activeNodeId === nextActiveNodeId) {
      return false;
    }

    if (nextDocument === undefined && nextExecution === undefined && nextActiveNodeId === undefined) {
      this.snapshotsByFileId.delete(fileId);
      return true;
    }

    this.snapshotsByFileId.set(fileId, {
      document: nextDocument,
      execution: nextExecution,
      activeNodeId: nextActiveNodeId
    });
    return true;
  }
}

let flowStateStoreInstance: FlowStateStore | null = null;

export function getFlowStateStore(): FlowStateStore {
  if (!flowStateStoreInstance) {
    flowStateStoreInstance = new FlowStateStore();
  }
  return flowStateStoreInstance;
}

export function useFlowStateSnapshot(fileId: string | null): {
  document: FlowDocument | undefined;
  execution: FlowExecutionResult | undefined;
} {
  const store = getFlowStateStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(fileId),
    () => store.getSnapshot(fileId)
  );
}
