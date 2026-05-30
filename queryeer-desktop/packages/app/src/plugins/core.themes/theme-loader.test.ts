import { describe, expect, it } from "vitest";
import { discoverCustomThemes } from "./theme-loader";

describe("discoverCustomThemes", () => {
  it("loads valid theme manifests from appDir settings/themes", async () => {
    Object.defineProperty(window, "appShell", {
      value: {
        getAppDir: async () => "C:/Users/test/AppData/Roaming/queryeer",
        readDir: async () => ({
          success: true,
          items: [
            { name: "my-theme.json", isDirectory: false, isFile: true, size: 10, modified: "" },
            { name: "broken.json", isDirectory: false, isFile: true, size: 10, modified: "" }
          ]
        }),
        readFile: async (uri: string) => {
          if (uri.endsWith("my-theme.json")) {
            return {
              success: true,
              content: JSON.stringify({
                id: "custom.theme",
                name: "Custom Theme",
                mode: "light",
                tokens: {
                  "--bg-0": "#fff"
                }
              })
            };
          }
          return { success: true, content: "{ broken" };
        }
      },
      configurable: true
    });

    const themes = await discoverCustomThemes();
    expect(themes).toHaveLength(1);
    expect(themes[0].id).toBe("custom.theme");
  });
});
