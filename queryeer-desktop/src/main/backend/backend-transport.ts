import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { BackendEnvelope } from "../../contracts/backend/index.js";
import { redactErrorMessage, redactLogMessage } from "./backend-log-redaction.js";
import { MockJavaBackend } from "./mock-java-backend.js";
import { FrameParser } from "./frame-parser.js";

export type BackendTransport = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  sendEnvelope: (envelope: BackendEnvelope) => void;
  readonly mode: "mock-stdio" | "stdio-process";
};

export type TransportDiagnostic = {
  level: "debug" | "info" | "warn" | "error";
  source: "transport" | "backend" | "backend-console";
  message: string;
};

export class MockBackendTransport implements BackendTransport {
  public readonly mode = "mock-stdio" as const;
  private readonly backend: MockJavaBackend;

  public constructor(onEnvelope: (envelope: BackendEnvelope) => void) {
    this.backend = new MockJavaBackend(onEnvelope);
  }

  public async start(): Promise<void> {}

  public async stop(): Promise<void> {}

  public sendEnvelope(envelope: BackendEnvelope): void {
    this.backend.onEnvelope(envelope);
  }
}

export class StdioProcessBackendTransport implements BackendTransport {
  public readonly mode = "stdio-process" as const;
  private readonly onEnvelope: (envelope: BackendEnvelope) => void;
  private readonly onDiagnostic: (event: TransportDiagnostic) => void;
  private process: ChildProcessWithoutNullStreams | null = null;
  private lastErrorLine: string | null = null;
  private stdinBroken = false;
  private dependenciesPrepared = false;
  private stderr: ReturnType<typeof createInterface> | null = null;

  public constructor(
    onEnvelope: (envelope: BackendEnvelope) => void,
    onDiagnostic: (event: TransportDiagnostic) => void
  ) {
    this.onEnvelope = onEnvelope;
    this.onDiagnostic = onDiagnostic;
  }

  public async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const repoRoot = join(process.cwd(), "..");
    const mvnwPath = join(repoRoot, process.platform === "win32" ? "mvnw.cmd" : "mvnw");

    if (!existsSync(mvnwPath)) {
      throw new Error(`Maven wrapper not found: ${mvnwPath}`);
    }

    await this.verifyJavaAvailable(repoRoot);

    if (!this.dependenciesPrepared) {
      await this.runMavenCommand(repoRoot, mvnwPath, [
        "-q",
        "-f",
        "queryeer-backend/pom.xml",
        "-pl",
        "backend-runner",
        "-am",
        "-DskipTests=true",
        "install"
      ]);
      this.dependenciesPrepared = true;
    }

    const args = [
      "-q",
      "-f",
      "queryeer-backend/backend-runner/pom.xml",
      "-Dexec.mainClass=com.queryeer.backend.runner.BackendRunnerApp",
      "exec:java"
    ];

    const debugArgs = "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=127.0.0.1:5005";
    const isDev = true; // TODO: fix

    // Construct your environment
    const spawnEnv = { 
      ...process.env, 
      MAVEN_OPTS: isDev ? debugArgs : "" 
    };

    this.process = process.platform === "win32"
      ? spawn(
          "cmd.exe",
          [
            "/d", "/s", "/c",
            `${mvnwPath} ${args.join(" ")}`
          ],
          {
            cwd: repoRoot,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: spawnEnv // Pass the env here
          }
        )
      : spawn(mvnwPath, args, {
          cwd: repoRoot,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: spawnEnv // And here
        });

    // this.process =
    //   process.platform === "win32"
    //     ? spawn(
    //         "cmd.exe",
    //         [
    //           "/d",
    //           "/s",
    //           "/c",
    //           `${mvnwPath} ${args.join(" ")}`
    //         ],
    //         {
    //           cwd: repoRoot,
    //           stdio: ["pipe", "pipe", "pipe"],
    //           windowsHide: true,
    //           env: {
    //             ...process.env,
    //             MAVEN_OPTS: debugArgs
    //           }
    //         }
    //       )
    //     : spawn(mvnwPath, args, {
    //         cwd: repoRoot,
    //         stdio: ["pipe", "pipe", "pipe"],
    //         windowsHide: true,
    //         env: {
    //           ...process.env,
    //           MAVEN_OPTS: debugArgs
    //         }
    //       });

    this.stdinBroken = false;
    // We consider the transport writable as soon as the process is spawned.
    // Handshake/ping in the gateway is the real readiness check.

