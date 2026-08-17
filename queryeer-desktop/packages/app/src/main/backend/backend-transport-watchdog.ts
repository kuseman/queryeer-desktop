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

  private current: { transport: BackendTransport; intentionalStop: boolean } | null = null;
  private restartAttempts = 0;
  private stopped = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private lifecyclePromise: Promise<void> = Promise.resolve();

  public constructor(
    private readonly factory: BackendTransportFactory,
    private readonly outerCallbacks: Omit<BackendTransportCallbacks, "onDied">,
    private readonly onRestartReady: () => Promise<void>,
    private readonly onTransportDied?: () => void
  ) {
    this.mode = factory.mode;
  }

  public async start(): Promise<void> {
    this.stopped = false;
    await this.serialize(async () => {
      if (this.current) {
        return;
      }
      const next = this.spawnInner();
      this.current = next;
      try {
        await next.transport.start();
      } catch (error) {
        if (this.current === next) {
          this.current = null;
        }
        throw error;
      }
    });
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.clearRestartTimer();
    if (this.current) {
      this.current.intentionalStop = true;
    }
    await this.serialize(async () => {
      const current = this.current;
      this.current = null;
      if (current) {
        current.intentionalStop = true;
        await current.transport.stop();
      }
    });
  }

  public async restart(beforeStart?: () => void | Promise<void>): Promise<void> {
    this.clearRestartTimer();
    if (this.current) {
      this.current.intentionalStop = true;
    }
    await this.serialize(async () => {
      if (this.stopped) {
        throw new Error("Backend transport is stopped");
      }

      const current = this.current;
      this.current = null;
      if (current) {
        current.intentionalStop = true;
        await current.transport.stop();
      }

      let next: { transport: BackendTransport; intentionalStop: boolean } | null = null;
      try {
        await beforeStart?.();
        next = this.spawnInner();
        this.current = next;
        await next.transport.start();
        if (this.stopped) {
          this.current = null;
          next.intentionalStop = true;
          await next.transport.stop();
          return;
        }
        if (this.current !== next) {
          return;
        }
        this.restartAttempts = 0;
        await this.onRestartReady();
      } catch (error) {
        if (next && this.current === next) {
          this.current = null;
        }
        if (!this.stopped) {
          this.scheduleRestart();
        }
        throw error;
      }
    });
  }

  public sendEnvelope(envelope: BackendEnvelope): void {
    if (!this.current) {
      throw new Error("Backend transport is not running (watchdog: no active instance)");
    }
    this.current.transport.sendEnvelope(envelope);
  }

  private spawnInner(): { transport: BackendTransport; intentionalStop: boolean } {
    const inner: { transport: BackendTransport; intentionalStop: boolean } = {
      transport: null as unknown as BackendTransport,
      intentionalStop: false
    };
    inner.transport = this.factory.create({
      ...this.outerCallbacks,
      onDied: () => this.handleDied(inner)
    });
    return inner;
  }

  private handleDied(inner: { transport: BackendTransport; intentionalStop: boolean }): void {
    if (inner.intentionalStop || this.current !== inner) {
      return;
    }
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
      void this.serialize(() => this.doRestart());
    }, delay);
  }

  private async doRestart(): Promise<void> {
    let next: { transport: BackendTransport; intentionalStop: boolean } | null = null;
    try {
      next = this.spawnInner();
      this.current = next;
      await next.transport.start();
      if (this.stopped) {
        next.intentionalStop = true;
        await next.transport.stop();
        return;
      }
      if (this.current !== next) {
        return;
      }
      this.restartAttempts = 0;
      this.outerCallbacks.onDiagnostic({
        level: "info",
        source: "transport",
        message: "Backend watchdog: process restarted successfully"
      });
      await this.onRestartReady();
    } catch (error) {
      if (this.current === next) {
        this.current = null;
      }
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

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const next = this.lifecyclePromise.then(operation, operation);
    this.lifecyclePromise = next.catch(() => {});
    return next;
  }
}
