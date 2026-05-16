import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { delimiter, join } from "node:path";
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

  private static readonly builtinBackendModules = [
    "backend-runner",
    "backend-lib-queryengine-jdbc-foundation",
    "backend-lib-queryengine-sql-parser",
    "backend-plugin-jdbc",
    "backend-plugin-payloadbuilder",
    "backend-plugin-dialect-sqlserver"
  ];

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
        "-T", "1C",                     // Parallel build
        "-f", "queryeer-backend/pom.xml",
        "-pl", DevBackendTransport.builtinBackendModules.join(","),
        "-am",
        "-DskipTests=true",
        "-Dspotless.check.skip=true",
        "-DcheckstyleSkip=true",
        "-Dmaven.javadoc.skip=true",    // Don't build docs
        "-Dmaven.source.skip=true",     // Don't package source code
        "-Dbuild.cache.skip=false",     // Enable build cache if plugin is present        
        "install"
      ]);
      this.state.dependenciesPrepared = true;
    }

    const appDir = this.launchContext?.appDir ?? process.env.QUERYEER_APP_DIR;
    const debugArgs =
      process.env.QUERYEER_BACKEND_JDWP?.trim() ||
      //"-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:51050";  // Sticky listening port and suspend JVM until debug connect
      "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=0";
    const libNativeArg = appDir ? `-Djava.library.path=${join(appDir, "libNative")}` : null;
    const appDirArg = appDir ? `-Dqueryeer.app.dir=${appDir}` : null;
    const settingsDirPath = this.launchContext?.settingsDirPath ?? process.env.QUERYEER_SETTINGS_DIR;
    const settingsDirArg = settingsDirPath ? `-Dqueryeer.settings.dir=${settingsDirPath}` : null;
    const classpath = this.resolveRunnerClasspath(repoRoot);
    const args = [
      "--enable-native-access=ALL-UNNAMED",
      ...[debugArgs, libNativeArg, appDirArg, settingsDirArg].filter((arg): arg is string => Boolean(arg)),
      "-cp",
      classpath,
      "com.queryeer.backend.runner.BackendRunnerApp"
    ];
    const spawnEnv = {
      ...process.env,
      QUERYEER_APP_DIR: appDir,
      QUERYEER_SETTINGS_DIR: settingsDirPath
    };

    return spawn("java", args, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: spawnEnv
    });
  }

  private resolveRunnerClasspath(repoRoot: string): string {
    const runnerRoot = join(repoRoot, "queryeer-backend", "backend-runner");
    const runnerClasses = join(runnerRoot, "target", "classes");
    const classpathFile = join(runnerRoot, "target", "queryeer-runner-classpath.txt");
    if (!existsSync(runnerClasses)) {
      throw new Error(`Backend runner classes not found after Maven preparation: ${runnerClasses}`);
    }
    if (!existsSync(classpathFile)) {
      throw new Error(`Backend runner classpath file not found after Maven preparation: ${classpathFile}`);
    }
    const dependencyClasspath = readFileSync(classpathFile, "utf8").trim();
    return [runnerClasses, dependencyClasspath].filter(Boolean).join(delimiter);
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

        if (code === 0) {
          resolve();
          return;
        }

        for (const line of lines) {
          this.lastErrorLine = line;
          this.callbacks.onDiagnostic({
            level: this.classifyBackendLineLevel(line),
            source: "transport",
            message: line
          });
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
