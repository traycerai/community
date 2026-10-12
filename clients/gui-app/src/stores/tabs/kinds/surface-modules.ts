import { preloadedModule } from "@/lib/preloaded-module";

/**
 * The top-level tab surfaces, each imported on demand.
 *
 * They were `React.lazy` components. That kept them out of the entry chunk,
 * and it also put a wait in front of the first open of each kind in a window,
 * warmed or not: a `lazy()` shows its fallback first even when its module is
 * already loaded, and React holds the content back until about 300 ms after
 * that fallback (see `lib/preloaded-module.ts`). The Settings tab, opened
 * after the idle warm-up, took 259 ms to its content the first time and
 * 71 ms the next, with the pending screen on screen in between some of the
 * time.
 *
 * A surface read from here is drawn in the render that finds it loaded, and
 * in the render the import lands in when it was not. `warmRouteChunks` calls
 * these same `load`s at idle, so a tab kind opened later is drawn at once.
 *
 * One file, not one loader per kind module: `lib/warm-route-chunks.ts` reads
 * them too, and it must not import the kind modules for it.
 * `surface-modules-are-warmed.test.ts` keeps the two in step.
 */
export const epicSurfaceModule = preloadedModule(() =>
  import("@/components/epic-tabs/epic-surface").then(
    (module) => module.EpicSurface,
  ),
);

export const homeSurfaceModule = preloadedModule(() =>
  import("@/components/home-focus/home-focus-view").then(
    (module) => module.HomeFocusView,
  ),
);

/**
 * The draft surface is two modules, a provider around a body. They are one
 * entry here because neither is drawn without the other: the provider alone
 * would start a draft's session work behind a pending screen.
 */
export const draftSurfaceModule = preloadedModule(() =>
  Promise.all([
    import("@/providers/draft-surface-provider"),
    import("@/components/home/landing-draft-surface"),
  ]).then(([provider, surface]) => ({
    DraftSurfaceProvider: provider.DraftSurfaceProvider,
    LandingDraftSurface: surface.LandingDraftSurface,
  })),
);

export const historySurfaceModule = preloadedModule(() =>
  import("@/components/epics/history-surface").then(
    (module) => module.HistorySurface,
  ),
);

export const settingsSurfaceModule = preloadedModule(() =>
  import("@/components/settings/settings-surface").then(
    (module) => module.SettingsSurface,
  ),
);

export const sampleWorkspaceSurfaceModule = preloadedModule(() =>
  import("@/components/sample-workspace/sample-workspace-surface").then(
    (module) => module.SampleWorkspaceSurface,
  ),
);
