import { describe, expect, it } from "vitest";
import type { Plugin } from "@queryeer/api/plugin/Plugin";
import type { PluginManifest } from "@queryeer/api/plugin/PluginManifest";
import { planActivation } from "./PluginValidation";

function plugin(id: string, extra: Partial<PluginManifest> = {}): Plugin {
  return { manifest: { id, name: id, version: "1.0.0", kind: "feature", ...extra }, activate: () => {} };
}

const order = (plugins: Plugin[]) => planActivation(plugins).order.map((entry) => entry.manifest.id);

describe("planActivation", () => {
  it("orders by dependencies, in registration order otherwise", () => {
    expect(order([plugin("b", { dependencies: ["a"] }), plugin("a"), plugin("c")])).toEqual(["a", "c", "b"]);
  });

  it("skips a plugin with a missing required dependency, and the plugins that need it, without stopping the others", () => {
    const plan = planActivation([plugin("a", { dependencies: ["missing"] }), plugin("b", { dependencies: ["a"] }), plugin("c")]);

    expect(plan.order.map((entry) => entry.manifest.id)).toEqual(["c"]);
    expect(plan.skipped.get("a")).toBe("Missing dependency: missing");
    expect(plan.skipped.get("b")).toBe("Dependency a was skipped");
  });

  it("skips a plugin whose required capability no remaining plugin provides", () => {
    const plan = planActivation([
      plugin("provider", { dependencies: ["missing"], providesCapabilities: ["cap"] }),
      plugin("consumer", { requiredCapabilities: ["cap"] })
    ]);

    expect(plan.order).toEqual([]);
    expect(plan.skipped.get("consumer")).toBe("Requires missing capability 'cap'");
  });

  it("skips the plugins in a required dependency cycle, and only them", () => {
    const plan = planActivation([plugin("a", { dependencies: ["b"] }), plugin("b", { dependencies: ["a"] }), plugin("c")]);

    expect(plan.order.map((entry) => entry.manifest.id)).toEqual(["c"]);
    expect(plan.skipped.get("a")).toMatch(/^Dependency cycle: /);
    expect(plan.skipped.get("b")).toMatch(/^Dependency cycle: /);
  });

  it("treats an optional flag that isn't a boolean as an invalid entry", () => {
    const plan = planActivation([plugin("a", { dependencies: [{ id: "b", optional: "yes" as unknown as boolean }] }), plugin("b")]);

    expect(plan.skipped.get("a")).toMatch(/invalid dependency entry/);
  });

  it("skips a plugin with an invalid dependency entry", () => {
    const plan = planActivation([plugin("a", { dependencies: [{ id: "" }] }), plugin("b")]);

    expect(plan.skipped.get("a")).toMatch(/invalid dependency entry/);
    expect(plan.order.map((entry) => entry.manifest.id)).toEqual(["b"]);
  });

  it("uses an optional dependency that is there, and orders after it", () => {
    const plan = planActivation([plugin("mongo", { dependencies: [{ id: "pb", optional: true }] }), plugin("pb")]);

    expect(plan.order.map((entry) => entry.manifest.id)).toEqual(["pb", "mongo"]);
    expect([...(plan.dependencies.get("mongo") ?? [])]).toEqual(["pb"]);
    expect(plan.requiredDependencies.get("mongo")).toEqual([]);
  });

  it("activates a plugin whose optional dependency is missing or skipped, without it", () => {
    const plan = planActivation([
      plugin("mongo", { dependencies: [{ id: "pb", optional: true }, { id: "kafka", optional: true }] }),
      plugin("kafka", { dependencies: ["missing"] })
    ]);

    expect(plan.order.map((entry) => entry.manifest.id)).toEqual(["mongo"]);
    expect([...(plan.dependencies.get("mongo") ?? [])]).toEqual([]);
    expect(plan.skipped.has("mongo")).toBe(false);
  });

  it("drops an optional dependency that would close a cycle, keeping the required one", () => {
    const plan = planActivation([plugin("a", { dependencies: ["b"] }), plugin("b", { dependencies: [{ id: "a", optional: true }] })]);

    expect(plan.order.map((entry) => entry.manifest.id)).toEqual(["b", "a"]);
    expect(plan.warnings.get("b")).toEqual(["Optional dependency a not used: it would close a dependency cycle"]);
    expect([...(plan.dependencies.get("a") ?? [])]).toEqual(["b"]);
  });

  it("keeps optional dependencies that are not on a cycle", () => {
    // c -> a is optional but on no cycle; a <-> b is a cycle of optional edges
    const plan = planActivation([
      plugin("a", { dependencies: [{ id: "b", optional: true }] }),
      plugin("b", { dependencies: [{ id: "a", optional: true }] }),
      plugin("c", { dependencies: [{ id: "a", optional: true }] })
    ]);

    expect([...(plan.dependencies.get("c") ?? [])]).toEqual(["a"]);
    expect(plan.warnings.has("c")).toBe(false);
    expect(plan.order.map((entry) => entry.manifest.id)).toEqual(["a", "b", "c"]);
  });
});
