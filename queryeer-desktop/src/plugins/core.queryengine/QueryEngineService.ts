import { BackendNotReadyError } from "../../contracts/backend/BackendNotReadyError";
import type { QueryExecuteOptions } from "../../contracts/backend/Types";
import { getCoreSecurityService } from "../core.security/service";
import type { Column } from "../../contracts/extensions/OutputExtension";

export type CollectedResultSet = {
  schema: { columns: Column[] };
  rows: unknown[][];
};

export type CollectedResults = {
  resultSets: CollectedResultSet[];
};

type QueryEvent = { method: string; params: unknown };
type QueryEventListener = (event: QueryEvent) => void;
type GlobalQueryEventListener = (event: QueryEvent, context?: ExecuteParams) => void;
type SimpleListener = () => void;

export type ExecuteRequestOptions = {
  /** When set, overrides the text taken from the editor. */
  textOverride?: string;
  /** When set, overrides the output contributor selected in the toolbar. */
  outputIdOverride?: string;
  /** When set, overrides the text output format (e.g. "plain", "csv", "json"). */
  formatOverride?: string;
  /** When set, overrides backend execution options for this execute request. */
  optionsOverride?: QueryExecuteOptions;
};
type ExecutionContextProvider = (params: ExecuteParams) => Partial<ExecuteParams> | void;
type EngineResolver = (params: Omit<ExecuteParams, "engineId">) => string | undefined;
type EngineResolverEntry = {
  resolver: EngineResolver;
  id: string;
};

type ExecuteParams = {
  engineId?: string;
  text: string;
  fileId: string;
  engineState?: unknown;
  options?: QueryExecuteOptions;
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
  private readonly engineResolvers: EngineResolverEntry[] = [];
  private readonly executionContextById = new Map<string, ExecuteParams>();
  private initialized = false;
  private pendingExecuteOptions: ExecuteRequestOptions | null = null;

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

      if (event.method === "queryengine.completed" || event.method === "queryengine.failed") {
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
    await ensureBackendHealthy();
    const queryExecutionId = crypto.randomUUID();
    const engineId = params.engineId ?? this.resolveEngineId(params);
    if (!engineId) {
      throw new Error("No query engine matched this file");
    }
    const decoratedParams = this.decorateExecuteParams({
      ...params,
      engineId
    });
    this.executionContextById.set(queryExecutionId, decoratedParams);
    for (const listener of this.globalEventListeners) {
      listener(
        {
          method: "query.started",
          params: { queryExecutionId }
        },
        decoratedParams
      );
    }
    try {
      await withVaultRetry(async () => {
        await window.appShell.executeBackendQuery({
          queryExecutionId,
          engineId,
          fileId: decoratedParams.fileId,
          text: decoratedParams.text,
          engineState: decoratedParams.engineState,
          options: decoratedParams.options
        });
      });
    } catch (error) {
      this.executionContextById.delete(queryExecutionId);
      const message = error instanceof Error ? error.message : String(error);
      for (const listener of this.globalEventListeners) {
        listener(
          {
            method: "queryengine.failed",
            params: {
              queryExecutionId,
              error: {
                code: "EXECUTE_ERROR",
                message
              }
            }
          },
          decoratedParams
        );
      }
      throw error;
    }
    return queryExecutionId;
  }

  async cancel(queryExecutionId: string): Promise<void> {
    await ensureBackendHealthy();
    await window.appShell.cancelBackendQuery({ queryExecutionId });
  }

  /**
   * Executes a query and collects all result rows into memory.
   * Useful for consumers like tree actions that need the full result text
   * rather than streaming to an output panel.
   */
  async executeAndCollect(params: ExecuteParams): Promise<CollectedResults> {
    const collector = new Map<number, CollectedResultSet>();

    return new Promise<CollectedResults>((resolve, reject) => {
      let resolved = false;

      this.execute(params)
        .then((executionId) => {
          const unsubscribe = this.subscribe(executionId, (event) => {
            if (event.method === "queryengine.chunkStart") {
              const p = event.params as { resultSetIndex: number; schema: { columns: Column[] } };
              collector.set(p.resultSetIndex, { schema: p.schema, rows: [] });
            } else if (event.method === "queryengine.chunkRows") {
              const p = event.params as { resultSetIndex: number; rows: unknown[][] };
              const rs = collector.get(p.resultSetIndex);
              if (rs) {
                rs.rows.push(...p.rows);
              }
            } else if (event.method === "queryengine.completed") {
              unsubscribe();
              if (!resolved) {
                resolved = true;
                const resultSets = Array.from(collector.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([, rs]) => rs);
                resolve({ resultSets });
              }
            } else if (event.method === "queryengine.failed") {
              unsubscribe();
              const p = event.params as { error?: { message: string } };
              if (!resolved) {
                resolved = true;
                reject(new Error(p.error?.message ?? "Query execution failed"));
              }
            }
          });
        })
        .catch((error) => {
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        });
    });
  }

  async invoke(params: EngineInvokeParams, options?: { silent?: boolean }): Promise<unknown> {
    await ensureBackendHealthy();
    const response = await withVaultRetry(async () => {
      const resp = await window.appShell.invokeBackendEngine(params);
      if (resp.error?.code === "SECURITY_SESSION_CLOSED") {
        throw new Error(`SECURITY_SESSION_CLOSED: ${resp.error.message}`);
      }
      return resp;
    }, { interactive: !options?.silent });
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  requestExecute(options?: ExecuteRequestOptions): void {
    this.pendingExecuteOptions = options ?? null;
    for (const listener of this.executeRequestListeners) {
      listener();
    }
  }

  consumeExecuteOptions(): ExecuteRequestOptions | null {
    const opts = this.pendingExecuteOptions;
    this.pendingExecuteOptions = null;
    return opts;
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

  registerEngineResolver(resolver: EngineResolver, options?: { id?: string }): () => void {
    const entry: EngineResolverEntry = {
      resolver,
      id: options?.id ?? `resolver-${this.engineResolvers.length + 1}`
    };
    this.engineResolvers.push(entry);
    return () => {
      const index = this.engineResolvers.indexOf(entry);
      if (index >= 0) {
        this.engineResolvers.splice(index, 1);
      }
    };
  }

  getEngineResolverDiagnostics(fileId?: string): {
    resolvers: string[];
    matchedEngineId?: string;
    matchedByResolver?: string;
  } {
    const result = this.resolveEngine(fileId ? { fileId, text: "" } : undefined);
    return {
      resolvers: this.engineResolvers.map((entry) => entry.id),
      matchedEngineId: result?.engineId,
      matchedByResolver: result?.resolverId
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

  private resolveEngineId(params: Omit<ExecuteParams, "engineId">): string | undefined {
    return this.resolveEngine(params)?.engineId;
  }

  private resolveEngine(
    params?: Omit<ExecuteParams, "engineId">
  ): { engineId: string; resolverId: string } | undefined {
    if (!params) {
      return undefined;
    }
    for (const entry of this.engineResolvers) {
      const engineId = entry.resolver(params);
      if (engineId) {
        return {
          engineId,
          resolverId: entry.id
        };
      }
    }
    return undefined;
  }
}

async function ensureBackendHealthy(): Promise<void> {
  const status = await window.appShell.getBackendStatus();
  if (status.state === "healthy") {
    return;
  }
  throw new BackendNotReadyError();
}

async function withVaultRetry<T>(operation: () => Promise<T>, options?: { interactive?: boolean }): Promise<T> {
  const security = getCoreSecurityService();
  if (!security) {
    return operation();
  }

  return security.withVaultRetry(operation, { interactive: options?.interactive ?? true });
}
