/**
 * The API of Queryeer's payloadbuilder query engine for plugins: catalogs and their settings panels. A plugin reaches
 * the registry through its context (`context.payloadbuilderCatalog`).
 *
 * Since 0.24 the definitions are re-exported from `@queryeer/api`, where they still live. Import them from here: when
 * they move into this package, these imports stay the same.
 */
export type * from "@queryeer/api/queryengine/PayloadbuilderCatalogExtension";
export type { PayloadbuilderEngineState } from "@queryeer/api/backend";
