/**
 * The real tab kind modules' `descriptor.surface.render(tab)`, through to the
 * surface they draw.
 *
 * The seven surface modules are replaced by stubs behind gates this file
 * opens, so "the module has not landed" is decidable without a timer, and what
 * each kind hands its surface is read off the stub. Every case gets a FRESH
 * module graph (`vi.resetModules()` + dynamic imports): the surface modules
 * cache what they load for the life of their module instance, so a second
 * cold case in one graph would find them warm. `vi.doMock`, not a hoisted
 * `vi.mock`, because a hoisted factory's result survives `resetModules`.
 *
 * Fake timers are on throughout: a kind that waited on a timer to draw its
 * surface (the old `lazy()` waited about 300 ms) would show it here.
 */
import { Suspense, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DelayedRoutePendingScreen,
  ROUTE_PENDING_MS,
} from "@/components/loading/route-pending-screen";
import type * as TabSurfaceActivity from "@/components/layout/tab-surface-activity";
import type * as LandingDraftStore from "@/stores/home/landing-draft-store";
import type * as DraftKind from "@/stores/tabs/kinds/draft";
import type * as EpicKind from "@/stores/tabs/kinds/epic";
import type * as HistoryKind from "@/stores/tabs/kinds/history";
import type * as HomeKind from "@/stores/tabs/kinds/home";
import type * as SampleKind from "@/stores/tabs/kinds/sample-workspace";
import type * as SettingsKind from "@/stores/tabs/kinds/settings";
import type * as SurfaceModules from "@/stores/tabs/kinds/surface-modules";

const EPIC = "@/components/epic-tabs/epic-surface";
const HOME = "@/components/home-focus/home-focus-view";
const DRAFT_PROVIDER = "@/providers/draft-surface-provider";
const DRAFT_BODY = "@/components/home/landing-draft-surface";
const HISTORY = "@/components/epics/history-surface";
const SETTINGS = "@/components/settings/settings-surface";
const SAMPLE = "@/components/sample-workspace/sample-workspace-surface";

function StubEpicSurface(props: {
  readonly epicId: string;
  readonly tabId: string;
}): ReactNode {
  return (
    <div
      data-testid="stub-epic"
      data-epic-id={props.epicId}
      data-tab-id={props.tabId}
    />
  );
}

function StubHome(): ReactNode {
  return <div data-testid="stub-home" />;
}

function StubDraftProvider(props: {
  readonly draftId: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div data-testid="stub-draft-provider" data-draft-id={props.draftId}>
      {props.children}
    </div>
  );
}

function StubDraftBody(): ReactNode {
  return <div data-testid="stub-draft-body" />;
}

function StubHistory(): ReactNode {
  return <div data-testid="stub-history" />;
}

function StubSettings(props: { readonly lastPath: string }): ReactNode {
  return <div data-testid="stub-settings" data-last-path={props.lastPath} />;
}

function StubSample(props: { readonly tabId: string }): ReactNode {
  return <div data-testid="stub-sample" data-tab-id={props.tabId} />;
}

/** What each specifier's module exports, as the surface modules read it. */
const STUB_EXPORTS: Readonly<Record<string, Record<string, unknown>>> = {
  [EPIC]: { EpicSurface: StubEpicSurface },
  [HOME]: { HomeFocusView: StubHome },
  [DRAFT_PROVIDER]: { DraftSurfaceProvider: StubDraftProvider },
  [DRAFT_BODY]: { LandingDraftSurface: StubDraftBody },
  [HISTORY]: { HistorySurface: StubHistory },
  [SETTINGS]: { SettingsSurface: StubSettings },
  [SAMPLE]: { SampleWorkspaceSurface: StubSample },
};

interface SurfaceGates {
  readonly open: (specifier: string) => void;
  /** Whether anything has imported the module yet. */
  readonly requested: (specifier: string) => boolean;
}

/** Every surface module held behind its own gate until the test opens it. */
function holdSurfaceModules(): SurfaceGates {
  const openers = new Map<string, () => void>();
  const requested = new Set<string>();
  for (const [specifier, exports] of Object.entries(STUB_EXPORTS)) {
    const held = new Promise<void>((resolve) => {
      openers.set(specifier, resolve);
    });
    vi.doMock(specifier, async () => {
      requested.add(specifier);
      await held;
      return exports;
    });
  }
  return {
    open: (specifier) => {
      const opener = openers.get(specifier);
      if (opener === undefined) throw new Error(`no gate for ${specifier}`);
      opener();
    },
    requested: (specifier) => requested.has(specifier),
  };
}

