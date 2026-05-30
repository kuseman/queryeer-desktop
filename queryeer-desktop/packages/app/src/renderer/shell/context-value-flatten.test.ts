import { describe, expect, it } from "vitest";
import { inflateDottedKeys } from "./context-value-flatten";

describe("inflateDottedKeys", () => {
  it("inflates dotted key values into nested object paths", () => {
    const inflated = inflateDottedKeys({
      "meta.core.queryengine.tabState": "running",
      "meta.retries": 2,
      "meta.enabled": true
    });

    expect((inflated.meta as Record<string, unknown>).retries).toBe(2);
    expect((inflated.meta as Record<string, unknown>).enabled).toBe(true);
    expect((((inflated.meta as Record<string, unknown>).core as Record<string, unknown>).queryengine as Record<string, unknown>).tabState).toBe("running");
  });

  it("preserves simple keys alongside dotted keys", () => {
    const inflated = inflateDottedKeys({
      hasActiveFile: true,
      "activeFile.mimeType": "application/sql"
    });

    expect(inflated.hasActiveFile).toBe(true);
    expect((inflated.activeFile as Record<string, unknown>).mimeType).toBe("application/sql");
  });
});
