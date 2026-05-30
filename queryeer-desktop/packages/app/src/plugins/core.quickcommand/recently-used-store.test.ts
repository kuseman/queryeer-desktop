import { beforeEach, describe, expect, it } from "vitest";
import { RecentlyUsedStore } from "./recently-used-store";

beforeEach(() => {
  localStorage.clear();
});

describe("RecentlyUsedStore.record", () => {
  it("records an entry and makes it retrievable with a positive score", () => {
    const store = new RecentlyUsedStore();
    store.record("cmd.format");
    expect(store.getScore("cmd.format")).toBeGreaterThan(0);
  });

  it("returns 0 for an unknown id", () => {
    const store = new RecentlyUsedStore();
    expect(store.getScore("unknown.command")).toBe(0);
  });

  it("moves re-recorded id to front, giving it the highest score", () => {
    const store = new RecentlyUsedStore();
    store.record("cmd.a");
    store.record("cmd.b");
    store.record("cmd.a"); // re-record a — should go back to front

    expect(store.getScore("cmd.a")).toBeGreaterThan(store.getScore("cmd.b"));
  });

  it("persists entries across store instances (via localStorage)", () => {
    const store1 = new RecentlyUsedStore();
    store1.record("cmd.persist");

    const store2 = new RecentlyUsedStore();
    expect(store2.getScore("cmd.persist")).toBeGreaterThan(0);
  });

  it("keeps only the 50 most recent entries", () => {
    const store = new RecentlyUsedStore();
    for (let i = 0; i < 55; i++) {
      store.record(`cmd.${i}`);
    }
    // The first 5 recorded should have been evicted
    expect(store.getScore("cmd.0")).toBe(0);
    expect(store.getScore("cmd.1")).toBe(0);
    expect(store.getScore("cmd.2")).toBe(0);
    expect(store.getScore("cmd.3")).toBe(0);
    expect(store.getScore("cmd.4")).toBe(0);
    // The last recorded (cmd.54) should still be present
    expect(store.getScore("cmd.54")).toBeGreaterThan(0);
  });

  it("does not duplicate entries when recording the same id twice", () => {
    const store = new RecentlyUsedStore();
    store.record("cmd.dup");
    store.record("cmd.dup");

    const raw = localStorage.getItem("core.quickcommand.recentlyUsed") ?? "[]";
    const parsed = JSON.parse(raw) as { id: string }[];
    const count = parsed.filter((e) => e.id === "cmd.dup").length;
    expect(count).toBe(1);
  });
});

describe("RecentlyUsedStore.getScore", () => {
  it("gives more-recently-recorded entries higher scores", () => {
    const store = new RecentlyUsedStore();
    store.record("cmd.first");
    store.record("cmd.second");
    store.record("cmd.third");

    expect(store.getScore("cmd.third")).toBeGreaterThan(store.getScore("cmd.second"));
    expect(store.getScore("cmd.second")).toBeGreaterThan(store.getScore("cmd.first"));
  });
});