    this.process.stdin.on("error", (error) => {
      this.stdinBroken = true;
      this.lastErrorLine = redactLogMessage(`Backend stdin error: ${error.message}`);
      this.onDiagnostic({
        level: "error",
        source: "transport",
        message: this.lastErrorLine
      });
    });

    const frameParser = new FrameParser();
    frameParser.onFrame = (json) => {
      try {
        const envelope = JSON.parse(json) as BackendEnvelope;
        this.onEnvelope(envelope);
      } catch {
        this.onDiagnostic({
          level: "warn",
          source: "backend",
          message: redactLogMessage(`Invalid protocol JSON on stdout: ${json}`)
        });
      }
    };
    frameParser.onConsole = (line) => {
      if (line.trim()) {
        this.onDiagnostic({
          level: "info",
          source: "backend-console",
          message: redactLogMessage(line)
        });
      }
    };
    this.process.stdout.on("data", (chunk: Buffer) => frameParser.feed(chunk));

    this.stderr = createInterface({ input: this.process.stderr });
    this.stderr.on("line", (line) => {
      if (line.trim()) {
        this.lastErrorLine = redactLogMessage(line.trim());
        this.onDiagnostic({
          level: this.classifyBackendLineLevel(this.lastErrorLine),
          source: "backend",
          message: this.lastErrorLine
        });
      }
    });

    this.process.on("exit", (code, signal) => {
      this.stdinBroken = true;
      this.lastErrorLine = redactLogMessage(
        `Backend process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`
      );
      this.onDiagnostic({
        level: "error",
        source: "transport",
        message: this.lastErrorLine
      });
      this.process = null;
    });

    this.process.on("error", (error) => {
      this.lastErrorLine = redactErrorMessage(error);
      this.onDiagnostic({
        level: "error",
        source: "transport",
        message: redactLogMessage(`Backend process spawn error: ${error.message}`)
      });
      this.process = null;
    });
  }

  private async verifyJavaAvailable(repoRoot: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const javaCheck =
        process.platform === "win32"
          ? spawn("cmd.exe", ["/d", "/s", "/c", "java -version"], {
              cwd: repoRoot,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true
            })
          : spawn("java", ["-version"], {
              cwd: repoRoot,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true
            });

      let javaErr = "";
      const stderr = createInterface({ input: javaCheck.stderr });
      stderr.on("line", (line) => {
        if (line.trim()) {
          javaErr = line.trim();
        }
      });

      javaCheck.on("error", (error) => {
        reject(new Error(`Could not start Java check: ${error.message}`));
      });

      javaCheck.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            javaErr
              ? `Java runtime not available for backend startup: ${javaErr}`
              : "Java runtime not available for backend startup. Ensure Java 17+ is on PATH or JAVA_HOME."
          )
        );
      });
    });
  }

  private async runMavenCommand(
    repoRoot: string,
    mvnwPath: string,
    args: string[]
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const prep =
        process.platform === "win32"
          ? spawn(
              "cmd.exe",
              [
                "/d",
                "/s",
                "/c",
                `${mvnwPath} ${args.join(" ")}`
              ],
              {
                cwd: repoRoot,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true
              }
            )
          : spawn(mvnwPath, args, {
              cwd: repoRoot,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true
            });

      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      prep.stdout.on("data", (chunk: Buffer) => outChunks.push(chunk));
      prep.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

      prep.on("error", (error) => {
        reject(error);
      });

      prep.on("close", (code) => {
        const combined = Buffer.concat([...outChunks, ...errChunks]).toString("utf8");
        const lines = combined
          .split("\n")
          .map((l) => l.replace(/\r$/, "").trim())
          .filter(Boolean)
          .map(redactLogMessage);

        for (const line of lines) {
          this.lastErrorLine = line;
          this.onDiagnostic({ level: this.classifyBackendLineLevel(line), source: "backend", message: line });
        }

        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            lines.length > 0
              ? `Maven preparation failed: ${lines.join(" | ")}`
              : `Maven preparation failed with exit code ${code ?? "null"}`
          )
        );
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    if (this.stderr) {
      this.stderr.close();
      this.stderr = null;
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
      this.onDiagnostic({
        level: "error",
        source: "transport",
        message: this.lastErrorLine
      });
      throw new Error(this.lastErrorLine);
    }
  }

  private classifyBackendLineLevel(line: string): "info" | "warn" | "error" {
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
