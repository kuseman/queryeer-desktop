import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { StdioBackendTransportBase } from "./backend-transport-stdio-base.js";
import type { BackendTransportCallbacks } from "./backend-transport.js";
import { resolveBackendJvmArgs } from "./backend-jvm-options.js";

type BackendLaunchContext = {
  appDir?: string;
  settingsDirPath: string;
  pluginsDirPath?: string;
  pluginsSafeMode?: boolean;
};

export type ProdBackendLaunchPaths = {
  appDir: string | undefined;
  resourcesDir: string | undefined;
  javaBin: string;
  classpath: string;
  workingDir: string;
};

export function resolveProdBackendLaunchPaths(resourcesPath?: string): ProdBackendLaunchPaths {
  const appDir = process.env.QUERYEER_APP_DIR;
  const resourcesDir = process.env.QUERYEER_RESOURCES_DIR || resourcesPath;
  const backendDir = process.env.QUERYEER_BACKEND_DIR || (resourcesDir ? join(resourcesDir, "backend") : undefined);
  const backendJar = process.env.QUERYEER_BACKEND_JAR || (backendDir ? join(backendDir, "backend-runner.jar") : undefined);
  if (!backendDir || !backendJar) {
    throw new Error(
      "Cannot locate backend: set QUERYEER_BACKEND_DIR/QUERYEER_BACKEND_JAR or run from a packaged app"
    );
  }

  const runtimeJava = join(backendDir, "runtime", "bin", process.platform === "win32" ? "java.exe" : "java");
  const javaBin = process.env.QUERYEER_JAVA_BIN || (existsSync(runtimeJava) ? runtimeJava : "java");
  return {
    appDir,
    resourcesDir,
    javaBin,
    classpath: [backendJar, join(backendDir, "lib", "*")].join(delimiter),
    workingDir: backendDir
  };
}

export class ProdBackendTransport extends StdioBackendTransportBase {
  public readonly mode = "prod-jar" as const;

  public constructor(
    callbacks: BackendTransportCallbacks,
    private readonly launchContext?: BackendLaunchContext
  ) {
    super(callbacks);
  }

  protected async spawnBackendProcess(): Promise<ChildProcessWithoutNullStreams> {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const launchPaths = resolveProdBackendLaunchPaths(resourcesPath);
    const runnerJar = launchPaths.classpath.split(delimiter)[0];
    if (!existsSync(runnerJar)) {
      throw new Error(`Backend runner JAR not found: ${runnerJar}`);
    }
    if (launchPaths.javaBin !== "java" && !existsSync(launchPaths.javaBin)) {
      throw new Error(`Bundled Java runtime not found: ${launchPaths.javaBin}`);
    }

    const appDir = this.launchContext?.appDir ?? launchPaths.appDir;
    const resourcesDir = launchPaths.resourcesDir;
    const jvmArgs: string[] = [];
    if (appDir) {
      jvmArgs.push(`-Djava.library.path=${join(appDir, "libNative")}`);
      jvmArgs.push(`-Dqueryeer.app.dir=${appDir}`);
    }
    if (resourcesDir) {
      jvmArgs.push(`-Dqueryeer.resources.dir=${resourcesDir}`);
    }
    const settingsDirPath = this.launchContext?.settingsDirPath ?? process.env.QUERYEER_SETTINGS_DIR;
    if (settingsDirPath) {
      jvmArgs.push(`-Dqueryeer.settings.dir=${settingsDirPath}`);
    }
    if (this.launchContext?.pluginsDirPath) {
      jvmArgs.push(`-Dqueryeer.plugins.dir=${this.launchContext.pluginsDirPath}`);
    }
    if (this.launchContext?.pluginsSafeMode) {
      jvmArgs.push("-Dqueryeer.plugins.safeMode=true");
    }
    jvmArgs.push(...await resolveBackendJvmArgs(settingsDirPath));
    jvmArgs.push(
      "--enable-native-access=ALL-UNNAMED",
      "-cp",
      launchPaths.classpath,
      "com.queryeer.backend.runner.BackendRunnerApp"
    );

    return spawn(launchPaths.javaBin, jvmArgs, {
      cwd: launchPaths.workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        QUERYEER_APP_DIR: appDir,
        QUERYEER_RESOURCES_DIR: resourcesDir,
        QUERYEER_SETTINGS_DIR:
          settingsDirPath
      }
    });
  }
}
