import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const KINDS_DIR = resolve(__dirname, "../../stores/tabs/kinds");
const SURFACE_MODULES = resolve(KINDS_DIR, "surface-modules.ts");
const WARMER = resolve(__dirname, "../warm-route-chunks.ts");

/**
 * Every top-level surface is reached through `tabSurfaceDescriptor(kind).render()`,
 * which draws it from an on-demand module in `stores/tabs/kinds/surface-modules.ts`,
 * so no static import chain reaches these modules. If one is missing from
 * `warmRouteChunks()`, the first open of that tab kind pays a cold dynamic import
 * behind a pending screen - a blank pane for as long as the chunk takes, which is
 * a multi-second ESM transform waterfall in dev. That regression shipped once
 * already: the epic canvas graph moved out of `epic-tab-route-components` (which
 * was warmed) into `epic-surface` (which was not), and nothing failed.
 *
 * The modules used to be `lazy()` components. A `lazy()` shows its fallback first
 * even when its module is loaded, and React holds the content back about 300 ms
 * after it, so no kind may go back to one (see the last test).
 */
function surfaceSpecifiers(): ReadonlyArray<string> {
  const source = readFileSync(SURFACE_MODULES, "utf8");
  // Every `import("...")` in the one file that declares the surface modules.
  return [...source.matchAll(/import\(\s*"([^"]+)"/g)].map((match) => match[1]);
}

function surfaceModuleNames(): ReadonlyArray<string> {
  const source = readFileSync(SURFACE_MODULES, "utf8");
  return [...source.matchAll(/^export const (\w+Module)\b/gm)].map(
    (match) => match[1],
  );
}

describe("surface modules are warmed at startup", () => {
  it("finds the surface modules to check", () => {
    // Guards the extraction itself: if the declarations are refactored, every
    // assertion below would pass against an empty list.
    expect(surfaceSpecifiers()).toEqual(
      expect.arrayContaining([
        "@/components/epic-tabs/epic-surface",
        "@/components/home-focus/home-focus-view",
        "@/providers/draft-surface-provider",
        "@/components/home/landing-draft-surface",
        "@/components/epics/history-surface",
        "@/components/settings/settings-surface",
        "@/components/sample-workspace/sample-workspace-surface",
      ]),
    );
    expect(surfaceModuleNames()).toHaveLength(6);
  });

  it("warms every tab-kind surface module through its own loader", () => {
    const warmer = readFileSync(WARMER, "utf8");
    const missing = surfaceModuleNames().filter(
      (name) => !warmer.includes(`${name}.load()`),
    );
    expect(missing).toEqual([]);
  });

  it("keeps every tab kind off React.lazy", () => {
    // A kind that goes back to `lazy()` brings back its fallback-first wait,
    // and the 300 ms hold after it, on every first mount of that tab.
    const lazyUsers = readdirSync(KINDS_DIR)
      .filter((entry) => entry.endsWith(".tsx") || entry.endsWith(".ts"))
      .filter((file) => {
        // Comments here explain the history and name `lazy()`; only code counts.
        const code = readFileSync(resolve(KINDS_DIR, file), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        return /\blazy\(/.test(code);
      });
    expect(lazyUsers).toEqual([]);
  });
});
