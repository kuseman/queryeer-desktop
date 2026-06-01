import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { injectImportMapAndCspHash } from "./src/main/plugins/production-importmap.js";

const apiDir = resolve(__dirname, "..", "api");
const apiAlias = [
  { find: /^@queryeer\/api$/, replacement: resolve(apiDir, "src/index.ts") },
  { find: /^@queryeer\/api\/(.+)/, replacement: resolve(apiDir, "src/contracts/$1") }
];

const fsAllow = [
  resolve(__dirname),
  resolve(__dirname, "..", ".."),
  resolve(__dirname, "..", "..", "..", "plugins"),
  resolveDefaultManagedPluginsDir()
];

function resolveDefaultManagedPluginsDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "queryeer-desktop", "plugins");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "queryeer-desktop", "plugins");
  }
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "queryeer-desktop", "plugins");
}

const productionImportMapPlugin: Plugin = {
  name: "queryeer-production-importmap",
  apply: "build" as const,
  transformIndexHtml(html) {
    const { html: htmlWithScriptHash, importMapContent } = injectImportMapAndCspHash(html);

    return {
      html: htmlWithScriptHash,
      tags: [
        {
          tag: "script",
          attrs: {
            type: "importmap"
          },
          children: importMapContent,
          injectTo: "head-prepend" as const
        }
      ]
    };
  }
};

export default defineConfig({
  main: {
    resolve: {
      alias: apiAlias
    },
    build: {
      outDir: "out/main"
    }
  },
  preload: {
    resolve: {
      alias: apiAlias
    },
    build: {
      outDir: "out/preload",
      rollupOptions: {
        output: {
          format: "cjs"
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: apiAlias
    },
    server: {
      fs: {
        allow: fsAllow
      }
    },
    optimizeDeps: {
      exclude: ["monaco-editor"]
    },
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        preserveEntrySignatures: "strict",
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          "external-react": resolve(__dirname, "src/renderer/external-modules/react.js"),
          "external-react-jsx-runtime": resolve(__dirname, "src/renderer/external-modules/react-jsx-runtime.js"),
          "external-react-dom": resolve(__dirname, "src/renderer/external-modules/react-dom.js"),
          "external-react-dom-client": resolve(__dirname, "src/renderer/external-modules/react-dom-client.js")
        },
        output: {
          manualChunks(id: string) {
            if (id.includes("node_modules/react/index")) return "vendor-react";
            if (id.includes("node_modules/react/jsx-runtime")) return "vendor-react-jsx-runtime";
            if (id.includes("node_modules/react-dom/index")) return "vendor-react-dom";
            if (id.includes("node_modules/react-dom/client")) return "vendor-react-dom";
          },
          entryFileNames(chunkInfo) {
            if (chunkInfo.name.startsWith("external-")) {
              return "assets/[name].js";
            }
            return "assets/[name]-[hash].js";
          },
          chunkFileNames(chunkInfo) {
            if (chunkInfo.name.startsWith("vendor-")) {
              return "assets/[name].js";
            }
            return "assets/[name]-[hash].js";
          }
        }
      }
    },
    plugins: [productionImportMapPlugin, react()]
  }
});
