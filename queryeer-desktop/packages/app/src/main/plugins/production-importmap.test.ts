import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  injectImportMapAndCspHash,
  PRODUCTION_PLUGIN_IMPORT_MAP
} from "./production-importmap.js";

describe("production import map harness", () => {
  it("injects CSP hash that matches generated import map content", () => {
    const htmlPath = resolve(__dirname, "../../renderer/index.html");
    const html = readFileSync(htmlPath, "utf8");

    const { html: transformedHtml, importMapContent } = injectImportMapAndCspHash(html);

    expect(importMapContent).toBe(JSON.stringify(PRODUCTION_PLUGIN_IMPORT_MAP));
    expect(transformedHtml).toContain("script-src 'self' 'sha256-");
    expect(transformedHtml).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("defines required external module bridges", () => {
    expect(PRODUCTION_PLUGIN_IMPORT_MAP.imports.react).toBe("./assets/external-react.js");
    expect(PRODUCTION_PLUGIN_IMPORT_MAP.imports["react/jsx-runtime"]).toBe(
      "./assets/external-react-jsx-runtime.js"
    );
    expect(PRODUCTION_PLUGIN_IMPORT_MAP.imports["react-dom"]).toBe("./assets/external-react-dom.js");
    expect(PRODUCTION_PLUGIN_IMPORT_MAP.imports["react-dom/client"]).toBe(
      "./assets/external-react-dom-client.js"
    );
  });
});
