import type { BackendResponseEnvelope } from "../../contracts/backend/index.js";

export type PendingRequestHandlers = {
  onResolve: (response: BackendResponseEnvelope) => void;
  onReject: (reason: Error) => void;
};

type PendingRequestEntry = {
  timeout: NodeJS.Timeout;
  handlers: PendingRequestHandlers;
};

export class BackendPendingRequestMap {
  private readonly pending = new Map<string, PendingRequestEntry>();

  public register(
    requestId: string,
    timeout: NodeJS.Timeout,
    handlers: PendingRequestHandlers
  ): void {
    this.pending.set(requestId, {
      timeout,
      handlers
    });
  }

  public resolve(requestId: string, response: BackendResponseEnvelope): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return false;
    }
    this.pending.delete(requestId);
    clearTimeout(entry.timeout);
    entry.handlers.onResolve(response);
    return true;
  }

  public reject(requestId: string, reason: Error): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return false;
    }
    this.pending.delete(requestId);
    clearTimeout(entry.timeout);
    entry.handlers.onReject(reason);
    return true;
  }

  public cancel(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return;
    }
    this.pending.delete(requestId);
    clearTimeout(entry.timeout);
  }

  public size(): number {
    return this.pending.size;
  }
}
