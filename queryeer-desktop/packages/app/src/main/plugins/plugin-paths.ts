import { join } from "node:path";

export function defaultPluginsDirPath(appDir: string): string {
  return join(appDir, "plugins");
}
