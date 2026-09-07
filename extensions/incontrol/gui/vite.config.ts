import react from "@vitejs/plugin-react-swc";
import { resolve } from "path";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: true,

    // Change the output .js filename to not include a hash
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        indexConsole: resolve(__dirname, "indexConsole.html"),
      },
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },
  server: {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["*", "Content-Type", "Authorization"],
      credentials: true,
    },
  },
  test: {
    globals: true,
    // Fluent pulls in `tabster`, which is published as CommonJS. Vitest leaves
    // node_modules external, and Node's ESM interop cannot pick up tabster's
    // named exports, so every suite that reaches the app module graph used to
    // fail during collection. Inlining lets Vite transform it instead.
    server: {
      deps: {
        // 匹配 id 里的包名即可（Windows 路径分隔符不一致，用子串最稳）
        inline: [
          "tabster",
          "@fluentui",
          "@griffel",
        ],
      },
    },
    environment: "jsdom",
    setupFiles: "./src/util/test/setupTests.ts",
    onConsoleLog(log, type) {
      if (type === "stderr") {
        if (
          [
            "contentEditable",
            "An update to Chat inside a test was not wrapped in act",
            "An update to TipTapEditor inside a test was not wrapped in act",
            "An update to ThinkingIndicator inside a test was not wrapped in act",
            "The current testing environment is not configured to support act",
            "target.getClientRects is not a function",
            "prosemirror",
          ].some((text) => log.includes(text))
        ) {
          return false;
        }
      }
      return true;
    },
    onUnhandledRejection(err) {
      // Suppress ProseMirror DOM errors in test environment
      if (
        err.message?.includes("getClientRects") ||
        err.message?.includes("prosemirror")
      ) {
        return false;
      }
      return true;
    },
  },
});
