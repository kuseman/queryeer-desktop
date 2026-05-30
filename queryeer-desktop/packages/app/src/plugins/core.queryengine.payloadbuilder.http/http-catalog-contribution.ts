import { registerPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";

const HTTP_CATALOG_ID = "http";

let registered = false;

export function registerPayloadbuilderHttpCatalogContribution(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerPayloadbuilderCatalogContribution({
    catalogId: HTTP_CATALOG_ID,
    title: "HTTP",
    defaultAlias: "http",
    allowMultiple: false
  });
}
