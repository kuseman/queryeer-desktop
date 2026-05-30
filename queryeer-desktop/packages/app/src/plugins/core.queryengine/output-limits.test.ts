import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OUTPUT_LIMITS } from "@queryeer/api/queryengine/OutputExtension";

const mocks = vi.hoisted(() => ({
  getCoreSettingsServiceMock: vi.fn(),
}));

vi.mock("../core.settings/service", () => ({
  getCoreSettingsService: mocks.getCoreSettingsServiceMock,
}));

import { coerceOutputMaxRows, resolveOutputMaxRows } from "./output-limits";

describe("output-limits", () => {
  it("returns default when settings service is unavailable", () => {
    mocks.getCoreSettingsServiceMock.mockReturnValue(null);

    expect(resolveOutputMaxRows()).toBe(DEFAULT_OUTPUT_LIMITS.maxRows);
  });

  it("normalizes configured max rows", () => {
    mocks.getCoreSettingsServiceMock.mockReturnValue({ getValue: () => 1234.9 });

    expect(resolveOutputMaxRows()).toBe(1234);
  });

  it("coerces invalid values", () => {
    expect(coerceOutputMaxRows("many")).toBe(DEFAULT_OUTPUT_LIMITS.maxRows);
    expect(coerceOutputMaxRows(0)).toBe(1);
    expect(coerceOutputMaxRows(-1)).toBe(-1);
    expect(coerceOutputMaxRows(-2)).toBe(1);
  });
});
