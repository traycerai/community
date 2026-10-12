/**
 * The first open of a top-level tab kind, through the REAL `TopLevelTabHost`.
 *
 * A tab kind draws its surface from an on-demand module
 * (`stores/tabs/kinds/surface-modules.ts`). What the user sees on the first
 * open of a kind is decided here:
 * - warmed (the module has loaded, as the idle warm-up leaves it): the
 *   surface is in the commit the tab becomes visible in, the pending screen is
 *   never added to the document, the tab's deep link reaches the surface, and
 *   the surface takes focus as it mounts;
 * - cold (the module is held back): nothing for `ROUTE_PENDING_MS`, then the
 *   pending screen, and when the module lands the content replaces it with
 *   focus on the surface and nowhere else in between;
 * - cold and hidden: a tab that leaves the screen while its module loads
 *   shows no pending screen, and draws its content when it lands.
 *
 * Every case gets a FRESH module graph (`vi.resetModules()` + dynamic
 * imports), because a surface module caches what it loads for the life of its
 * module instance: a second cold open in one graph would find it warm. The
 * surfaces are small stubs behind gates this file opens, so no real surface's
 * transform time is paid and "the module has not landed" is decidable without
 * a timer. `vi.doMock`, not a hoisted `vi.mock`, because a hoisted factory's
 * result survives `resetModules`.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTE_PENDING_MS } from "@/components/loading/route-pending-screen";
// The host's module graph is large and the first import in a worker transforms
// all of it. Imported here so that happens while the file is collected: each
// case below then only evaluates the graph again, and a case's wait is its
// gate, never the transform. No hook or test time limit is raised.
import "@/components/layout/top-level-tab-host";
import type * as TopLevelTabHostModule from "@/components/layout/top-level-tab-host";
import type * as EpicCanvasStore from "@/stores/epics/canvas/store";
import type * as SurfaceModules from "@/stores/tabs/kinds/surface-modules";
import type * as SurfaceDemand from "@/stores/tabs/surface-demand";
import type * as TabsStore from "@/stores/tabs/store";
import type { TabRef } from "@/stores/tabs/types";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  // No `RouterProvider` here: the host reads `router.navigate` at render.
  const inertRouter = { navigate: () => Promise.resolve() };
  return {
    ...actual,
    useRouter: () => inertRouter,
    useRouterState: (options: {
      readonly select?: (state: {
        readonly location: {
          readonly pathname: string;
          readonly search: Record<string, unknown>;
        };
      }) => unknown;
    }) => options.select?.({ location: { pathname: "/", search: {} } }) ?? "/",
  };
});

interface SurfaceStub {
  readonly specifier: string;
  readonly exportName: string;
  readonly testId: string;
}

const EPIC_STUB: SurfaceStub = {
  specifier: "@/components/epic-tabs/epic-surface",
  exportName: "EpicSurface",
  testId: "epic-surface-body",
};
const SETTINGS_STUB: SurfaceStub = {
  specifier: "@/components/settings/settings-surface",
  exportName: "SettingsSurface",
  testId: "settings-surface-body",
};
const HISTORY_STUB: SurfaceStub = {
  specifier: "@/components/epics/history-surface",
  exportName: "HistorySurface",
  testId: "history-surface-body",
};
const STUBS: ReadonlyArray<SurfaceStub> = [
  EPIC_STUB,
  SETTINGS_STUB,
  HISTORY_STUB,
];

const EPIC_A: TabRef = { kind: "epic", id: "epic-a" };
const SETTINGS: TabRef = { kind: "settings", id: "settings" };
const HISTORY: TabRef = { kind: "history", id: "history" };
const DEEP_LINK = "/settings/keybindings";

/**
 * Holds one surface module behind a gate and returns what opens it. The
 * surface is an input that takes focus when its pane is focused, which is how
 * a real surface's primary control behaves, and it carries the path the kind
 * handed it.
 */
function holdSurface(stub: SurfaceStub): SurfaceGate {
  let open: () => void = () => undefined;
  let requested = false;
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  vi.doMock(stub.specifier, async () => {
    requested = true;
    await held;
    const React = await import("react");
    // From the fresh graph the host was imported into, so it is the same
    // context object the host's provider writes.
    const { useTabSurfaceActivity } =
      await import("@/components/layout/tab-surface-activity-hooks");
    function Surface(props: { readonly lastPath: string | undefined }) {
      const ref = React.useRef<HTMLInputElement | null>(null);
      const { focused } = useTabSurfaceActivity();
      React.useEffect(() => {
        if (focused) ref.current?.focus();
      }, [focused]);
      return React.createElement("input", {
        ref,
        "aria-label": stub.testId,
        "data-testid": stub.testId,
        "data-last-path": props.lastPath,
      });
    }
    return { [stub.exportName]: Surface };
  });
  return { open: () => open(), requested: () => requested };
}

