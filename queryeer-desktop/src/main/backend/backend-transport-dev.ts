import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { redactLogMessage } from "./backend-log-redaction.js";
import { StdioBackendTransportBase } from "./backend-transport-stdio-base.js";
import type { BackendTransportCallbacks } from "./backend-transport.js";

export type DevTransportState = {
  dependenciesPrepared: boolean;
};

type BackendLaunchContext = {
  appDir: string;
  settingsDirPath: string;
};

export class DevBackendTransport extends StdioBackendTransportBase {
  public readonly mode = "dev-maven" as const;

  public constructor(
    callbacks: BackendTransportCallbacks,
    private readonly state: DevTransportState = { dependenciesPrepared: false },
    private readonly launchContext?: BackendLaunchContext
  ) {
    super(callbacks);
  }

  protected async spawnBackendProcess(): Promise<ChildProcessWithoutNullStreams> {
    const repoRoot = join(process.cwd(), "..");
    const mvnwPath = join(repoRoot, process.platform === "win32" ? "mvnw.cmd" : "mvnw");

    if (!existsSync(mvnwPath)) {
      throw new Error(`Maven wrapper not found: ${mvnwPath}`);
    }

    await this.verifyJavaAvailable(repoRoot);

    if (!this.state.dependenciesPrepared) {
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
      this.state.dependenciesPrepared = true;
    }

    const args = [
      "-e",
      "-f",
      "queryeer-backend/backend-runner/pom.xml",
      "-Dexec.mainClass=com.queryeer.backend.runner.BackendRunnerApp",
      "exec:java"
    ];

    const debugArgs =
      process.env.QUERYEER_BACKEND_JDWP?.trim() ||
      "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=0";
    const existingMavenOpts = process.env.MAVEN_OPTS?.trim();
    const spawnEnv = {
      ...process.env,
      MAVEN_OPTS: [existingMavenOpts, debugArgs].filter((value) => Boolean(value)).join(" ") || undefined,
      QUERYEER_APP_DIR: this.launchContext?.appDir ?? process.env.QUERYEER_APP_DIR,
      QUERYEER_SETTINGS_DIR:
        this.launchContext?.settingsDirPath ?? process.env.QUERYEER_SETTINGS_DIR
    };

    return process.platform === "win32"
      ? spawn(
          "cmd.exe",
          ["/d", "/s", "/c", `${mvnwPath} ${args.join(" ")}`],
          { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: spawnEnv }
        )
      : spawn(mvnwPath, args, {
          cwd: repoRoot,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: spawnEnv
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

  private async runMavenCommand(repoRoot: string, mvnwPath: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const prep =
        process.platform === "win32"
          ? spawn(
              "cmd.exe",
              ["/d", "/s", "/c", `${mvnwPath} ${args.join(" ")}`],
              { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
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
          this.callbacks.onDiagnostic({
            level: this.classifyBackendLineLevel(line),
            source: "backend",
            message: line
          });
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
}
