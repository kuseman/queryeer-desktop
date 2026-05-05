import type { BackendGatewayStatus } from "../../contracts/backend/index.js";

type Listener = (status: BackendGatewayStatus) => void;

class BackendStatusService {
  private listeners = new Set<Listener>();
  private currentStatus: BackendGatewayStatus | null = null;
  private unsubscribeShell: (() => void) | null = null;

  public start(): void {
    if (this.unsubscribeShell) {
      return;
    }
    this.unsubscribeShell = window.appShell.onBackendStatusChanged((status) => {
      this.currentStatus = status;
      for (const listener of this.listeners) {
        listener(status);
      }
    });
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getCurrentStatus(): BackendGatewayStatus | null {
    return this.currentStatus;
  }

  public stop(): void {
    this.unsubscribeShell?.();
    this.unsubscribeShell = null;
  }
}

let instance: BackendStatusService | null = null;

export function getBackendStatusService(): BackendStatusService {
  if (!instance) {
    instance = new BackendStatusService();
    instance.start();
  }
  return instance;
}

export function resetBackendStatusServiceForTests(): void {
  instance?.stop();
  instance = null;
}
