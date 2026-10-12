/**
 * `PreloadedTabSurface` alone: a tab surface drawn from an on-demand module.
 *
 * Loaded, it is drawn in the first commit. Not loaded, it shows the delayed
 * pending screen when its tab is visible and nothing when it is hidden. When
 * the module lands, the content replaces the pending screen in that same
 * render: no timer, no extra wait. That last part is what `React.lazy` cannot
 * do - it holds the content back about 300 ms after a fallback was shown.
 *
 * The modules here are tiny `preloadedModule`s over gated promises: no app
 * surface, no mock of an app module.
 */
import { Component, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreloadedTabSurface } from "@/components/layout/preloaded-tab-surface";
import { TabSurfaceActivityProvider } from "@/components/layout/tab-surface-activity";
import { ROUTE_PENDING_MS } from "@/components/loading/route-pending-screen";
import { preloadedModule, type PreloadedModule } from "@/lib/preloaded-module";

const PENDING = "route-pending-screen";
const CONTENT = "surface-content";

/** A promise the test resolves itself: no timer decides when an import lands. */
function gate<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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

function Surface(props: {
  readonly module: PreloadedModule<string>;
  readonly visible: boolean;
}): ReactNode {
  return (
    <TabSurfaceActivityProvider
      activity={{ visible: props.visible, focused: true }}
    >
      <PreloadedTabSurface
        module={props.module}
        render={(value) => <span data-testid={CONTENT}>{value}</span>}
      />
    </TabSurfaceActivityProvider>
  );
}

class Boundary extends Component<
  { readonly children: ReactNode },
  { readonly failure: string | null }
> {
  state: { readonly failure: string | null } = { failure: null };

  static getDerivedStateFromError(error: unknown): {
    readonly failure: string;
  } {
    return { failure: error instanceof Error ? error.message : "unknown" };
  }

  render(): ReactNode {
    if (this.state.failure !== null) {
      return <span data-testid="failure">{this.state.failure}</span>;
    }
    return this.props.children;
  }
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("<PreloadedTabSurface />", () => {
  it("draws a loaded surface in the first commit, and the pending screen is never in the DOM", async () => {
    const module = preloadedModule(() => Promise.resolve("loaded"));
    await module.load();
    // A MutationObserver, started before the mount: it sees every node that
    // the mount adds, in whichever commit adds it.
    const watch = watchAdditions();

    render(<Surface module={module} visible />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_PENDING_MS * 5);
    });
    watch.stop();

    expect(screen.getByTestId(CONTENT).textContent).toBe("loaded");
    expect(watch.sawAdded(CONTENT)).toBe(true);
    expect(watch.sawAdded(PENDING)).toBe(false);
    expect(screen.queryByTestId(PENDING)).toBeNull();
  });

  it("draws nothing for the first 200 ms of a visible, unloaded surface, then the pending screen", () => {
    const landing = gate<string>();
    const module = preloadedModule(() => landing.promise);

    render(<Surface module={module} visible />);
    expect(screen.queryByTestId(PENDING)).toBeNull();
    expect(screen.queryByTestId(CONTENT)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(ROUTE_PENDING_MS - 1);
    });
    expect(screen.queryByTestId(PENDING)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId(PENDING)).toBeTruthy();
    expect(screen.queryByTestId(CONTENT)).toBeNull();
  });

  it("shows the content and never the pending screen when the module lands before 200 ms", async () => {
    const landing = gate<string>();
    const module = preloadedModule(() => landing.promise);
    const watch = watchAdditions();
    render(<Surface module={module} visible />);
    act(() => {
      vi.advanceTimersByTime(ROUTE_PENDING_MS - 100);
    });

    await act(async () => {
      landing.resolve("loaded");
      await module.load();
    });
    // Past where the delay would have ended: it was cancelled with its screen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_PENDING_MS * 5);
    });
    watch.stop();

    expect(screen.getByTestId(CONTENT).textContent).toBe("loaded");
    expect(watch.sawAdded(PENDING)).toBe(false);
    expect(screen.queryByTestId(PENDING)).toBeNull();
  });

  it("replaces a showing pending screen with the content as soon as the module lands, with no further timer", async () => {
    const landing = gate<string>();
    const module = preloadedModule(() => landing.promise);
    render(<Surface module={module} visible />);
    act(() => {
      vi.advanceTimersByTime(ROUTE_PENDING_MS);
    });
    expect(screen.getByTestId(PENDING)).toBeTruthy();

    // Inside `act` React flushes fallbacks at once, so only this outside-act
    // form tells this loader from `React.lazy`, which would hold the content
    // back after its fallback. Microtasks only: no timer is advanced past 0.
    await outsideAct(async () => {
      landing.resolve("loaded");
      await module.load();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId(CONTENT).textContent).toBe("loaded");
    expect(screen.queryByTestId(PENDING)).toBeNull();
  });

  it("shows no pending screen for a hidden surface, and draws the content when the module lands", async () => {
    const landing = gate<string>();
    const module = preloadedModule(() => landing.promise);
    render(<Surface module={module} visible={false} />);
    expect(screen.queryByTestId(PENDING)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId(PENDING)).toBeNull();
    expect(screen.queryByTestId(CONTENT)).toBeNull();

    await act(async () => {
      landing.resolve("loaded");
      await module.load();
    });
    expect(screen.getByTestId(CONTENT).textContent).toBe("loaded");
  });

  it("starts the 200 ms delay when a hidden, still loading surface is shown, not when it mounted", () => {
    const landing = gate<string>();
    const module = preloadedModule(() => landing.promise);
    const view = render(<Surface module={module} visible={false} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId(PENDING)).toBeNull();

    view.rerender(<Surface module={module} visible />);
    act(() => {
      vi.advanceTimersByTime(ROUTE_PENDING_MS - 1);
    });
    expect(screen.queryByTestId(PENDING)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId(PENDING)).toBeTruthy();
  });

  it("throws a failed import at render, into the boundary around it", async () => {
    // React logs the render error before the boundary catches it.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const module = preloadedModule<string>(() =>
      Promise.reject(new Error("surface chunk failed")),
    );
    await module.load();

    render(
      <Boundary>
        <Surface module={module} visible />
      </Boundary>,
    );

    expect(screen.getByTestId("failure").textContent).toBe(
      "surface chunk failed",
    );
  });
});
