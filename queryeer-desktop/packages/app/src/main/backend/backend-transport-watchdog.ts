import type { BackendEnvelope } from "@queryeer/api/backend/index.js";
import type { BackendGatewayMode } from "@queryeer/api/backend/index.js";
import { redactErrorMessage } from "./backend-log-redaction.js";
import type {
  BackendTransport,
  BackendTransportCallbacks,
  BackendTransportFactory
} from "./backend-transport.js";

const MAX_RESTARTS = 5;
const MAX_RESTART_DELAY_MS = 30_000;

export class WatchdogBackendTransport implements BackendTransport {
  public readonly mode: BackendGatewayMode;

  private current: BackendTransport | null = null;
  private restartAttempts = 0;
  private stopped = false;
  private restartTimer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly factory: BackendTransportFactory,
    private readonly outerCallbacks: Omit<BackendTransportCallbacks, "onDied">,
    private readonly onRestartReady: () => Promise<void>,
    private readonly onTransportDied?: () => void
  ) {
    this.mode = factory.mode;
  }

  public async start(): Promise<void> {
    this.current = this.spawnInner();
    await this.current.start();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    await this.current?.stop();
    this.current = null;
  }

  public sendEnvelope(envelope: BackendEnvelope): void {
    if (!this.current) {
      throw new Error("Backend transport is not running (watchdog: no active instance)");
    }
    this.current.sendEnvelope(envelope);
  }

  private spawnInner(): BackendTransport {
    return this.factory.create({
      ...this.outerCallbacks,
      onDied: () => this.handleDied()
    });
  }

  private handleDied(): void {
    this.current = null;
    this.onTransportDied?.();
    if (this.stopped) {
      return;
    }
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.restartAttempts >= MAX_RESTARTS) {
      this.outerCallbacks.onDiagnostic({
        level: "error",
        source: "transport",
        message: `Backend watchdog: restart limit reached (${MAX_RESTARTS} attempts), giving up`
      });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.restartAttempts), MAX_RESTART_DELAY_MS);
    this.restartAttempts++;

    this.outerCallbacks.onDiagnostic({
      level: "warn",
      source: "transport",
      message: `Backend watchdog: restarting in ${delay}ms (attempt ${this.restartAttempts}/${MAX_RESTARTS})`
    });

    this.restartTimer = setTimeout(() => {
      if (this.stopped) {
        return;
      }
      this.restartTimer = null;
      void this.doRestart();
    }, delay);
  }

  private async doRestart(): Promise<void> {
    try {
      const next = this.spawnInner();
      await next.start();
      if (this.stopped) {
        await next.stop();
        return;
      }
      this.current = next;
      this.restartAttempts = 0;
      this.outerCallbacks.onDiagnostic({
        level: "info",
        source: "transport",
        message: "Backend watchdog: process restarted successfully"
      });
      await this.onRestartReady();
    } catch (error) {
      if (this.stopped) {
        return;
      }
      const message = redactErrorMessage(error);
      this.outerCallbacks.onDiagnostic({
        level: "error",
        source: "transport",
        message: `Backend watchdog: restart attempt failed: ${message}`
      });
      this.scheduleRestart();
    }
  }
}
