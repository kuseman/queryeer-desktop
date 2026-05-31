import { createHash } from "node:crypto";

export const PRODUCTION_PLUGIN_IMPORT_MAP = {
  imports: {
    react: "./assets/external-react.js",
    "react/jsx-runtime": "./assets/external-react-jsx-runtime.js",
    "react-dom": "./assets/external-react-dom.js",
    "react-dom/client": "./assets/external-react-dom-client.js"
  }
} as const;

export function injectImportMapAndCspHash(html: string): {
  html: string;
  importMapContent: string;
} {
  const importMapContent = JSON.stringify(PRODUCTION_PLUGIN_IMPORT_MAP);
  const importMapHash = createHash("sha256")
    .update(importMapContent)
    .digest("base64");

  return {
    html: html.replace(
      /script-src[^;]*;/,
      `script-src 'self' 'sha256-${importMapHash}';`
    ),
    importMapContent
  };
}