interface Graph {
  readonly stubs: SurfaceGates;
  readonly surfaces: typeof SurfaceModules;
  readonly activity: typeof TabSurfaceActivity;
  readonly epic: typeof EpicKind;
  readonly home: typeof HomeKind;
  readonly draft: typeof DraftKind;
  readonly history: typeof HistoryKind;
  readonly settings: typeof SettingsKind;
  readonly sample: typeof SampleKind;
  readonly draftStore: typeof LandingDraftStore;
}

/** A fresh graph: the surface modules, the kinds and the activity provider. */
async function freshGraph(): Promise<Graph> {
  vi.resetModules();
  const stubs = holdSurfaceModules();
  const [surfaces, activity, epic, home, draft, history, settings, sample] =
    await Promise.all([
      import("@/stores/tabs/kinds/surface-modules"),
      import("@/components/layout/tab-surface-activity"),
      import("@/stores/tabs/kinds/epic"),
      import("@/stores/tabs/kinds/home"),
      import("@/stores/tabs/kinds/draft"),
      import("@/stores/tabs/kinds/history"),
      import("@/stores/tabs/kinds/settings"),
      import("@/stores/tabs/kinds/sample-workspace"),
    ]);
  const draftStore = await import("@/stores/home/landing-draft-store");
  return {
    stubs,
    surfaces,
    activity,
    epic,
    home,
    draft,
    history,
    settings,
    sample,
    draftStore,
  };
}

/** Runs `run` with React's act environment off, and puts it back after. */
async function outsideAct(run: () => Promise<void>): Promise<void> {
  const previous: unknown = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  try {
    await run();
  } finally {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previous);
  }
}

/**
 * The way `TopLevelSurfaceMount` mounts a surface, `Suspense` included: a kind
 * that goes back to `React.lazy` suspends into this boundary and is caught by
 * what it does there. The kinds this file reads suspend nothing.
 */
function mount(graph: Graph, element: ReactNode): void {
  const { TabSurfaceActivityProvider } = graph.activity;
  render(
    <TabSurfaceActivityProvider activity={{ visible: true, focused: true }}>
      <Suspense fallback={<DelayedRoutePendingScreen />}>{element}</Suspense>
    </TabSurfaceActivityProvider>,
  );
}

/** Every element added to the document body, so a one-frame flash is seen. */
function watchAdditions(): {
  readonly sawAdded: (testId: string) => boolean;
  readonly stop: () => void;
} {
  const collected: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => {
    collected.push(...batch);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const selectorFor = (testId: string): string => `[data-testid="${testId}"]`;
  return {
    sawAdded: (testId) =>
      [...collected, ...observer.takeRecords()].some((record) =>
        Array.from(record.addedNodes).some(
          (node) =>
            node instanceof Element &&
            (node.matches(selectorFor(testId)) ||
              node.querySelector(selectorFor(testId)) !== null),
        ),
      ),
    stop: () => observer.disconnect(),
  };
}

/**
 * Mounts a surface whose module is already loaded, and lets far more than the
 * pending delay pass. The pending screen shows after `ROUTE_PENDING_MS`, so a
 * kind that drew it even once would have it in the document by now: the
 * observer, started before the mount, says it never was.
 */
async function mountWarm(
  graph: Graph,
  element: ReactNode,
): Promise<{ readonly sawAdded: (testId: string) => boolean }> {
  const watch = watchAdditions();
  mount(graph, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ROUTE_PENDING_MS * 5);
  });
  watch.stop();
  return watch;
}

function draftTab(graph: Graph, draftId: string) {
  return graph.draft.draftTabModule.build({
    id: draftId,
    content: graph.draftStore.EMPTY_LANDING_DRAFT_CONTENT,
    selection: null,
    lastTouchedAt: 0,
    settings: null,
    composerMode: "chat",
    workspace: graph.draftStore.emptyLandingDraftWorkspaceSnapshot(),
    ...graph.draftStore.freshLandingMirrorState(),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const specifier of Object.keys(STUB_EXPORTS)) vi.doUnmock(specifier);
});

