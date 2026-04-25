import type { QueryExecutionStatus } from "../../contracts/backend/index.js";

type QueryProgressPayload = {
  queryExecutionId: string;
  percent?: number;
  message?: string;
};

type QueryResultChunkPayload = {
  queryExecutionId: string;
  rows?: unknown[][];
};

type QueryCompletionPayload = {
  queryExecutionId: string;
};

type QueryFailurePayload = {
  queryExecutionId: string;
  error?: { code?: string; message?: string };
};

export class BackendExecutionStore {
  private readonly executionStatuses = new Map<string, QueryExecutionStatus>();

  public markAccepted(queryExecutionId: string, engineId: string): void {
    const now = new Date().toISOString();
    this.executionStatuses.set(queryExecutionId, {
      queryExecutionId,
      engineId,
      state: "accepted",
      chunks: 0,
      rows: 0,
      startedAt: now,
      updatedAt: now
    });
  }

  public onProgress(params: QueryProgressPayload): void {
    this.updateExecution(params.queryExecutionId, (current) => ({
      ...current,
      state: "running",
      progressPercent: params.percent,
      progressMessage: params.message,
      updatedAt: new Date().toISOString()
    }));
  }

  public onResultChunk(params: QueryResultChunkPayload): void {
    this.updateExecution(params.queryExecutionId, (current) => ({
      ...current,
      state: "running",
      chunks: current.chunks + 1,
      rows: current.rows + (params.rows?.length ?? 0),
      updatedAt: new Date().toISOString()
    }));
  }

  public onCompleted(params: QueryCompletionPayload): void {
    this.updateExecution(params.queryExecutionId, (current) => ({
      ...current,
      state: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }

  public onFailed(params: QueryFailurePayload): void {
    this.updateExecution(params.queryExecutionId, (current) => ({
      ...current,
      state: params.error?.code === "CANCELLED" ? "cancelled" : "failed",
      error: params.error?.message,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }

  public getActiveExecutionIds(): string[] {
    return this.getAll().filter(this.isActiveState).map((execution) => execution.queryExecutionId);
  }

  public getRecentExecutions(limit = 12): QueryExecutionStatus[] {
    return this.getAll().slice(0, limit);
  }

  private getAll(): QueryExecutionStatus[] {
    return [...this.executionStatuses.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private readonly isActiveState = (execution: QueryExecutionStatus): boolean =>
    execution.state === "accepted" || execution.state === "running";

  private updateExecution(
    queryExecutionId: string,
    updater: (current: QueryExecutionStatus) => QueryExecutionStatus
  ): void {
    const current = this.executionStatuses.get(queryExecutionId);
    if (!current) {
      return;
    }
    this.executionStatuses.set(queryExecutionId, updater(current));
  }
}
