import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import type { FileEntity } from "@queryeer/api/files/FileEntity";

export const QUERY_VIEW_STATE_KEY = "core.queryengine.viewState";
export const TEXT_OUTPUT_PRIMARY_ID = "core.queryengine.output.text";

export type QueryViewState = {
  executionTargetOutputId?: string;
  panelActiveOutputId?: string;
  selectedOutputId?: string;
  panelSelectedOutputId?: string;
  textOutputFormat?: string;
  includeActualPlan?: boolean;
  outputPanelCollapsed?: boolean;
};

type Listener = (state: QueryViewState) => void;
type PersistedQueryViewStates = {
  version: 2;
  sessions: Record<string, QueryViewState>;
};
type RawPersistedQueryViewStates = {
  version: 2;
  sessions: Record<string, unknown>;
};

function stateKey(fileId: string, outputSessionId: string): string {
  return `${fileId}|${outputSessionId}`;
}

class QueryViewStateStore {
  private filesRegistry: FilesRegistry | null = null;
  private readonly listenersByKey = new Map<string, Set<Listener>>();
  private readonly stateByKey = new Map<string, QueryViewState>();

  initialize(filesRegistry: FilesRegistry): void {
    this.filesRegistry = filesRegistry;
  }

  read(fileId: string, outputSessionId: string): QueryViewState {
    const key = stateKey(fileId, outputSessionId);
    const cached = this.stateByKey.get(key);
    if (cached) {
      return cached;
    }
    const file = this.filesRegistry?.getFile(fileId);
    const state = readStateFromFile(file, outputSessionId);
    this.stateByKey.set(key, state);
    return state;
  }

  setSelectedOutput(fileId: string, outputSessionId: string, selectedOutputId: string): void {
    this.patch(fileId, outputSessionId, {
      executionTargetOutputId: selectedOutputId,
      selectedOutputId
    });
  }

  setPanelSelectedOutput(fileId: string, outputSessionId: string, panelSelectedOutputId: string): void {
    this.patch(fileId, outputSessionId, {
      panelActiveOutputId: panelSelectedOutputId,
      panelSelectedOutputId
    });
  }

  setTextOutputFormat(fileId: string, outputSessionId: string, textOutputFormat: string): void {
    this.patch(fileId, outputSessionId, { textOutputFormat });
  }

  setIncludeActualPlan(fileId: string, outputSessionId: string, includeActualPlan: boolean): void {
    this.patch(fileId, outputSessionId, { includeActualPlan });
  }

  setOutputPanelCollapsed(fileId: string, outputSessionId: string, outputPanelCollapsed: boolean): void {
    this.patch(fileId, outputSessionId, { outputPanelCollapsed });
  }

  subscribe(fileId: string, outputSessionId: string, listener: Listener): () => void {
    const key = stateKey(fileId, outputSessionId);
    let set = this.listenersByKey.get(key);
    if (!set) {
      set = new Set<Listener>();
      this.listenersByKey.set(key, set);
    }
    set.add(listener);
    return () => {
      const listeners = this.listenersByKey.get(key);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listenersByKey.delete(key);
      }
    };
  }

  evict(fileId: string, outputSessionId: string): void {
    const key = stateKey(fileId, outputSessionId);
    this.stateByKey.delete(key);
    this.listenersByKey.delete(key);
  }

  private patch(fileId: string, outputSessionId: string, patch: QueryViewState): void {
    const files = this.filesRegistry;
    if (!files) {
      return;
    }
    const file = files.getFile(fileId);
    if (!file) {
      return;
    }
    const key = stateKey(fileId, outputSessionId);
    const previous = this.stateByKey.get(key) ?? readStateFromFile(file, outputSessionId);
    const next: QueryViewState = {
      ...previous,
      ...patch
    };
    this.stateByKey.set(key, next);
    const persisted = readPersistedStates(file?.persistentViewState?.[QUERY_VIEW_STATE_KEY]);
    persisted.sessions[outputSessionId] = next;
    files.updateFile(fileId, {
      persistentViewState: {
        ...(file.persistentViewState ?? {}),
        [QUERY_VIEW_STATE_KEY]: persisted
      }
    });
    this.emit(key, next);
  }

  private emit(key: string, state: QueryViewState): void {
    const listeners = this.listenersByKey.get(key);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(state);
    }
  }
}

function readStateFromFile(file: FileEntity | undefined, outputSessionId: string): QueryViewState {
  const raw = file?.persistentViewState?.[QUERY_VIEW_STATE_KEY];
  if (isPersistedQueryViewStates(raw)) {
    return readLegacyState(raw.sessions[outputSessionId]);
  }
  return readLegacyState(raw);
}

function readPersistedStates(raw: unknown): PersistedQueryViewStates {
  if (isPersistedQueryViewStates(raw)) {
    const sessions: Record<string, QueryViewState> = {};
    for (const [sessionId, state] of Object.entries(raw.sessions)) {
      sessions[sessionId] = readLegacyState(state);
    }
    return {
      version: 2,
      sessions
    };
  }
  return {
    version: 2,
    sessions: {}
  };
}

function isPersistedQueryViewStates(value: unknown): value is RawPersistedQueryViewStates {
  if (!value || typeof value !== "object") {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return raw.version === 2 && typeof raw.sessions === "object" && raw.sessions !== null && !Array.isArray(raw.sessions);
}

function readLegacyState(raw: unknown): QueryViewState {
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
    textOutputFormat: typeof value.textOutputFormat === "string" ? value.textOutputFormat : undefined,
    includeActualPlan: value.includeActualPlan === true,
    outputPanelCollapsed: value.outputPanelCollapsed === true
  };
}

const instance = new QueryViewStateStore();

export function getQueryViewStateStore(): QueryViewStateStore {
  return instance;
}
