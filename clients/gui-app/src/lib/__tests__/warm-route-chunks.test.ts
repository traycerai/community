import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeChunkWarmers } from "@/lib/warm-route-chunks";

const EPIC_MODULES = [
  "@/routes/epics-layout-route-components",
  "@/routes/epic-tab-route-components",
  "@/components/epic-tabs/epic-surface",
];

const DESKTOP_MODULES = [
  ...EPIC_MODULES,
  "@/routes/draft-route-components",
  "@/components/home-focus/home-focus-view",
  "@/components/home/landing-draft-surface",
  "@/providers/draft-surface-provider",
  "@/components/epics/history-surface",
  "@/components/settings/settings-surface",
  "@/components/sample-workspace/sample-workspace-surface",
];

// The surface modules read ONE named export from each of these, and a stub
// that exports nothing would leave the loaded value `undefined`, not a
// component. These names are what `stores/tabs/kinds/surface-modules.ts` reads.
const SURFACE_EXPORTS: Readonly<Partial<Record<string, string>>> = {
  "@/components/epic-tabs/epic-surface": "EpicSurface",
  "@/components/home-focus/home-focus-view": "HomeFocusView",
  "@/providers/draft-surface-provider": "DraftSurfaceProvider",
  "@/components/home/landing-draft-surface": "LandingDraftSurface",
  "@/components/epics/history-surface": "HistorySurface",
  "@/components/settings/settings-surface": "SettingsSurface",
  "@/components/sample-workspace/sample-workspace-surface":
    "SampleWorkspaceSurface",
};

function StubSurface(): null {
  return null;
}

// Every warmed module is replaced by a stub that records its own evaluation,
// so the assertions see what `warmRouteChunks` actually imported rather than
// what a list claims it would.
const imported = new Set<string>();

// Fresh module instances per test: `warmRouteChunks` runs once per module
// lifetime, and `isMobileApp()` must be read from the instance it imports.
// `doMock` rather than hoisted `mock`: a hoisted factory's module is cached
// across `resetModules`, so it would record only the first test's import.
async function loadWarmer(mobileApp: boolean) {
  vi.resetModules();
  for (const specifier of DESKTOP_MODULES) {
    vi.doMock(specifier, () => {
      imported.add(specifier);
      const exportName = SURFACE_EXPORTS[specifier];
      return exportName === undefined ? {} : { [exportName]: StubSurface };
    });
  }
  const mobile = await import("@/lib/mobile-app");
  mobile.setMobileApp(mobileApp);
  return import("@/lib/warm-route-chunks");
}

async function settleImports(): Promise<void> {
  await vi.dynamicImportSettled();
}

describe("warmRouteChunks", () => {
  beforeEach(() => {
    imported.clear();
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", (run: () => void) =>
      window.setTimeout(run, 0),
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    const mobile = await import("@/lib/mobile-app");
    mobile.setMobileApp(false);
  });

  it("warms every surface at idle on desktop, without waiting for a render", async () => {
    const { warmRouteChunks } = await loadWarmer(false);

    warmRouteChunks();
    await settleImports();
    expect([...imported]).toEqual([]);
    await vi.runAllTimersAsync();
    await settleImports();

    expect([...imported].toSorted()).toEqual([...DESKTOP_MODULES].toSorted());
  });

  it("has every surface module loaded after the desktop idle warm, so a tab kind opened later is drawn at once", async () => {
    const { warmRouteChunks } = await loadWarmer(false);
    // The SAME fresh module graph `loadWarmer` built.
    const surfaces = await import("@/stores/tabs/kinds/surface-modules");
    expect(surfaces.epicSurfaceModule.read()).toBeNull();

    warmRouteChunks();
    await vi.runAllTimersAsync();
    await settleImports();

    for (const module of [
      surfaces.epicSurfaceModule,
      surfaces.homeSurfaceModule,
      surfaces.historySurfaceModule,
      surfaces.settingsSurfaceModule,
      surfaces.sampleWorkspaceSurfaceModule,
    ]) {
      expect(module.read()).toBeTypeOf("function");
    }
    expect(surfaces.draftSurfaceModule.read()).toEqual({
      DraftSurfaceProvider: StubSurface,
      LandingDraftSurface: StubSurface,
    });
  });

  it("warms only the epic surface at idle on the phone, before the first render", async () => {
    const { warmRouteChunks } = await loadWarmer(true);
    const surfaces = await import("@/stores/tabs/kinds/surface-modules");

    warmRouteChunks();
    await settleImports();
    expect([...imported]).toEqual([]);
    await vi.runAllTimersAsync();
    await settleImports();
    expect([...imported].toSorted()).toEqual([...EPIC_MODULES].toSorted());

    warmRouteChunks();
    await vi.runAllTimersAsync();
    await settleImports();

    expect([...imported].toSorted()).toEqual([...EPIC_MODULES].toSorted());
    expect(imported).not.toContain("@/components/settings/settings-surface");
    expect(imported).not.toContain("@/components/epics/history-surface");
    // On the phone only the task surface's module is loaded.
    expect(surfaces.epicSurfaceModule.read()).toBeTypeOf("function");
    expect(surfaces.homeSurfaceModule.read()).toBeNull();
    expect(surfaces.draftSurfaceModule.read()).toBeNull();
    expect(surfaces.historySurfaceModule.read()).toBeNull();
    expect(surfaces.settingsSurfaceModule.read()).toBeNull();
    expect(surfaces.sampleWorkspaceSurfaceModule.read()).toBeNull();
  });

  it("warms only the epic list on the phone when a router was warmed before setMobileApp", async () => {
    // Mirrors boot: `router.tsx` builds and warms a module-level router
    // before the mobile entry calls `setMobileApp(true)`, and that router
    // never renders.
    const { warmRouteChunks } = await loadWarmer(false);
    const mobile = await import("@/lib/mobile-app");

    warmRouteChunks();
    mobile.setMobileApp(true);
    warmRouteChunks();

    await vi.runAllTimersAsync();
    await settleImports();
    // Even the never-rendered module-level router warms the phone list.
    expect([...imported].toSorted()).toEqual([...EPIC_MODULES].toSorted());

    warmRouteChunks();
    await vi.runAllTimersAsync();
    await settleImports();

    expect([...imported].toSorted()).toEqual([...EPIC_MODULES].toSorted());
  });
});

describe("routeChunkWarmers", () => {
  it("pins the exact phone warmer list, in order", () => {
    expect(routeChunkWarmers(true).map((warmer) => warmer.module)).toEqual([
      "@/routes/epics-layout-route-components",
      "@/routes/epic-tab-route-components",
      "@/components/epic-tabs/epic-surface",
    ]);
  });

  it("pins the exact desktop warmer list, in order", () => {
    expect(routeChunkWarmers(false).map((warmer) => warmer.module)).toEqual([
      "@/routes/epics-layout-route-components",
      "@/routes/epic-tab-route-components",
      "@/components/epic-tabs/epic-surface",
      "@/routes/draft-route-components",
      "@/components/home-focus/home-focus-view",
      "@/components/home/landing-draft-surface",
      "@/providers/draft-surface-provider",
      "@/components/epics/history-surface",
      "@/components/settings/settings-surface",
      "@/components/sample-workspace/sample-workspace-surface",
    ]);
  });
});