describe("the task kind's surface", () => {
  it("is pending while cold, then drawn with the tab's ids the moment its module lands, with no timer", async () => {
    const graph = await freshGraph();
    const tab = graph.epic.epicTabModule.build({
      view: { tabId: "tab-7", epicId: "epic-7", name: "Task" },
      hostId: null,
    });
    mount(graph, graph.epic.epicTabModule.descriptor.surface.render(tab));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_PENDING_MS);
    });
    expect(screen.getByTestId("route-pending-screen")).toBeTruthy();
    expect(screen.queryByTestId("stub-epic")).toBeNull();
    // The render asked for the module; nothing else in this test does.
    expect(graph.stubs.requested(EPIC)).toBe(true);

    // Inside `act` React flushes fallbacks at once, so only this outside-act
    // form tells this loader from `React.lazy`, which holds its content back.
    // The test never calls `load`: the import is the render's own. Microtasks
    // only: no timer is advanced past 0 ms.
    await outsideAct(async () => {
      graph.stubs.open(EPIC);
      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(0);
    });

    const surface = screen.getByTestId("stub-epic");
    expect(surface.getAttribute("data-epic-id")).toBe("epic-7");
    expect(surface.getAttribute("data-tab-id")).toBe("tab-7");
    expect(screen.queryByTestId("route-pending-screen")).toBeNull();
  });

  it("is in the first commit once its module is warm, and the pending screen is never added", async () => {
    const graph = await freshGraph();
    graph.stubs.open(EPIC);
    await graph.surfaces.epicSurfaceModule.load();
    const tab = graph.epic.epicTabModule.build({
      view: { tabId: "tab-8", epicId: "epic-8", name: "Task" },
      hostId: null,
    });

    const watch = await mountWarm(
      graph,
      graph.epic.epicTabModule.descriptor.surface.render(tab),
    );

    const surface = screen.getByTestId("stub-epic");
    expect(surface.getAttribute("data-epic-id")).toBe("epic-8");
    expect(surface.getAttribute("data-tab-id")).toBe("tab-8");
    expect(watch.sawAdded("stub-epic")).toBe(true);
    expect(watch.sawAdded("route-pending-screen")).toBe(false);
  });
});

describe("the draft kind's surface", () => {
  it("waits for BOTH of its modules, then draws the provider around the body with the draft's id", async () => {
    const graph = await freshGraph();
    const draftId = "draft-9";
    const tab = draftTab(graph, draftId);
    mount(graph, graph.draft.draftTabModule.descriptor.surface.render(tab));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_PENDING_MS);
    });
    expect(screen.getByTestId("route-pending-screen")).toBeTruthy();
    // The render asked for both of the draft's modules.
    expect(graph.stubs.requested(DRAFT_PROVIDER)).toBe(true);
    expect(graph.stubs.requested(DRAFT_BODY)).toBe(true);

    // One of the two has landed: still pending.
    await act(async () => {
      graph.stubs.open(DRAFT_PROVIDER);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("route-pending-screen")).toBeTruthy();
    expect(screen.queryByTestId("stub-draft-provider")).toBeNull();
    expect(screen.queryByTestId("stub-draft-body")).toBeNull();

    // Outside `act` for the same reason as the task kind's case above.
    await outsideAct(async () => {
      graph.stubs.open(DRAFT_BODY);
      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(0);
    });

    const provider = screen.getByTestId("stub-draft-provider");
    expect(provider.getAttribute("data-draft-id")).toBe(draftId);
    expect(provider.contains(screen.getByTestId("stub-draft-body"))).toBe(true);
    expect(screen.queryByTestId("route-pending-screen")).toBeNull();
  });

  it("is in the first commit once BOTH modules are warm: the provider and the body together, and the pending screen is never added", async () => {
    const graph = await freshGraph();
    const draftId = "draft-10";
    graph.stubs.open(DRAFT_PROVIDER);
    graph.stubs.open(DRAFT_BODY);
    await graph.surfaces.draftSurfaceModule.load();
    const tab = draftTab(graph, draftId);

    const watch = await mountWarm(
      graph,
      graph.draft.draftTabModule.descriptor.surface.render(tab),
    );

    const provider = screen.getByTestId("stub-draft-provider");
    expect(provider.getAttribute("data-draft-id")).toBe(draftId);
    expect(provider.contains(screen.getByTestId("stub-draft-body"))).toBe(true);
    expect(watch.sawAdded("stub-draft-provider")).toBe(true);
    expect(watch.sawAdded("stub-draft-body")).toBe(true);
    expect(watch.sawAdded("route-pending-screen")).toBe(false);
  });
});

