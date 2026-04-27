import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { StdioBackendTransportBase } from "./backend-transport-stdio-base.js";
import type { BackendTransportCallbacks } from "./backend-transport.js";

export class ProdBackendTransport extends StdioBackendTransportBase {
  public readonly mode = "prod-jar" as const;

  public constructor(callbacks: BackendTransportCallbacks) {
    super(callbacks);
  }

  protected async spawnBackendProcess(): Promise<ChildProcessWithoutNullStreams> {
    const jarPath = this.resolveJarPath();
    if (!existsSync(jarPath)) {
      throw new Error(`Backend JAR not found: ${jarPath}`);
    }

    return spawn("java", ["-jar", jarPath], {
      cwd: join(jarPath, ".."),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
  }

  private resolveJarPath(): string {
    if (process.env.QUERYEER_BACKEND_JAR) {
      return process.env.QUERYEER_BACKEND_JAR;
    }
    // In a packaged Electron app, process.resourcesPath points to the app's resources directory.
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
      return join(resourcesPath, "backend", "backend-runner.jar");
    }
    throw new Error(
      "Cannot locate backend JAR: set QUERYEER_BACKEND_JAR environment variable or run from a packaged app"
    );
  }
}
