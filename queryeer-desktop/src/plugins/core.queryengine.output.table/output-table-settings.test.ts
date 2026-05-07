import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCoreSettingsServiceMock: vi.fn(),
}));

vi.mock("../core.settings/service", () => ({
  getCoreSettingsService: mocks.getCoreSettingsServiceMock,
}));

import {
  DEFAULT_OUTPUT_TABLE_SETTINGS,
  coerceOutputTableSettings,
  resolveOutputTableSettings,
} from "./output-table-settings";

describe("output-table-settings", () => {
  it("returns defaults when settings service is unavailable", () => {
    mocks.getCoreSettingsServiceMock.mockReturnValue(null);

    expect(resolveOutputTableSettings()).toEqual(DEFAULT_OUTPUT_TABLE_SETTINGS);
  });

  it("coerces invalid values to defaults", () => {
    expect(
      coerceOutputTableSettings({
        viewMode: "nope",
        stackedMaxRows: "a lot",
      })
    ).toEqual(DEFAULT_OUTPUT_TABLE_SETTINGS);
  });

  it("reads and normalizes persisted settings", () => {
    mocks.getCoreSettingsServiceMock.mockReturnValue({
      getValue: (settingId: string) => {
        if (settingId.endsWith("viewMode")) return "stacked";
        if (settingId.endsWith("stackedMaxRows")) return 42.9;
        return undefined;
      },
    });

    expect(resolveOutputTableSettings()).toEqual({
      viewMode: "stacked",
      stackedMaxRows: 42,
    });
  });
});