describe("the other kinds' surfaces", () => {
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly specifier: string;
    readonly testId: string;
    /** What the kind must hand its surface, by attribute. */
    readonly attributes: (graph: Graph) => {
      readonly element: ReactNode;
      readonly expected: Readonly<Record<string, string>>;
    };
    readonly load: (graph: Graph) => Promise<void>;
  }> = [
    {
      name: "settings passes lastPath",
      specifier: SETTINGS,
      testId: "stub-settings",
      attributes: (graph) => {
        const tab = graph.settings.settingsTabModule.build({
          id: "settings",
          kind: "settings",
          name: "Settings",
          lastPath: "/settings/keybindings",
        });
        return {
          element:
            graph.settings.settingsTabModule.descriptor.surface.render(tab),
          expected: {
            "data-testid": "stub-settings",
            "data-last-path": tab.lastPath,
          },
        };
      },
      load: (graph) => graph.surfaces.settingsSurfaceModule.load(),
    },
    {
      name: "sample-workspace passes tabId",
      specifier: SAMPLE,
      testId: "stub-sample",
      attributes: (graph) => {
        const tab = graph.sample.sampleWorkspaceTabModule.build(null);
        return {
          element:
            graph.sample.sampleWorkspaceTabModule.descriptor.surface.render(
              tab,
            ),
          expected: { "data-testid": "stub-sample", "data-tab-id": tab.id },
        };
      },
      load: (graph) => graph.surfaces.sampleWorkspaceSurfaceModule.load(),
    },
    {
      name: "home draws with no props",
      specifier: HOME,
      testId: "stub-home",
      attributes: (graph) => {
        const tab = graph.home.homeTabModule.build(null);
        return {
          element: graph.home.homeTabModule.descriptor.surface.render(tab),
          expected: { "data-testid": "stub-home" },
        };
      },
      load: (graph) => graph.surfaces.homeSurfaceModule.load(),
    },
    {
      name: "history draws with no props",
      specifier: HISTORY,
      testId: "stub-history",
      attributes: (graph) => {
        const tab = graph.history.historyTabModule.build({
          id: "history",
          kind: "history",
          name: "History",
          lastPath: "/epics",
        });
        return {
          element:
            graph.history.historyTabModule.descriptor.surface.render(tab),
          expected: { "data-testid": "stub-history" },
        };
      },
      load: (graph) => graph.surfaces.historySurfaceModule.load(),
    },
  ];

  /** The element's attributes by name, to compare with what the kind owes it. */
  function attributesOf(element: HTMLElement): Record<string, string> {
    const actual: Record<string, string> = {};
    for (const name of element.getAttributeNames()) {
      actual[name] = element.getAttribute(name) ?? "";
    }
    return actual;
  }

  it.each(CASES)(
    "$name once its module lands, with no timer",
    async ({ specifier, testId, attributes }) => {
      const graph = await freshGraph();
      const { element, expected } = attributes(graph);
      mount(graph, element);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.queryByTestId(testId)).toBeNull();
      // The render asked for the module; nothing else in this test does.
      expect(graph.stubs.requested(specifier)).toBe(true);

      // Outside `act`, as in the task kind's case: inside it React flushes
      // fallbacks at once and `React.lazy` would pass too.
      await outsideAct(async () => {
        graph.stubs.open(specifier);
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(attributesOf(screen.getByTestId(testId))).toEqual(expected);
    },
  );

  it.each(CASES)(
    "$name in the first commit once its module is warm, and the pending screen is never added",
    async ({ specifier, testId, attributes, load }) => {
      const graph = await freshGraph();
      graph.stubs.open(specifier);
      await load(graph);
      const { element, expected } = attributes(graph);

      const watch = await mountWarm(graph, element);

      // The same attributes as the cold case above: a warm open and a cold
      // one hand the surface the same props.
      expect(attributesOf(screen.getByTestId(testId))).toEqual(expected);
      expect(watch.sawAdded(testId)).toBe(true);
      expect(watch.sawAdded("route-pending-screen")).toBe(false);
    },
  );
});
