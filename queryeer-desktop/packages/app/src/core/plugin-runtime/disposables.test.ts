import { describe, expect, it, vi } from "vitest";
import { disposeOnCleanup, pushDisposable, setDisposable, toDisposable } from "./disposables";

describe("disposables", () => {
  it("toDisposable runs its function once", () => {
    const dispose = vi.fn();
    const disposable = toDisposable(dispose);
    disposable.dispose();
    disposable.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("setDisposable removes the entry unless a later registration replaced it", () => {
    const map = new Map<string, { name: string }>();
    const first = setDisposable(map, "id", { name: "first" });
    const second = setDisposable(map, "id", { name: "second" });

    first.dispose();
    expect(map.get("id")?.name).toBe("second");
    second.dispose();
    expect(map.has("id")).toBe(false);

    const third = setDisposable(map, "id", { name: "third" });
    second.dispose();
    expect(map.get("id")?.name).toBe("third");
    third.dispose();
  });

  it("setDisposable treats the same object registered twice as two registrations", () => {
    const map = new Map<string, object>();
    const removed = vi.fn();
    const value = {};
    const first = setDisposable(map, "id", value, removed);
    const second = setDisposable(map, "id", value, removed);

    first.dispose();
    expect(map.get("id")).toBe(value);
    expect(removed).not.toHaveBeenCalled();
    second.dispose();
    expect(map.has("id")).toBe(false);
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it("setDisposable leaves a key alone that was since written directly", () => {
    const map = new Map<string, string>();
    const registration = setDisposable(map, "id", "registered");
    map.set("id", "direct");
    registration.dispose();
    expect(map.get("id")).toBe("direct");
  });

  it("pushDisposable removes only its own entry, also when the same value was added twice", () => {
    const handler = () => {};
    const list: (() => void)[] = [];
    const first = pushDisposable(list, handler);
    pushDisposable(list, handler);

    first.dispose();
    first.dispose();
    expect(list).toEqual([handler]);
  });

  it("disposeOnCleanup returns a cleanup function", () => {
    const dispose = vi.fn();
    disposeOnCleanup({ dispose })();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
