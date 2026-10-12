/**
 * `preloadedModule` / `usePreloadedModule` alone: an on-demand import that is
 * read WITHOUT suspending. What it guarantees is that a reader mounting after
 * the load has settled draws the value in its first commit, which `React.lazy`
 * cannot.
 */
import { Component, useLayoutEffect, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  preloadedModule,
  usePreloadedModule,
  type PreloadedModule,
} from "@/lib/preloaded-module";

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

/** Records what every render of the hook saw, in order. */
function Reader(props: {
  readonly module: PreloadedModule<string>;
  readonly seen: Array<string | null>;
}): ReactNode {
  const value = usePreloadedModule(props.module);
  props.seen.push(value);
  return <span data-testid="value">{value ?? "none"}</span>;
}

/** Notes its own layout effect, which runs in the commit of the first render. */
function LayoutNote(props: { readonly order: Array<string> }): ReactNode {
  useLayoutEffect(() => {
    props.order.push("layout");
  }, [props.order]);
  return null;
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

beforeEach(() => {
  // React logs a render error before the boundary catches it.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("preloadedModule", () => {
  it("reads null and has not imported anything until load is called", () => {
    const importer = vi.fn(() => Promise.resolve("value"));

    const module = preloadedModule(importer);

    expect(module.read()).toBeNull();
    expect(importer).not.toHaveBeenCalled();
  });

  it("runs the importer once for any number of loads, and returns the same promise", () => {
    const importer = vi.fn(() => Promise.resolve("value"));
    const module = preloadedModule(importer);

    const first = module.load();
    const second = module.load();

    expect(second).toBe(first);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("reads the value once loaded and tells a subscriber exactly once", async () => {
    const module = preloadedModule(() => Promise.resolve("value"));
    const heard = vi.fn();
    const unsubscribed = vi.fn();
    module.subscribe(heard);
    module.subscribe(unsubscribed)();

    await module.load();

    expect(module.read()).toBe("value");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(unsubscribed).not.toHaveBeenCalled();
  });

  it("draws the value in the FIRST commit of a reader that mounts after the load", async () => {
    const module = preloadedModule(() => Promise.resolve("value"));
    await module.load();
    const seen: Array<string | null> = [];

    render(<Reader module={module} seen={seen} />);

    expect(screen.getByTestId("value").textContent).toBe("value");
    // Never `[null, "value"]`: no render saw the module as missing.
    expect(seen).toEqual(["value"]);
  });

  it("draws null first, starts the load in that same render, and re-renders with the value when it lands", async () => {
    const landing = gate<string>();
    const importer = vi.fn(() => landing.promise);
    const module = preloadedModule(importer);
    const seen: Array<string | null> = [];

    render(<Reader module={module} seen={seen} />);

    expect(seen[0]).toBeNull();
    expect(screen.getByTestId("value").textContent).toBe("none");
    expect(importer).toHaveBeenCalledTimes(1);

    await act(async () => {
      landing.resolve("value");
      await module.load();
    });

    expect(screen.getByTestId("value").textContent).toBe("value");
    expect(seen.at(-1)).toBe("value");
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("starts the load in the render that finds the module missing, before the commit", () => {
    const order: Array<string> = [];
    const module = preloadedModule(() => {
      order.push("import");
      return new Promise<string>(() => undefined);
    });

    render(
      <>
        <Reader module={module} seen={[]} />
        <LayoutNote order={order} />
      </>,
    );

    // The importer ran while rendering, so it came before any layout effect.
    // An effect-started load would give `["layout", "import"]`.
    expect(order).toEqual(["import", "layout"]);
  });

  it("starts the load when a reader renders with no commit at all", () => {
    const importer = vi.fn(() => new Promise<string>(() => undefined));
    const module = preloadedModule(importer);

    const html = renderToString(<Reader module={module} seen={[]} />);

    // Server rendering commits nothing and runs no effect: only a render-time
    // start can have called the importer.
    expect(html).toContain("none");
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("does not ask an already loaded module to load again", async () => {
    const importer = vi.fn(() => Promise.resolve("value"));
    const module = preloadedModule(importer);
    await module.load();
    const load = vi.spyOn(module, "load");

    render(<Reader module={module} seen={[]} />);

    expect(screen.getByTestId("value").textContent).toBe("value");
    expect(load).not.toHaveBeenCalled();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("throws the import's failure from read and from a reader's render, and never retries", async () => {
    const failure = new Error("chunk failed to load");
    const importer = vi.fn(() => Promise.reject(failure));
    const module = preloadedModule<string>(importer);

    // `load` itself never rejects.
    await expect(module.load()).resolves.toBeUndefined();

    let thrown: unknown = null;
    try {
      module.read();
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBe(failure);

    await module.load();
    expect(importer).toHaveBeenCalledTimes(1);

    render(
      <Boundary>
        <Reader module={module} seen={[]} />
      </Boundary>,
    );
    expect(screen.getByTestId("failure").textContent).toBe(
      "chunk failed to load",
    );
    expect(importer).toHaveBeenCalledTimes(1);
  });
});
