type QueryEvent = { method: string; params: unknown };
type QueryEventListener = (event: QueryEvent) => void;
type GlobalQueryEventListener = (event: QueryEvent, context?: ExecuteParams) => void;
type SimpleListener = () => void;
type ExecutionContextProvider = (params: ExecuteParams) => Partial<ExecuteParams> | void;

type ExecuteParams = {
  engineId: string;
  text: string;
  fileId?: string;
  engineState?: unknown;
};

type EngineInvokeParams = {
  engineId: string;
  fileId?: string;
  action: string;
  payload?: unknown;
};

let serviceInstance: QueryEngineService | undefined;

export function getQueryEngineService(): QueryEngineService {
  if (!serviceInstance) {
    serviceInstance = new QueryEngineService();
  }
  return serviceInstance;
}

export class QueryEngineService {
  private readonly executionListeners = new Map<string, Set<QueryEventListener>>();
  private readonly globalEventListeners = new Set<GlobalQueryEventListener>();
  private readonly executeRequestListeners = new Set<SimpleListener>();
  private readonly cancelRequestListeners = new Set<SimpleListener>();
  private readonly executionContextProviders = new Set<ExecutionContextProvider>();
  private readonly executionContextById = new Map<string, ExecuteParams>();
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

      const context = this.executionContextById.get(executionId);
      for (const listener of this.globalEventListeners) {
        listener(event, context);
      }

      if (event.method === "query.completed" || event.method === "query.failed") {
        this.executionContextById.delete(executionId);
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

  async execute(params: ExecuteParams): Promise<string> {
    const queryExecutionId = crypto.randomUUID();
    const decoratedParams = this.decorateExecuteParams(params);
    this.executionContextById.set(queryExecutionId, decoratedParams);
    await window.appShell.executeBackendQuery({
      queryExecutionId,
      engineId: decoratedParams.engineId,
      fileId: decoratedParams.fileId,
      text: decoratedParams.text,
      engineState: decoratedParams.engineState
    });
    return queryExecutionId;
  }

  async cancel(queryExecutionId: string): Promise<void> {
    await window.appShell.cancelBackendQuery({ queryExecutionId });
  }

  async invoke(params: EngineInvokeParams): Promise<unknown> {
    const response = await window.appShell.invokeBackendEngine(params);
    return response.result;
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

  onQueryEvent(listener: GlobalQueryEventListener): () => void {
    this.globalEventListeners.add(listener);
    return () => {
      this.globalEventListeners.delete(listener);
    };
  }

  registerExecutionContextProvider(provider: ExecutionContextProvider): () => void {
    this.executionContextProviders.add(provider);
    return () => {
      this.executionContextProviders.delete(provider);
    };
  }

  private decorateExecuteParams(params: ExecuteParams): ExecuteParams {
    let next = { ...params };
    for (const provider of this.executionContextProviders) {
      const patch = provider(next);
      if (patch) {
        next = {
          ...next,
          ...patch
        };
      }
    }
    return next;
  }
}
