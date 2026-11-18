import { describe, expect, it, vi } from "vitest";
import { createSymbolActionRegistry, listSymbolActionTemplates, subscribeSymbolActionTemplates } from "./symbol-action-template-registry";
import { createJdbcTreeActionRegistry, listTreeActionTemplates, subscribeTreeActionTemplates } from "../core.queryengine.jdbc/tree-action-template-registry";
import {
  createWhenExpressionRegistry,
  getRegisteredWhenExpressionVariables
} from "../core.commands/when-expression-variable-registry";
import { getRegisteredWhenExpressionTemplates } from "../core.commands/when-expression-template-registry";

const uniqueId = (prefix: string) => `${prefix}.${Math.random().toString(16).slice(2)}`;

describe("context.symbolActions", () => {
  it("disposing removes the template and notifies, unless a later registration replaced it", () => {
    const registry = createSymbolActionRegistry();
    const listener = vi.fn();
    const unsubscribe = subscribeSymbolActionTemplates(listener);
    const id = uniqueId("test.symbol");
    const template = (query: string) => ({ id, title: id, action: { label: "Describe", when: "true", query } });

    const first = registry.registerTemplate(template("SELECT 1"));
    const second = registry.registerTemplate(template("SELECT 2"));
    first.dispose();
    expect(listSymbolActionTemplates().find((t) => t.id === id)?.action.query).toBe("SELECT 2");

    second.dispose();
    second.dispose();
    expect(listSymbolActionTemplates().map((t) => t.id)).not.toContain(id);
    // Two registrations and one removal; the replaced registration's dispose and the second dispose change nothing
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});

describe("context.jdbcTreeActions", () => {
  it("disposing removes the template and notifies, unless a later registration replaced it", () => {
    const registry = createJdbcTreeActionRegistry();
    const listener = vi.fn();
    const unsubscribe = subscribeTreeActionTemplates(listener);
    const id = uniqueId("test.tree");
    const template = (query: string) => ({
      id,
      title: id,
      action: { label: "Top 100", when: "true", query, mode: "execute" as const, outputTarget: "output" as const }
    });

    const first = registry.registerTemplate(template("SELECT 1"));
    const second = registry.registerTemplate(template("SELECT 2"));
    first.dispose();
    expect(listTreeActionTemplates().find((t) => t.id === id)?.action.query).toBe("SELECT 2");

    second.dispose();
    second.dispose();
    expect(listTreeActionTemplates().map((t) => t.id)).not.toContain(id);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});

describe("context.whenExpressions", () => {
  it("lists identical templates once and keeps them until every registration is disposed", () => {
    const registry = createWhenExpressionRegistry();
    const shared = { name: uniqueId("shared"), when: "true" };
    const own = { name: uniqueId("own"), when: "false" };
    const count = (name: string) => getRegisteredWhenExpressionTemplates().filter((t) => t.name === name).length;

    const pluginA = registry.registerTemplates([shared]);
    const pluginB = registry.registerTemplates([{ ...shared }, own]);
    expect(count(shared.name)).toBe(1);

    // Plugin A goes away first: B still registers the shared template
    pluginA.dispose();
    pluginA.dispose();
    expect(count(shared.name)).toBe(1);
    expect(count(own.name)).toBe(1);

    pluginB.dispose();
    expect(count(shared.name)).toBe(0);
    expect(count(own.name)).toBe(0);
  });

  it("lists variables with the same name once, with the first description, until every registration is disposed", () => {
    const registry = createWhenExpressionRegistry();
    const name = uniqueId("activeFile.metadata.test");
    const listed = () => getRegisteredWhenExpressionVariables().filter((v) => v.name === name);

    const pluginA = registry.registerVariables([{ name, type: "string", description: "first" }]);
    const pluginB = registry.registerVariables([{ name, type: "string", description: "second" }]);
    expect(listed().map((v) => v.description)).toEqual(["first"]);

    pluginB.dispose();
    pluginB.dispose();
    expect(listed()).toHaveLength(1);
    pluginA.dispose();
    expect(listed()).toHaveLength(0);
  });
});
