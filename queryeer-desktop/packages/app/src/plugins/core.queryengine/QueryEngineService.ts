import { BackendNotReadyError } from "@queryeer/api/backend/BackendNotReadyError";
import type { QueryExecuteOptions, QueryResultCell } from "@queryeer/api/backend/Types.js";
import type { Column } from "@queryeer/api/queryengine/OutputExtension.js";
import type { CollectedResultSet, CollectedResults, ExecuteRequestOptions } from "@queryeer/api/queryengine/QueryEngineTypes.js";
import { getCoreSecurityService } from "../core.security/service";

type QueryEvent = { method: string; params: unknown };
type QueryEventListener = (event: QueryEvent) => void;
type GlobalQueryEventListener = (event: QueryEvent, context?: ExecuteParams) => void;
type SimpleListener = () => void;

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
  targetOutputSessionId?: string;
};

type EngineInvokeParams = {
  engineId: string;
  fileId?: string;
  action: string;
  payload?: unknown;
};

type ExecuteRequestConsumeTarget = {
  fileId?: string;
  targetOutputSessionId?: string;
  targetEditorGroupId?: string;
  isActiveEditorGroup?: boolean;
};

class SecuritySessionClosedError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

let serviceInstance: QueryEngineService | undefined;

export function getQueryEngineService(): QueryEngineService {
  if (!serviceInstance) {
    serviceInstance = new QueryEngineService();
  }
  return serviceInstance;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class QueryEngineService {
  private readonly executionListeners = new Map<string, Set<QueryEventListener>>();
  private readonly globalEventListeners = new Set<GlobalQueryEventListener>();
  private readonly executeRequestListeners = new Set<SimpleListener>();
  private readonly cancelRequestListeners = new Set<SimpleListener>();
  private readonly toggleOutputPanelRequestListeners = new Set<SimpleListener>();
  private readonly executionContextProviders = new Set<ExecutionContextProvider>();
  private readonly engineResolvers: EngineResolverEntry[] = [];
  private readonly executionContextById = new Map<string, ExecuteParams>();
  private readonly pendingEventBuffers = new Map<string, QueryEvent[]>();
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
      } else {
        // No listener yet — buffer event for replay when subscribe() is called
        const buffer = this.pendingEventBuffers.get(executionId);
        if (buffer) {
          buffer.push(event);
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

    // Replay any events that arrived before subscribe() was called
    const buffer = this.pendingEventBuffers.get(executionId);
    if (buffer) {
      this.pendingEventBuffers.delete(executionId);
      for (const event of buffer) {
        listener(event);
      }
    }

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
    const targetOutputSessionId = params.targetOutputSessionId;
    const decoratedParams = this.decorateExecuteParams({
      ...params,
      engineId
    });
    if (targetOutputSessionId !== undefined) {
      decoratedParams.targetOutputSessionId = targetOutputSessionId;
    }
    this.executionContextById.set(queryExecutionId, decoratedParams);
    // Pre-register event buffer before IPC call so early-arriving events are captured
    this.pendingEventBuffers.set(queryExecutionId, []);
    // Clean up orphaned buffers whose execution context was already deleted
    for (const id of this.pendingEventBuffers.keys()) {
      if (!this.executionContextById.has(id)) {
        this.pendingEventBuffers.delete(id);
      }
    }
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
      this.pendingEventBuffers.delete(queryExecutionId);
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
    const context = this.executionContextById.get(queryExecutionId);
    if (!context) {
      return;
    }
    const event = {
      method: "queryengine.failed",
      params: {
        queryExecutionId,
        error: {
          code: "CANCELLED",
          message: "Execution cancelled by client"
        }
      }
    };
    for (const listener of this.globalEventListeners) {
      listener(event, context);
    }
    this.executionContextById.delete(queryExecutionId);
  }

  /**
   * Executes a query and collects all result rows into memory.
   * Useful for consumers like tree actions that need the full result text
   * rather than streaming to an output panel.
   */
  async executeAndCollect(params: ExecuteParams): Promise<CollectedResults> {
    try {
      return await this.executeAndCollectOnce(params);
    } catch (error) {
      if (!(error instanceof SecuritySessionClosedError)) {
        throw error;
      }

      const security = getCoreSecurityService();
      const accepted = security
        ? await security.ensureUnlockedForSecretAccess({ interactive: true })
        : false;
      if (!accepted) {
        throw new Error("Security vault is locked");
      }

      try {
        return await this.executeAndCollectOnce(params);
      } catch (retryError) {
        if (retryError instanceof SecuritySessionClosedError) {
          throw new Error(retryError.message);
        }
        throw retryError;
      }
    }
  }

  private async executeAndCollectOnce(params: ExecuteParams): Promise<CollectedResults> {
    const collector = new Map<number, CollectedResultSet>();

    return new Promise<CollectedResults>((resolve, reject) => {
      let settled = false;

      this.execute(params)
        .then((executionId) => {
          const unsubscribe = this.subscribe(executionId, (event) => {
            if (event.method === "queryengine.chunkStart") {
              const p = event.params as { resultSetIndex: number; schema: { columns: Column[] } };
              collector.set(p.resultSetIndex, { schema: p.schema, rows: [] });
              return;
            }

            if (event.method === "queryengine.chunkRows") {
              const p = event.params as { resultSetIndex: number; rows: QueryResultCell[][] };
              const rs = collector.get(p.resultSetIndex);
              if (rs) {
                rs.rows.push(...p.rows);
              }
              return;
            }

            if (event.method === "queryengine.completed") {
              unsubscribe();
              if (!settled) {
                settled = true;
                const resultSets = Array.from(collector.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([, rs]) => rs);
                resolve({ resultSets });
              }
              return;
            }

            if (event.method === "queryengine.failed") {
              unsubscribe();
              const p = event.params as { error?: { code?: string; message?: string } };
              if (!settled) {
                settled = true;
                if (p.error?.code === "SECURITY_SESSION_CLOSED") {
                  reject(new SecuritySessionClosedError(p.error.message ?? "Security session is not open"));
                  return;
                }
                reject(new Error(p.error?.message ?? "Query execution failed"));
              }
            }
          });
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
    });
  }

  async invoke(params: EngineInvokeParams, options?: { silent?: boolean }): Promise<unknown> {
    await ensureBackendHealthy();
    const decoratedParams = this.decorateInvokeParams(params);
    const response = await withVaultRetry(async () => {
      const resp = await window.appShell.invokeBackendEngine(decoratedParams);
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

  peekExecuteOptions(): ExecuteRequestOptions | null {
    return this.pendingExecuteOptions;
  }

  consumeExecuteOptions(fileId?: string): ExecuteRequestOptions | null;
  consumeExecuteOptions(target?: ExecuteRequestConsumeTarget): ExecuteRequestOptions | null;
  consumeExecuteOptions(target?: string | ExecuteRequestConsumeTarget): ExecuteRequestOptions | null {
    const opts = this.pendingExecuteOptions;
    if (!opts) return null;

    const targetInfo: ExecuteRequestConsumeTarget = typeof target === "string"
      ? { fileId: target }
      : (target ?? {});

    if (opts.targetOutputSessionId && opts.targetOutputSessionId !== targetInfo.targetOutputSessionId) {
      return null;
    }
    if (opts.targetEditorGroupId && opts.targetEditorGroupId !== targetInfo.targetEditorGroupId) {
      return null;
    }
    if (opts.fileIdOverride && opts.fileIdOverride !== targetInfo.fileId) {
      return null;
    }
    if (!opts.targetOutputSessionId && !opts.targetEditorGroupId && targetInfo.isActiveEditorGroup === false) {
      return null;
    }
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

  requestToggleOutputPanel(): void {
    for (const listener of this.toggleOutputPanelRequestListeners) {
      listener();
    }
  }

  onToggleOutputPanelRequest(listener: SimpleListener): () => void {
    this.toggleOutputPanelRequestListeners.add(listener);
    return () => {
      this.toggleOutputPanelRequestListeners.delete(listener);
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
        const nextPatch = { ...patch };
        if (params.engineState !== undefined && nextPatch.engineState !== undefined) {
          delete nextPatch.engineState;
        }
        next = {
          ...next,
          ...nextPatch
        };
      }
    }
    return next;
  }

  private decorateInvokeParams(params: EngineInvokeParams): EngineInvokeParams {
    const payload = params.payload;
    if (!params.fileId || !isObjectRecord(payload) || Object.prototype.hasOwnProperty.call(payload, "engineState")) {
      return params;
    }

    const decorated = this.decorateExecuteParams({
      engineId: params.engineId,
      fileId: params.fileId,
      text: typeof payload.text === "string" ? payload.text : ""
    });
    if (decorated.engineState === undefined) {
      return params;
    }

    return {
      ...params,
      payload: {
        ...payload,
        engineState: decorated.engineState
      }
    };
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
