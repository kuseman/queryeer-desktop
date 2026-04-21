import { watch as chokidarWatch } from "chokidar";
import type { WatcherFactory } from "./file-watcher-service";

export const chokidarWatcherFactory: WatcherFactory = ({
  path,
  recursive,
  onAdd,
  onModify,
  onDelete,
  onError
}) => {
  const watcher = chokidarWatch(path, {
    persistent: false,
    ignoreInitial: true,
    followSymlinks: false,
    depth: recursive ? undefined : 0,
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 20
    }
  });

  watcher.on("add", (absolutePath) => onAdd(absolutePath));
  watcher.on("change", (absolutePath) => onModify(absolutePath));
  watcher.on("unlink", (absolutePath) => onDelete(absolutePath));
  watcher.on("error", (error) => {
    onError(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    close: () => watcher.close()
  };
};
