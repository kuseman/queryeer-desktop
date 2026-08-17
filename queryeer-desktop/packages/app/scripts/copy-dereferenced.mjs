import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync
} from "node:fs";
import { join } from "node:path";

export function copyDereferenced(source, destination, ancestors = new Set()) {
  const sourcePath = realpathSync(source);
  const stats = lstatSync(sourcePath);

  if (stats.isDirectory()) {
    if (ancestors.has(sourcePath)) {
      throw new Error(`Cannot copy cyclic symbolic link: ${source}`);
    }

    mkdirSync(destination, { recursive: true });
    chmodSync(destination, stats.mode);
    const nextAncestors = new Set(ancestors).add(sourcePath);
    for (const entry of readdirSync(sourcePath)) {
      copyDereferenced(join(sourcePath, entry), join(destination, entry), nextAncestors);
    }
    return;
  }

  copyFileSync(sourcePath, destination);
  chmodSync(destination, stats.mode);
}
