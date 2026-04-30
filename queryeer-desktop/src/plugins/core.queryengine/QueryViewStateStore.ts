import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { FileEntity } from "../../contracts/files/FileEntity";

export const QUERY_VIEW_STATE_KEY = "core.queryengine.viewState";
export const TEXT_OUTPUT_PRIMARY_ID = "core.queryengine.output.text";

export type QueryViewState = {
  executionTargetOutputId?: string;
  panelActiveOutputId?: string;
  selectedOutputId?: string;
  panelSelectedOutputId?: string;
  textOutputFormat?: string;
};

type Listener = (state: QueryViewState) => void;

class QueryViewStateStore {
  private filesRegistry: FilesRegistry | null = null;
  private readonly listenersByFileId = new Map<string, Set<Listener>>();
  private readonly stateByFileId = new Map<string, QueryViewState>();

  initialize(filesRegistry: FilesRegistry): void {
    this.filesRegistry = filesRegistry;
  }

  read(fileId: string): QueryViewState {
    const cached = this.stateByFileId.get(fileId);
    if (cached) {
      return cached;
    }
    const file = this.filesRegistry?.getFile(fileId);
    const state = readStateFromFile(file);
    this.stateByFileId.set(fileId, state);
    return state;
  }

  setSelectedOutput(fileId: string, selectedOutputId: string): void {
    this.patch(fileId, {
      executionTargetOutputId: selectedOutputId,
      selectedOutputId
    });
  }

  setPanelSelectedOutput(fileId: string, panelSelectedOutputId: string): void {
    this.patch(fileId, {
      panelActiveOutputId: panelSelectedOutputId,
      panelSelectedOutputId
    });
  }

  setTextOutputFormat(fileId: string, textOutputFormat: string): void {
    this.patch(fileId, { textOutputFormat });
  }

  subscribe(fileId: string, listener: Listener): () => void {
    let set = this.listenersByFileId.get(fileId);
    if (!set) {
      set = new Set<Listener>();
      this.listenersByFileId.set(fileId, set);
    }
    set.add(listener);
    return () => {
      const listeners = this.listenersByFileId.get(fileId);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listenersByFileId.delete(fileId);
      }
    };
  }

  private patch(fileId: string, patch: QueryViewState): void {
    const files = this.filesRegistry;
    if (!files) {
      return;
    }
    const file = files.getFile(fileId);
    if (!file) {
      return;
    }
    const previous = this.stateByFileId.get(fileId) ?? readStateFromFile(file);
    const next: QueryViewState = {
      ...previous,
      ...patch
    };
    this.stateByFileId.set(fileId, next);
    files.updateFile(fileId, {
      persistentViewState: {
        ...(file.persistentViewState ?? {}),
        [QUERY_VIEW_STATE_KEY]: next
      }
    });
    this.emit(fileId, next);
  }

  private emit(fileId: string, state: QueryViewState): void {
    const listeners = this.listenersByFileId.get(fileId);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(state);
    }
  }
}

function readStateFromFile(file: FileEntity | undefined): QueryViewState {
  const raw = file?.persistentViewState?.[QUERY_VIEW_STATE_KEY];
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const value = raw as Record<string, unknown>;
  const executionTargetOutputId =
    typeof value.executionTargetOutputId === "string"
      ? value.executionTargetOutputId
      : (typeof value.selectedOutputId === "string" ? value.selectedOutputId : undefined);
  const panelActiveOutputId =
    typeof value.panelActiveOutputId === "string"
      ? value.panelActiveOutputId
      : (typeof value.panelSelectedOutputId === "string" ? value.panelSelectedOutputId : undefined);
  return {
    executionTargetOutputId,
    panelActiveOutputId,
    selectedOutputId: executionTargetOutputId,
    panelSelectedOutputId: panelActiveOutputId,
    textOutputFormat: typeof value.textOutputFormat === "string" ? value.textOutputFormat : undefined
  };
}

const instance = new QueryViewStateStore();

export function getQueryViewStateStore(): QueryViewStateStore {
  return instance;
}
