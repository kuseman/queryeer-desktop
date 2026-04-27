import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { BackendEnvelope } from "../../contracts/backend/index.js";
import type { BackendGatewayMode } from "../../contracts/backend/index.js";
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
      this.stdinBroken = true;
      this.lastErrorLine = redactLogMessage(
        `Backend process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`
      );
      this.callbacks.onDiagnostic({ level: "error", source: "transport", message: this.lastErrorLine });
      this.process = null;
      this.callbacks.onDied();
    });

    proc.on("error", (error) => {
      this.lastErrorLine = redactErrorMessage(error);
      this.callbacks.onDiagnostic({
        level: "error",
        source: "transport",
        message: redactLogMessage(`Backend process spawn error: ${error.message}`)
      });
      this.process = null;
      this.callbacks.onDied();
    });
  }

  public async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    if (this.stderrReader) {
      this.stderrReader.close();
      this.stderrReader = null;
    }

    const pid = this.process.pid;
    this.stdinBroken = true;

    try {
      this.process.stdin.end();
    } catch {
      // stdin already closed
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      this.process.stdout?.destroy();
      this.process.stderr?.destroy();
      this.process.stdin?.destroy();
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

    this.process = null;
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
    return "info";
  }
}
