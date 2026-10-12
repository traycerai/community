import { readdir } from "node:fs/promises";
import path from "node:path";

import { mergeConfig } from "vite";

import base from "./vitest.config.ts";
import { warmGate } from "./vite/browser-tests-warm-gate.ts";
import { sandboxAssets } from "./vite/sandbox-assets.ts";

/**
 * The Vite config the browser tests' shared dev server runs with
 * (`playwright.config.ts`, `webServer`). It is the app's own config - which
 * also compiles Tailwind for the fixture pages, see the note on
 * `tailwindcss()` there, and runs the React Compiler, so a fixture renders
 * the code the product ships - plus what a long-lived test server needs:
 *
 * - `optimizeDeps.entries` names the fixture pages. Vite's dependency scan
 *   skips `__tests__` directories by default, so without it every dependency
 *   was discovered in the middle of a page load, re-optimised, and the page
 *   reloaded under the test. That is why the old CDP drivers carried
 *   reload-tolerant waits and started Vite with `--force` every run.
 * - `warmGate()` holds the run until the server has transformed every
 *   fixture's module graph, so no test loads a page the server is still
 *   compiling (`vite/browser-tests-warm-gate.ts`). `playwright.config.ts`
 *   waits on the same path.
 * - `server.watch: null`: nothing edits files during a run, and a watcher
 *   reload in the middle of a test would take the page's injected helpers
 *   with it.
 * - `sandboxAssets()` serves the sandbox loader at `/sandbox/`, as the
 *   mobile app does, so a fixture can run a real sandboxed page or app.
 * - `cacheDir` is per server port, so two servers running at once (two
 *   worktrees, or `BROWSER_TESTS_PORT`) never rewrite one optimised-deps
 *   cache under each other.
 */
const port = process.env.BROWSER_TESTS_PORT ?? "4178";

const FIXTURES = "src/__tests__/browser";

/** Each fixture page is one `.html` whose script is the `.tsx` beside it. */
async function fixtureScripts(root: string): Promise<string[]> {
  const files = await readdir(path.join(root, FIXTURES));
  return files
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => `/${FIXTURES}/${file}`);
}

export default mergeConfig(base, {
  plugins: [
    sandboxAssets(),
    warmGate({ path: "/__browser-tests-warm", entries: fixtureScripts }),
  ],
  cacheDir: `node_modules/.vite/browser-tests-${port}`,
  optimizeDeps: { entries: [`${FIXTURES}/*.html`] },
  server: { watch: null },
});
