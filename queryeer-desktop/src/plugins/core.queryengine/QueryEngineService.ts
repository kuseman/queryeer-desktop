type QueryEvent = { method: string; params: unknown };
type QueryEventListener = (event: QueryEvent) => void;
type SimpleListener = () => void;

let serviceInstance: QueryEngineService | undefined;

export function getQueryEngineService(): QueryEngineService {
  if (!serviceInstance) {
    serviceInstance = new QueryEngineService();
  }
  return serviceInstance;
}

export class QueryEngineService {
  private readonly executionListeners = new Map<string, Set<QueryEventListener>>();
  private readonly executeRequestListeners = new Set<SimpleListener>();
  private readonly cancelRequestListeners = new Set<SimpleListener>();
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    window.appShell.onQueryEvent((event) => {
      const params = event.params as { queryExecutionId?: string };
      const executionId = params?.queryExecutionId;
      if (!executionId) return;

      const listeners = this.executionListeners.get(executionId);
      if (listeners) {
        for (const listener of listeners) {
          listener(event);
        }
      }
    });
  }

  subscribe(executionId: string, listener: QueryEventListener): () => void {
    if (!this.executionListeners.has(executionId)) {
      this.executionListeners.set(executionId, new Set());
    }
    this.executionListeners.get(executionId)!.add(listener);

    return () => {
      const set = this.executionListeners.get(executionId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.executionListeners.delete(executionId);
        }
      }
    };
  }

  async execute(params: { engineId: string; text: string }): Promise<string> {
    const queryExecutionId = crypto.randomUUID();
    await window.appShell.executeBackendQuery({ queryExecutionId, engineId: params.engineId, text: params.text });
    return queryExecutionId;
  }

  async cancel(queryExecutionId: string): Promise<void> {
    await window.appShell.cancelBackendQuery({ queryExecutionId });
  }

  requestExecute(): void {
    for (const listener of this.executeRequestListeners) {
      listener();
    }
  }

  requestCancel(): void {
    for (const listener of this.cancelRequestListeners) {
      listener();
    }
  }

  onExecuteRequest(listener: SimpleListener): () => void {
    this.executeRequestListeners.add(listener);
    return () => {
      this.executeRequestListeners.delete(listener);
    };
  }

  onCancelRequest(listener: SimpleListener): () => void {
    this.cancelRequestListeners.add(listener);
    return () => {
      this.cancelRequestListeners.delete(listener);
    };
  }
}
