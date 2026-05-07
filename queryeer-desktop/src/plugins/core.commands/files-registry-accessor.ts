import type { FilesRegistry } from "../../contracts/files/FilesRegistry";

let instance: FilesRegistry | null = null;

export function setFilesRegistry(registry: FilesRegistry): void {
  instance = registry;
}

export function getFilesRegistry(): FilesRegistry | null {
  return instance;
}
