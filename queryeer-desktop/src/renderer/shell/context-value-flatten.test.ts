import { describe, expect, it } from "vitest";
import { flattenContextObject } from "./context-value-flatten";

describe("flattenContextObject", () => {
  it("flattens nested object values into dotted context keys", () => {
    const flattened = flattenContextObject("meta", {
      core: {
        queryengine: {
          tabState: "running"
        }
      },
      retries: 2,
      enabled: true
    });

    expect(flattened["meta.core.queryengine.tabState"]).toBe("running");
    expect(flattened["meta.retries"]).toBe(2);
    expect(flattened["meta.enabled"]).toBe(true);
  });

  it("ignores non-primitive leaf values", () => {
    const flattened = flattenContextObject("meta", {
      list: ["a"],
      nested: {
        value: undefined
      }
    });

    expect(flattened["meta.list"]).toBeUndefined();
    expect(flattened["meta.nested.value"]).toBeUndefined();
  });
});
