export type RecurringExecutionClock = {
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
};

const defaultClock: RecurringExecutionClock = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle)
};

export class RecurringExecutionController {
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private paused = false;
  private pauseReason: string | undefined;
  private nextRunAtMs: number | undefined;
  private consecutiveInfrastructureFailures = 0;

  public constructor(
    public readonly intervalSeconds: number,
    private readonly onTick: () => void,
    private readonly onStatusChanged: (status: QueryScheduleState) => void = () => {},
    private readonly clock: RecurringExecutionClock = defaultClock
  ) {
    if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      throw new Error("Execution interval must be a positive whole number of seconds");
    }
  }

  public start(): void {
    if (this.intervalHandle !== undefined) {
      return;
    }
    this.paused = false;
    this.pauseReason = undefined;
    this.runTick();
    this.intervalHandle = this.clock.setInterval(() => this.runTick(), this.intervalSeconds * 1000);
  }

  public stop(): void {
    if (this.intervalHandle === undefined) {
      return;
    }
    this.clock.clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
    this.nextRunAtMs = undefined;
  }

  public pause(reason: string): void {
    this.stop();
    this.paused = true;
    this.pauseReason = reason;
    this.emitStatus();
  }

  public recordSuccess(): void {
    if (this.consecutiveInfrastructureFailures === 0) return;
    this.consecutiveInfrastructureFailures = 0;
    this.emitStatus();
  }

  public recordInfrastructureFailure(reason: string, threshold = 3): boolean {
    this.consecutiveInfrastructureFailures += 1;
    if (this.consecutiveInfrastructureFailures >= threshold) {
      this.pause(reason);
      return true;
    }
    this.emitStatus();
    return false;
  }

  public getStatus(): QueryScheduleState {
    return {
      intervalSeconds: this.intervalSeconds,
      paused: this.paused,
      ...(this.pauseReason ? { pauseReason: this.pauseReason } : {}),
      ...(this.nextRunAtMs !== undefined ? { nextRunAtMs: this.nextRunAtMs } : {}),
      consecutiveInfrastructureFailures: this.consecutiveInfrastructureFailures
    };
  }

  private runTick(): void {
    this.nextRunAtMs = Date.now() + this.intervalSeconds * 1000;
    this.emitStatus();
    this.onTick();
  }

  private emitStatus(): void {
    this.onStatusChanged(this.getStatus());
  }
}
import type { QueryScheduleState } from "@queryeer/api/queryengine/QueryEngineTypes.js";
