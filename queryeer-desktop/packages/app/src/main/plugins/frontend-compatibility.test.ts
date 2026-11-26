import { describe, expect, it, vi } from "vitest";
import type { ExternalFrontendPluginManifest } from "@queryeer/api/plugin/ExternalFrontendPluginManifest";
import { checkFrontendCompatibility, frontendApiProblem } from "./frontend-compatibility";

function manifest(id: string, apiVersion?: string): ExternalFrontendPluginManifest {
  return { id, name: id, version: "1.0.0", modulePath: `/plugins/${id}/index.js`, sourcePath: `/plugins/${id}`, ...(apiVersion ? { apiVersion } : {}) };
}

describe("frontendApiProblem", () => {
  it("accepts a Queryeer in the range, and a plugin that declares none", () => {
    expect(frontendApiProblem(">=0.24.0 <1.0.0", "0.24.0")).toBeUndefined();
    expect(frontendApiProblem(undefined, "0.24.0")).toBeUndefined();
    expect(frontendApiProblem(" ", "0.24.0")).toBeUndefined();
  });

  it("says which Queryeer the plugin needs", () => {
    expect(frontendApiProblem(">=0.25.0 <1.0.0", "0.24.0")).toBe("Needs Queryeer >=0.25.0 <1.0.0, but this is 0.24.0");
  });

  it("refuses a range it can't read", () => {
    expect(frontendApiProblem("latest", "0.24.0")).toMatch(/^Cannot check frontend.apiVersion 'latest': /);
  });
});

describe("checkFrontendCompatibility", () => {
  it("marks the frontends that need another Queryeer, and leaves the others", () => {
    const result = checkFrontendCompatibility([manifest("ok", "^0.24.0"), manifest("newer", ">=0.25.0"), manifest("any")], "0.24.0", true);

    expect(result.map((entry) => [entry.id, entry.skipReason])).toEqual([
      ["ok", undefined],
      ["newer", "Needs Queryeer >=0.25.0, but this is 0.24.0"],
      ["any", undefined]
    ]);
  });

  it("only warns in a development build, which reports the last release's version", () => {
    const warn = vi.fn();

    const result = checkFrontendCompatibility([manifest("next", ">=0.24.0 <1.0.0")], "0.23.0", false, warn);

    expect(result[0].skipReason).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[plugins] next: Needs Queryeer >=0.24.0 <1.0.0, but this is 0.23.0; a development build doesn't enforce it");
  });
});
