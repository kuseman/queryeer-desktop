import { describe, expect, it, vi } from "vitest";
import { ThemeService } from "./theme-service";

vi.mock("./theme-loader", () => ({
  discoverCustomThemes: vi.fn(async () => [])
}));

describe("ThemeService", () => {
  it("applies configured light theme to root", async () => {
    const values = new Map<string, unknown>([["core.themes.activeThemeId", "queryeer.light"]]);
    const subscribers = new Set<() => void>();

    const service = new ThemeService({
      getValue: (settingId) => values.get(settingId),
      subscribe: (listener) => {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      }
    });

    await service.initialize();

    expect(service.getActiveTheme().id).toBe("queryeer.light");
    expect(document.documentElement.getAttribute("data-theme-id")).toBe("queryeer.light");
    expect(document.documentElement.style.getPropertyValue("--bg-0").length).toBeGreaterThan(0);
    expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("light");
  });

  it("falls back to default dark theme when configured id does not exist", async () => {
    const service = new ThemeService({
      getValue: () => "custom.missing",
      subscribe: () => () => {}
    });

    await service.initialize();

    expect(service.getActiveTheme().id).toBe("queryeer.dark");
    expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("dark");
  });
});