interface SurfaceGate {
  readonly open: () => void;
  /** Whether anything has imported the surface's module yet. */
  readonly requested: () => boolean;
}

interface Graph {
  readonly host: typeof TopLevelTabHostModule;
  readonly tabs: typeof TabsStore;
  readonly epics: typeof EpicCanvasStore;
  readonly demand: typeof SurfaceDemand;
  readonly surfaces: typeof SurfaceModules;
  readonly settingsGate: SurfaceGate;
  readonly historyGate: SurfaceGate;
}

/** A fresh graph with the task surface open and the other two held. */
async function freshGraph(): Promise<Graph> {
  vi.resetModules();
  const epicGate = holdSurface(EPIC_STUB);
  const settingsGate = holdSurface(SETTINGS_STUB);
  const historyGate = holdSurface(HISTORY_STUB);
  const [host, tabs, epics, demand, surfaces] = await Promise.all([
    import("@/components/layout/top-level-tab-host"),
    import("@/stores/tabs/store"),
    import("@/stores/epics/canvas/store"),
    import("@/stores/tabs/surface-demand"),
    import("@/stores/tabs/kinds/surface-modules"),
  ]);
  epicGate.open();
  await surfaces.epicSurfaceModule.load();
  return { host, tabs, epics, demand, surfaces, settingsGate, historyGate };
}

/** A task, Settings and History, with the task selected. */
function seedTabs(graph: Graph): void {
  graph.epics.useEpicCanvasStore
    .getState()
    .openEpicTabWithId(EPIC_A.id, EPIC_A.id, `Epic ${EPIC_A.id}`);
  graph.tabs.useTabsStore.setState((state) => ({
    ...state,
    systemTabs: {
      history: {
        id: "history",
        kind: "history",
        name: "History",
        lastPath: null,
      },
      settings: {
        id: "settings",
        kind: "settings",
        name: "Settings",
        lastPath: DEEP_LINK,
      },
    },
  }));
  select(graph, EPIC_A);
}

function select(graph: Graph, ref: TabRef): void {
  graph.tabs.useTabsStore.setState((state) => ({
    ...state,
    items: [EPIC_A, SETTINGS, HISTORY].map((candidate) => ({
      kind: "tab" as const,
      id: `tab:${candidate.kind}:${candidate.id}`,
      ref: candidate,
    })),
    activeItemId: `tab:${ref.kind}:${ref.id}`,
    stripOrder: [EPIC_A, SETTINGS, HISTORY],
  }));
}

function surfaceRef(ref: TabRef): HTMLElement {
  return screen.getByTestId(`top-level-surface-${ref.kind}-${ref.id}`);
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

/** Which elements took focus, in order, by their test id. */
function watchFocus(): {
  readonly taken: () => ReadonlyArray<string>;
  readonly stop: () => void;
} {
  const taken: string[] = [];
  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    taken.push(
      target instanceof Element
        ? (target.getAttribute("data-testid") ?? target.tagName)
        : "unknown",
    );
  };
  document.addEventListener("focusin", onFocusIn);
  return {
    taken: () => [...taken],
    stop: () => document.removeEventListener("focusin", onFocusIn),
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

/** Mounts the host on the task, with Settings warm, ready to be opened. */
async function mountWithWarmSettings(): Promise<Graph> {
  const graph = await freshGraph();
  graph.settingsGate.open();
  await graph.surfaces.settingsSurfaceModule.load();
  seedTabs(graph);
  const { TopLevelTabHost } = graph.host;
  render(<TopLevelTabHost />);
  return graph;
}

/** Mounts the host on the task, with Settings and History both cold. */
async function mountWithColdSurfaces(): Promise<Graph> {
  const graph = await freshGraph();
  seedTabs(graph);
  const { TopLevelTabHost } = graph.host;
  render(<TopLevelTabHost />);
  return graph;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const stub of STUBS) vi.doUnmock(stub.specifier);
});

