import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main"
    }
  },
  preload: {
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
    server: {
      fs: {
        allow: [
          resolve(__dirname),
          resolve(__dirname, "..", "plugins")
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