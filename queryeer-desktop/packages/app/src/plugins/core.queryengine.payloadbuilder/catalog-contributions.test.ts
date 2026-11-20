import { afterEach, describe, expect, it } from "vitest";
import type { Disposable } from "@queryeer/api/editor/EditorApi";
import {
  createPayloadbuilderCatalogRegistry,
  getPayloadbuilderCatalogContribution,
  listPayloadbuilderCatalogContributions,
  registerPayloadbuilderCatalogContribution,
  subscribePayloadbuilderCatalogContributions,
  type PayloadbuilderCatalogContribution
} from "./catalog-contributions";

const catalog = (catalogId: string, title: string): PayloadbuilderCatalogContribution => ({
  catalogId,
  title,
  defaultAlias: catalogId,
  allowMultiple: true
});

describe("payloadbuilder catalog contributions", () => {
  const registrations: Disposable[] = [];
  afterEach(() => {
    registrations.splice(0).reverse().forEach((registration) => registration.dispose());
  });

  it("lets a plugin's catalog replace a built-in one until it is disposed", () => {
    const builtin = catalog("test.mongodb", "Built-in");
    const fromPlugin = catalog("test.mongodb", "Plugin");
    registrations.push(registerPayloadbuilderCatalogContribution(builtin));
    const pluginRegistration = createPayloadbuilderCatalogRegistry().registerContribution(fromPlugin);
    registrations.push(pluginRegistration);

    expect(getPayloadbuilderCatalogContribution("test.mongodb")).toBe(fromPlugin);
    expect(listPayloadbuilderCatalogContributions().filter((entry) => entry.catalogId === "test.mongodb")).toEqual([fromPlugin]);

    pluginRegistration.dispose();

    expect(getPayloadbuilderCatalogContribution("test.mongodb")).toBe(builtin);
  });

  it("keeps the plugin's catalog when the built-in registers after it", () => {
    const fromPlugin = catalog("test.kafka", "Plugin");
    registrations.push(createPayloadbuilderCatalogRegistry().registerContribution(fromPlugin));
    registrations.push(registerPayloadbuilderCatalogContribution(catalog("test.kafka", "Built-in")));

    expect(getPayloadbuilderCatalogContribution("test.kafka")).toBe(fromPlugin);
  });

  it("refuses a second plugin catalog with the same id", () => {
    const registry = createPayloadbuilderCatalogRegistry();
    registrations.push(registry.registerContribution(catalog("test.es", "First")));

    expect(() => registry.registerContribution(catalog("test.es", "Second"))).toThrow(
      "Payloadbuilder catalog 'test.es' is already registered by another plugin"
    );
  });

  it("matches ids ignoring case, like the backend", () => {
    registrations.push(registerPayloadbuilderCatalogContribution(catalog("test.case", "Built-in")));
    const registry = createPayloadbuilderCatalogRegistry();

    expect(() => registry.registerContribution(catalog("Test.Case", "Plugin"))).toThrow(
      "Payloadbuilder catalog 'Test.Case' must use the built-in catalog's id 'test.case' to replace it"
    );
    registrations.push(registry.registerContribution(catalog("test.case", "Plugin")));
    expect(() => registry.registerContribution(catalog("TEST.CASE", "Other plugin"))).toThrow("already registered by another plugin");
  });

  it("notifies listeners when a plugin's catalog comes and goes", () => {
    let notified = 0;
    const unsubscribe = subscribePayloadbuilderCatalogContributions(() => {
      notified++;
    });
    const registration = createPayloadbuilderCatalogRegistry().registerContribution(catalog("test.http", "Plugin"));
    registration.dispose();
    unsubscribe();

    expect(notified).toBe(2);
  });
});
