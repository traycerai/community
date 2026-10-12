import path from "path";
import os from "node:os";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { reactCompiler } from "./vite/react-compiler.ts";

const availableParallelism =
  typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;
const MAX_TEST_WORKERS = Math.min(
  2,
  Math.max(1, Math.floor(availableParallelism / 2)),
);

export default defineConfig({
  // Every module goes through the React Compiler, as in the renderer build
  // (`reactCompiler()` below is the same pass). A compiled component caches
  // what it reads at render, so a read of a registry, a clock or a store
  // without a subscription goes stale in compiled code only. A suite that runs
  // the source cannot see that class of bug at all, and it has shipped more
  // than once: the file tree's permanent spinner, a sign-in splash that never
  // left, a countdown frozen at its first value, a terminal that kept its
  // colours across a theme change.
  //
  // It also changes what a test may rely on. A compiled parent keeps a child
  // element whose inputs are equal, so `rerender()` does not reach a component
  // that reads a mock React cannot see: a mocked hook that a test changes
  // mid-flight has to be reactive (`useSyncExternalStore`), as the real hook is.
  plugins: [
    react(),
    // This config is ALSO what the browser regressions serve their fixtures
    // from - every driver in `scripts/*-browser.mjs` spawns vite with
    // `--config vitest.config.ts`. Without this plugin, `@import "tailwindcss"`
    // at `src/index.css:1` compiles to NOTHING (there is no `postcss.config.*`
    // here, so there is no second compile path), and the fixtures render with
    // the utility classes present on every element and no rules behind them:
    // `h-8` measured 24px, `DialogFooter`'s `flex` computed `display: block`,
    // `bg-primary` computed `rgba(0, 0, 0, 0)`.
    //
    // That is a harness that lies in the SAFE direction. A fixture asserting
    // two nodes share a left edge passes trivially when both are unstyled
    // blocks at the same content edge, and one asserting a control is "filled"
    // passes-as-transparent - on the fixed tree and the broken one alike. Any
    // geometric or colour claim measured without this was vacuous.
    //
    // jsdom runs are unaffected: vitest does not process CSS by default, so
    // this changes what the dev server serves, not what the suite transforms.
    tailwindcss(),
    reactCompiler(),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      {
        find: "@traycer-clients/shared",
        replacement: path.resolve(__dirname, "..", "shared"),
      },
      {
        find: /^@traycer\/protocol\/utils\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "..",
          "..",
          "protocol",
          "utils",
          "$1",
        ),
      },
      {
        find: /^@traycer\/protocol\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "..",
          "..",
          "protocol",
          "src",
          "$1",
        ),
      },
    ],
  },
  test: {
    // Vitest 5 flipped clearMocks to true; keep the v4 behavior (mock call history persists across tests).
    clearMocks: false,
    // Anchored to the package directory so siblings whose names merely
    // CONTAIN "zod" (`zod-to-json-schema`, `@hookform/resolvers/zod`) are
    // not dragged in. Full rationale for the workaround itself lives in
    // `clients/desktop/vitest.shared.ts`.
    server: { deps: { inline: [/[\\/]node_modules[\\/]zod[\\/]/] } },
    environment: "jsdom",
    setupFiles: ["./__tests__/test-browser-apis.ts"],
    include: [
      "__tests__/**/*.test.ts",
      "__tests__/**/*.test.tsx",
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
    ],
    globals: false,
    pool: "forks",
    // A few suites advance large fake-timer windows. Limiting concurrently
    // running files keeps those timers responsive on CI's shared runners.
    maxWorkers: MAX_TEST_WORKERS,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Don't let a stray post-teardown async error (a timer/socket/microtask
    // rejecting after a test finished) fail the whole run with exit 1 and no
    // failing test - the classic intermittent CI flake. The setup file
    // (`__tests__/test-browser-apis.ts`) still logs every such error, so we keep
    // visibility instead of silently swallowing it.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
