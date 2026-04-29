import { registerPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";

const FILESYSTEM_CATALOG_ID = "filesystem";

let registered = false;

export function registerPayloadbuilderFilesystemCatalogContribution(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerPayloadbuilderCatalogContribution({
    catalogId: FILESYSTEM_CATALOG_ID,
    title: "Filesystem",
    defaultAlias: "fs",
    allowMultiple: false
  });
}
