import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const apiDir = resolve(__dirname, "..", "api");
const apiAlias = [
  { find: /^@queryeer\/api$/, replacement: resolve(apiDir, "src/index.ts") },
  { find: /^@queryeer\/api\/(.+)/, replacement: resolve(apiDir, "src/contracts/$1") }
];

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
        allow: [
          resolve(__dirname),
          resolve(__dirname, "..", ".."),
          resolve(__dirname, "..", "..", "..", "plugins")
        ]
      }
    },
    optimizeDeps: {
      exclude: ["monaco-editor"]
    },
    build: {
      outDir: "out/renderer"
    },
    plugins: [react()]
  }
});