describe("<TopLevelTabHost />: the first open of a warmed tab kind", () => {
  it("draws the surface in the commit the tab becomes visible, and the pending screen is never added", async () => {
    const graph = await mountWithWarmSettings();
    expect(screen.queryByTestId(SETTINGS_STUB.testId)).toBeNull();
    const watch = watchAdditions();

    act(() => {
      select(graph, SETTINGS);
    });
    // Far past the pending delay: a surface that drew the pending screen at
    // all would have it in the document by now.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_PENDING_MS * 5);
    });
    watch.stop();

    expect(surfaceRef(SETTINGS).dataset.visible).toBe("true");
    expect(watch.sawAdded(SETTINGS_STUB.testId)).toBe(true);
    expect(watch.sawAdded("route-pending-screen")).toBe(false);
    expect(screen.queryByTestId("route-pending-screen")).toBeNull();
  });

  it("hands the surface the tab's deep link", async () => {
    const graph = await mountWithWarmSettings();

    act(() => {
      select(graph, SETTINGS);
    });

    const body = screen.getByTestId(SETTINGS_STUB.testId);
    expect(body.getAttribute("data-last-path")).toBe(DEEP_LINK);
  });

  it("gives the surface focus as it mounts, with nothing else taking focus first", async () => {
    const graph = await mountWithWarmSettings();
    const focus = watchFocus();

    act(() => {
      select(graph, SETTINGS);
    });
    focus.stop();

    const body = screen.getByTestId(SETTINGS_STUB.testId);
    expect(document.activeElement).toBe(body);
    expect(focus.taken()).toEqual([SETTINGS_STUB.testId]);
  });
});

describe("<TopLevelTabHost />: the first open of a cold tab kind", () => {
  it("shows nothing, then the pending screen after the delay, and the content replaces it when the module lands", async () => {
    const graph = await mountWithColdSurfaces();
    const focus = watchFocus();

    act(() => {
      select(graph, HISTORY);
    });
    expect(surfaceRef(HISTORY).dataset.visible).toBe("true");
    expect(screen.queryByTestId("route-pending-screen")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_PENDING_MS - 1);
    });
    expect(screen.queryByTestId("route-pending-screen")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId("route-pending-screen")).toBeTruthy();
    expect(screen.queryByTestId(HISTORY_STUB.testId)).toBeNull();
    // Nothing took focus while the surface was missing.
    expect(focus.taken()).toEqual([]);
    // The surface's own render asked for the module.
    expect(graph.historyGate.requested()).toBe(true);

    // Outside `act`, so React's own throttle applies: inside it fallbacks are
    // flushed at once and `React.lazy` would pass this too. The test never
    // calls `load`. Microtasks only; no timer is advanced past 0 ms.
    await outsideAct(async () => {
      graph.historyGate.open();
      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(0);
    });
    focus.stop();

    const body = screen.getByTestId(HISTORY_STUB.testId);
    expect(screen.queryByTestId("route-pending-screen")).toBeNull();
    // Focus went to the surface once, and the pending screen took none.
    expect(document.activeElement).toBe(body);
    expect(focus.taken()).toEqual([HISTORY_STUB.testId]);
  });

  it("hands the surface the tab's deep link when it lands cold", async () => {
    const graph = await mountWithColdSurfaces();
    act(() => {
      select(graph, SETTINGS);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(graph.settingsGate.requested()).toBe(true);

    await outsideAct(async () => {
      graph.settingsGate.open();
      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(0);
    });

    const body = screen.getByTestId(SETTINGS_STUB.testId);
    expect(body.getAttribute("data-last-path")).toBe(DEEP_LINK);
  });

  it("shows no pending screen once the tab is hidden mid-load, and draws the content when it lands", async () => {
    const graph = await mountWithColdSurfaces();
    act(() => {
      select(graph, HISTORY);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_PENDING_MS);
    });
    expect(screen.getByTestId("route-pending-screen")).toBeTruthy();

    // The user moves on before the module lands: the tab stays mounted, hidden.
    act(() => {
      select(graph, EPIC_A);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_PENDING_MS * 5);
    });
    expect(surfaceRef(HISTORY).dataset.visible).toBe("false");
    expect(screen.queryByTestId("route-pending-screen")).toBeNull();

    await outsideAct(async () => {
      graph.historyGate.open();
      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Drawn while hidden, and it did not take focus from the visible task.
    const body = screen.getByTestId(HISTORY_STUB.testId);
    expect(surfaceRef(HISTORY).contains(body)).toBe(true);
    expect(document.activeElement).not.toBe(body);
    expect(screen.queryByTestId("route-pending-screen")).toBeNull();
  });
});
