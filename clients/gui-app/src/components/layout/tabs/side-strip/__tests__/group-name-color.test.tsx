/**
 * `useGroupNameColor` sets a group block's header-name colour from what the
 * block paints. What changes that fill is the theme and the strip's ground
 * (`md` swaps the canvas for the shell ground) - never the block's own size -
 * so the hook reads again for those two and observes nothing: a per-block
 * `ResizeObserver` would report every resize of every group block in a strip
 * and read computed style for each.
 *
 * The block's paint is stood in for by inline colours, which jsdom resolves,
 * and the two causes are driven as the app drives them: the `md` media query's
 * `change` event, and a theme preset change through the settings store.
 */
import { useRef, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getThemeRevision } from "@/lib/theme-applier";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { useSettingsStore } from "@/stores/settings/settings-store";
import { useGroupNameColor } from "../group-name-color";

const NAME_PROPERTY = "--side-tab-group-name";
/** Mid grey: readable on black as it is, and darkened to read on white. */
const GROUP_COLOR = "#808080";

function Block(props: {
  readonly groupColor: string;
  readonly placed: boolean;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useGroupNameColor(ref, props.groupColor, props.placed);
  return (
    <div
      ref={ref}
      data-testid="block"
      style={{ backgroundColor: "rgb(255, 255, 255)", color: "rgb(0, 0, 0)" }}
    />
  );
}

function block(): HTMLElement {
  return screen.getByTestId("block");
}

function nameColor(): string {
  return block().style.getPropertyValue(NAME_PROPERTY);
}

/** What the strip's ground swapping at `md` does to the block's fill. */
function repaintBlockBlack(): void {
  block().style.backgroundColor = "rgb(0, 0, 0)";
}

let observersConstructed: number;
let observedTargets: Element[];
let observerCallbacks: ResizeObserverCallback[];

class CountingResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observersConstructed += 1;
    observerCallbacks.push(callback);
  }
  observe(target: Element): void {
    observedTargets.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    const index = observerCallbacks.indexOf(this.callback);
    if (index !== -1) observerCallbacks.splice(index, 1);
  }
}

/** A `matchMedia` whose `(width < 768px)` answer the test flips and announces. */
function installMatchMedia(): (matches: boolean) => void {
  let matches = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches(): boolean {
      return matches;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void): void => {
      listeners.delete(listener);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  return (next: boolean): void => {
    matches = next;
    act(() => {
      for (const listener of [...listeners]) listener();
    });
  };
}

/** Counts `getComputedStyle` calls made on the block. */
function countBlockStyleReads(): () => number {
  const real = window.getComputedStyle.bind(window);
  const spy = vi
    .spyOn(window, "getComputedStyle")
    .mockImplementation((element: Element, pseudo: string | null | undefined) =>
      real(element, pseudo),
    );
  return () =>
    spy.mock.calls.filter(
      ([element]) => element === screen.queryByTestId("block"),
    ).length;
}

beforeEach(() => {
  observersConstructed = 0;
  observedTargets = [];
  observerCallbacks = [];
  vi.stubGlobal("ResizeObserver", CountingResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useGroupNameColor", () => {
  it("observes nothing: no ResizeObserver is constructed or watches the block", () => {
    installMatchMedia();

    render(<Block groupColor={GROUP_COLOR} placed={false} />);

    expect(nameColor()).not.toBe("");
    expect(observersConstructed).toBe(0);
    expect(observedTargets).toEqual([]);
  });

  it("reads the block's style once at mount and not again when it resizes", () => {
    installMatchMedia();
    const reads = countBlockStyleReads();

    render(<Block groupColor={GROUP_COLOR} placed={false} />);
    expect(reads()).toBe(1);

    // A resize report for the block, to every observer there is to deliver it.
    const reporter: ResizeObserver = {
      observe: () => undefined,
      unobserve: () => undefined,
      disconnect: () => undefined,
    };
    act(() => {
      for (const callback of [...observerCallbacks]) callback([], reporter);
    });

    expect(reads()).toBe(1);
  });

  it("recomputes the name colour when the md media query flips", () => {
    const setBelowMd = installMatchMedia();
    render(<Block groupColor={GROUP_COLOR} placed={false} />);
    const onWhite = nameColor();
    expect(onWhite).not.toBe("");

    repaintBlockBlack();
    setBelowMd(true);

    const onBlack = nameColor();
    expect(onBlack).not.toBe("");
    expect(onBlack).not.toBe(onWhite);
  });

  it("recomputes the name colour when the theme revision changes", () => {
    installMatchMedia();
    const original = useSettingsStore.getState().themePreset;
    const other = THEME_PRESETS.find((preset) => preset.id !== original);
    if (other === undefined) throw new Error("expected a second theme preset");
    render(<Block groupColor={GROUP_COLOR} placed={false} />);
    const onWhite = nameColor();
    const reads = countBlockStyleReads();
    const revision = getThemeRevision();

    repaintBlockBlack();
    act(() => {
      useSettingsStore.setState({ themePreset: other.id });
    });

    expect(getThemeRevision()).toBeGreaterThan(revision);
    expect(reads()).toBe(1);
    expect(nameColor()).not.toBe(onWhite);

    act(() => {
      useSettingsStore.setState({ themePreset: original });
    });
  });

  it("reads nothing while the block is placed by a drag, and reads once it paints", () => {
    installMatchMedia();
    const reads = countBlockStyleReads();
    const view = render(<Block groupColor={GROUP_COLOR} placed />);

    expect(reads()).toBe(0);
    expect(nameColor()).toBe("");

    view.rerender(<Block groupColor={GROUP_COLOR} placed={false} />);

    expect(reads()).toBe(1);
    expect(nameColor()).not.toBe("");
  });
});
