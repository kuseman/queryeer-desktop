import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { BackendEnvelope } from "@queryeer/api/backend/index.js";
import type { BackendGatewayMode } from "@queryeer/api/backend/index.js";
import { redactErrorMessage, redactLogMessage } from "./backend-log-redaction.js";
import { FrameParser } from "./frame-parser.js";
import type { BackendTransport, BackendTransportCallbacks } from "./backend-transport.js";

export abstract class StdioBackendTransportBase implements BackendTransport {
  public abstract readonly mode: BackendGatewayMode;

  protected readonly callbacks: BackendTransportCallbacks;
  private process: ChildProcessWithoutNullStreams | null = null;
  protected lastErrorLine: string | null = null;
  private stdinBroken = false;
  private stderrReader: ReturnType<typeof createInterface> | null = null;
  private deadNotified = false;

  protected constructor(callbacks: BackendTransportCallbacks) {
    this.callbacks = callbacks;
  }

  /** Subclasses perform any pre-checks and spawn the backend process. */
  protected abstract spawnBackendProcess(): Promise<ChildProcessWithoutNullStreams>;

  public async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const proc = await this.spawnBackendProcess();
    this.process = proc;
    this.stdinBroken = false;
    this.deadNotified = false;

    proc.stdin.on("error", (error) => {
      this.stdinBroken = true;
      this.lastErrorLine = redactLogMessage(`Backend stdin error: ${error.message}`);
      this.callbacks.onDiagnostic({ level: "error", source: "transport", message: this.lastErrorLine });
    });

    const frameParser = new FrameParser();
    frameParser.onFrame = (json) => {
      try {
        const envelope = JSON.parse(json) as BackendEnvelope;
        this.callbacks.onEnvelope(envelope);
      } catch {
        this.callbacks.onDiagnostic({
          level: "warn",
          source: "backend",
          message: redactLogMessage(`Invalid protocol JSON on stdout: ${json}`)
        });
      }
    };
    frameParser.onConsole = (line) => {
      if (line.trim()) {
        this.callbacks.onDiagnostic({
          level: "info",
          source: "backend-console",
          message: redactLogMessage(line)
        });
      }
    };
    proc.stdout.on("data", (chunk: Buffer) => frameParser.feed(chunk));

    this.stderrReader = createInterface({ input: proc.stderr });
    this.stderrReader.on("line", (line) => {
      if (line.trim()) {
        this.lastErrorLine = redactLogMessage(line.trim());
        this.callbacks.onDiagnostic({
          level: this.classifyBackendLineLevel(this.lastErrorLine),
          source: "backend",
          message: this.lastErrorLine
        });
      }
    });

    proc.on("exit", (code, signal) => {
      this.markDied(
        redactLogMessage(`Backend process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`)
      );
    });

    proc.on("error", (error) => {
      this.markDied(redactLogMessage(`Backend process spawn error: ${redactErrorMessage(error)}`));
    });

    proc.stdout.on("close", () => {
      this.markDied("Backend stdout stream closed unexpectedly");
    });

    proc.stdout.on("end", () => {
      this.markDied("Backend stdout stream ended unexpectedly");
    });
  }

  public async stop(): Promise<void> {
    const proc = this.process;
    if (!proc) {
      return;
    }

    if (this.stderrReader) {
      this.stderrReader.close();
      this.stderrReader = null;
    }

    const pid = proc.pid;
    const exited = new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve();
        return;
      }
      proc.once("exit", () => resolve());
    });
    this.stdinBroken = true;

    try {
      proc.stdin.end();
    } catch {
      // stdin already closed
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      proc.stdin?.destroy();
    } catch {
      // streams already closed
    }

    if (process.platform === "win32" && pid) {
      await new Promise<void>((resolve) => {
        const kill = spawn("cmd.exe", ["/c", `taskkill /f /t /pid ${pid}`], {
          stdio: "ignore",
          windowsHide: true
        });
        kill.on("close", () => resolve());
        kill.on("error", () => resolve());
        setTimeout(resolve, 2000);
      });
    } else if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // process already terminated
      }
    }

    const exitedInTime = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000))
    ]);
    if (!exitedInTime) {
      try {
        if (pid && process.platform !== "win32") process.kill(pid, "SIGKILL");
      } catch {
        // process already terminated
      }
      throw new Error(`Backend process ${pid ?? "unknown"} did not exit after termination`);
    }
    if (this.process === proc) this.process = null;
  }

  private markDied(message: string): void {
    const current = this.process;
    this.stdinBroken = true;
    this.lastErrorLine = message;
    this.callbacks.onDiagnostic({ level: "error", source: "transport", message });
    this.process = null;
    if (current?.pid) {
      try {
        if (process.platform === "win32") {
          spawn("cmd.exe", ["/c", `taskkill /f /t /pid ${current.pid}`], {
            stdio: "ignore",
            windowsHide: true
          });
        } else {
          process.kill(current.pid, "SIGTERM");
        }
      } catch {
        // process already terminated
      }
    }
    if (this.deadNotified) {
      return;
    }
    this.deadNotified = true;
    this.callbacks.onDied();
  }

  public sendEnvelope(envelope: BackendEnvelope): void {
    if (!this.process || !this.process.stdin.writable || this.stdinBroken) {
      throw new Error(
        this.lastErrorLine
          ? `Backend stdio process is not running: ${this.lastErrorLine}`
          : "Backend stdio process is not running"
      );
    }

    try {
      const body = Buffer.from(JSON.stringify(envelope), "utf8");
      this.process.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      this.process.stdin.write(body);
    } catch (error) {
      this.stdinBroken = true;
      const message = redactErrorMessage(error);
      this.lastErrorLine = redactLogMessage(`Backend stdin write failed: ${message}`);
      this.callbacks.onDiagnostic({ level: "error", source: "transport", message: this.lastErrorLine });
      throw new Error(this.lastErrorLine);
    }
  }

  protected classifyBackendLineLevel(line: string): "info" | "warn" | "error" {
    const normalized = line.toLowerCase();
    if (normalized.includes("[error]") || normalized.startsWith("error")) {
      return "error";
    }
    if (normalized.includes("[warn]") || normalized.includes("[warning]")) {
      return "warn";
    }
    // Java stacktrace / exception continuation lines (no log-level prefix)
    if (
      /^\s+at\s/.test(line) ||
      normalized.startsWith("caused by:") ||
      normalized.startsWith("suppressed:") ||
      /\s+\.{3}\s+\d+\s+more\s*$/.test(line) ||
      /^\S.*(Exception|Error)(:|$)/.test(line.trimStart())
    ) {
      return "error";
    }
    return "info";
  }
}
