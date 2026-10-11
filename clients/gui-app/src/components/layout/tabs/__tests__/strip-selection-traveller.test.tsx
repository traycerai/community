/**
 * `StripSelectionTraveller`: the stand-in selected box that slides to the tab
 * you chose wears that tab's pane (`data-join-pane`) for the whole slide, read
 * LIVE through `useHeaderItemJoinPane`, which composes the rules the
 * destination's own resting box reads. Nothing about the pane is captured
 * when the slide starts: a draft's terminal panel can start, grow or retract
 * mid-flight, and the box it swaps for on landing must be the colour the
 * traveller already wears.
 *
 * This drives the real `useSelectionTravel` (the only thing that can start a
 * slide) and the real traveller, against stand-ins for the geometry jsdom does
 * not have: one fixed-width slot per strip item, a scroller wide enough to hold
 * them all, and animation frames the test steps by hand, so a flight stays in
 * the air for as long as a test needs it.
 */
import { useCallback, useRef, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEpicDndStore } from "@/components/epic-canvas/dnd/dnd-store";
import { resetTileSurfaceGeometryCoordinatorForTesting } from "@/components/epic-canvas/surface-host/tile-surface-geometry-coordinator";
import {
  useLandingPaneAnchorStore,
  type LandingPanelCoverage,
} from "@/components/home/terminal-panel/landing-pane-anchor-store";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import { useLandingDraftStore } from "@/stores/home/landing-draft-store";
import { tabItemId, type StripItem } from "@/stores/tabs/layout";
import { useTabsStore } from "@/stores/tabs/store";
import type { TabRef } from "@/stores/tabs/types";
import { SheetJoinBridge, SheetJoinScope } from "../sheet-join";
import { useSelectionTravel } from "../strip-selection-travel";
import { StripSelectionTraveller } from "../strip-selection-traveller";
import { useHiddenHeaderTabs } from "../use-hidden-header-tabs";

const SLOT_WIDTH = 100;
const SLOT_HEIGHT = 36;
/** Wide enough that every slot is wholly in view. */
const SCROLLER_WIDTH = 1000;
const FRAME_MS = 16;
/** A flight that has not landed after this many frames never will. */
const MAX_FRAMES = 600;
const JOIN_MEDIA_QUERY = "(min-width: 48rem)";

const TASK_A: TabRef = { kind: "epic", id: "tab-a" };
const TASK_B: TabRef = { kind: "epic", id: "tab-b" };

function taskItem(ref: TabRef): StripItem {
  return { kind: "tab", id: tabItemId(ref), ref };
}

/** The frame the animation loop asked for and the test has not stepped yet. */
let pendingFrame: FrameRequestCallback | null = null;
let framesRequested = 0;

/**
 * jsdom measures every element at 0px, which puts every destination out of
 * view and so never starts a slide. A slot sits at its index in the strip.
 */
function measure(this: HTMLElement): DOMRect {
  const index = this.dataset.slotIndex;
  return index === undefined
    ? new DOMRect(0, 0, SCROLLER_WIDTH, SLOT_HEIGHT)
    : new DOMRect(Number(index) * SLOT_WIDTH, 0, SLOT_WIDTH, SLOT_HEIGHT);
}

/**
 * The strip's scroller, its traveller and its bridge, with the real travel
 * hook. The scroller registers with the tab-strip geometry coordinator through
 * `useHiddenHeaderTabs`, as the header strip does, so the travel reads the
 * boxes the coordinator holds. `markSelection` paints the selection on the
 * slots as tabs do (`aria-selected`, a tab key), which the coordinator
 * observes: a change of it is a selection change the strip reacts to.
 */
function Strip(props: {
  readonly items: ReadonlyArray<StripItem>;
  readonly activeItemId: string;
  readonly markSelection: boolean;
}): ReactNode {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const travellerRef = useRef<HTMLSpanElement | null>(null);
  const { setScrollElement } = useHiddenHeaderTabs("scroll");
  const setScroller = useCallback(
    (node: HTMLDivElement | null): void => {
      scrollerRef.current = node;
      setScrollElement(node);
    },
    [setScrollElement],
  );
  useSelectionTravel({
    scrollerRef,
    travellerRef,
    activeItemId: props.activeItemId,
    layoutItems: props.items,
  });
  return (
    <SheetJoinScope>
      <div ref={setScroller} data-strip-axis="x" data-strip-edge="top">
        <StripSelectionTraveller ref={travellerRef} />
        {props.items.map((item, index) =>
          props.markSelection ? (
            <div
              key={item.id}
              role="tab"
              aria-selected={item.id === props.activeItemId}
              data-header-tab-key={item.id}
              data-strip-item-id={item.id}
              data-slot-index={index}
            />
          ) : (
            <div
              key={item.id}
              data-strip-item-id={item.id}
              data-slot-index={index}
            />
          ),
        )}
      </div>
      <SheetJoinBridge edge="top" />
    </SheetJoinScope>
  );
}

/**
 * Runs the one animation frame the coordinator scheduled for the strip's first
 * measurement, then forgets it, so the frames counted afterwards are the
 * travel's own.
 */
function drainFirstMeasurement(): void {
  const frame = pendingFrame;
  pendingFrame = null;
  if (frame !== null) act(() => frame(performance.now()));
  framesRequested = 0;
}

/** The strip's items opened as tabs and the first of them active, not yet rendered. */
function seedStrip(refs: ReadonlyArray<TabRef>): ReadonlyArray<StripItem> {
  const items = refs.map(taskItem);
  act(() => {
    for (const ref of refs) {
      if (ref.kind === "epic") {
        useEpicCanvasStore
          .getState()
          .openEpicTabWithId(ref.id, `${ref.id}-epic`, ref.id);
      }
    }
    useTabsStore.setState({
      version: 2,
      items: [...items],
      activeItemId: items[0].id,
      stripOrder: [...refs],
      systemTabs: { history: null, settings: null },
    });
  });
  return items;
}

function newDraft(): TabRef {
  let id = "";
  act(() => {
    id = useLandingDraftStore.getState().createDraft(null);
  });
  return { kind: "draft", id };
}

/** Starts a slide from the first item to `destination`, and leaves it in the air. */
function startSlideTo(
  items: ReadonlyArray<StripItem>,
  destination: StripItem,
): { readonly rerender: (activeItemId: string) => void } {
  const view = render(
    <Strip items={items} activeItemId={items[0].id} markSelection={false} />,
  );
  drainFirstMeasurement();
  const rerender = (activeItemId: string): void => {
    act(() => {
      view.rerender(
        <Strip
          items={items}
          activeItemId={activeItemId}
          markSelection={false}
        />,
      );
    });
  };
  rerender(destination.id);
  return { rerender };
}

function publish(draftId: string, coverage: LandingPanelCoverage | null): void {
  act(() => {
    useLandingPaneAnchorStore.getState().setPanelCoverage(draftId, coverage);
  });
}

function traveller(): HTMLElement {
  return screen.getByTestId("tab-selection-traveller");
}

function bridgePane(): string | null {
  return (
    document
      .querySelector('[data-sheet-join-bridge="top"]')
      ?.getAttribute("data-join-pane") ?? null
  );
}

/** Steps the animation loop until the flight lands, as a real run would. */
function flyUntilLanded(): void {
  act(() => {
    let now = performance.now();
    for (let frame = 0; frame < MAX_FRAMES; frame += 1) {
      const next = pendingFrame;
      if (next === null) return;
      pendingFrame = null;
      now += FRAME_MS;
      next(now);
    }
  });
}

beforeEach(() => {
  pendingFrame = null;
  framesRequested = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    measure,
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    SCROLLER_WIDTH,
  );
  // The shim answers every media query but a px width with `false`, and the
  // sheet join (so the slide) only exists from md.
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches(): boolean {
      return query === JOIN_MEDIA_QUERY;
    },
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number => {
      pendingFrame = callback;
      framesRequested += 1;
      return framesRequested;
    },
  );
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  // Unmounting the strip lands any flight still in the air.
  cleanup();
  resetTileSurfaceGeometryCoordinatorForTesting();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useEpicDndStore.getState().dragEnded();
  useTabsStore.setState(useTabsStore.getInitialState(), true);
  useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  useLandingDraftStore.setState({ drafts: [], activeDraftId: null });
  useLandingPaneAnchorStore.setState(
    useLandingPaneAnchorStore.getInitialState(),
    true,
  );
});

describe("the sliding selection box follows its destination's pane live", () => {
  it("is drawn joined in the destination's pane while it flies to a draft that shows no panel", () => {
    const draft = newDraft();
    const items = seedStrip([TASK_A, draft]);

    startSlideTo(items, items[1]);

    expect(framesRequested).toBe(1);
    expect(traveller().hidden).toBe(false);
    expect(traveller().getAttribute("data-sheet-joined")).toBe("top");
    expect(traveller().getAttribute("data-join-pane")).toBe("surface");
    expect(bridgePane()).toBe("surface");
  });

  it("moves to the canvas pane when the draft's panel goes full mid-flight, without restarting the flight", () => {
    const draft = newDraft();
    const items = seedStrip([TASK_A, draft]);
    startSlideTo(items, items[1]);
    const box = traveller();
    const left = box.style.left;
    expect(box.getAttribute("data-join-pane")).toBe("surface");

    publish(draft.id, "full");

    expect(traveller()).toBe(box);
    expect(box.hidden).toBe(false);
    expect(box.getAttribute("data-sheet-joined")).toBe("top");
    expect(box.getAttribute("data-join-pane")).toBe("canvas");
    expect(bridgePane()).toBe("canvas");
    // The same flight: no second one was launched and the box was not re-placed.
    expect(framesRequested).toBe(1);
    expect(box.style.left).toBe(left);
  });

  it("keeps the surface pane while the draft's panel only docks, and follows it retracting from full", () => {
    const draft = newDraft();
    const items = seedStrip([TASK_A, draft]);
    startSlideTo(items, items[1]);

    publish(draft.id, "docked");
    expect(traveller().getAttribute("data-join-pane")).toBe("surface");

    publish(draft.id, "full");
    expect(traveller().getAttribute("data-join-pane")).toBe("canvas");

    publish(draft.id, null);
    expect(traveller().getAttribute("data-join-pane")).toBe("surface");
    expect(bridgePane()).toBe("surface");
    expect(framesRequested).toBe(1);
  });

  it("is drawn in the canvas pane from its first frame when the draft's panel already covers the page", () => {
    const draft = newDraft();
    const items = seedStrip([TASK_A, draft]);
    publish(draft.id, "full");

    startSlideTo(items, items[1]);

    expect(traveller().getAttribute("data-join-pane")).toBe("canvas");
    expect(bridgePane()).toBe("canvas");
  });

  it("is not moved by another draft's panel", () => {
    const draft = newDraft();
    const other = newDraft();
    const items = seedStrip([TASK_A, draft]);
    startSlideTo(items, items[1]);

    publish(other.id, "full");

    expect(traveller().getAttribute("data-join-pane")).toBe("surface");
  });

  it("reads the pane of the destination it is retargeted to, not of the draft it left", () => {
    const draft = newDraft();
    const items = seedStrip([TASK_A, draft, TASK_B]);
    publish(draft.id, "full");
    const { rerender } = startSlideTo(items, items[1]);
    expect(traveller().getAttribute("data-join-pane")).toBe("canvas");

    // A turn mid-flight: the same traveller now flies on to the next tab.
    rerender(items[2].id);

    expect(framesRequested).toBe(1);
    expect(traveller().hidden).toBe(false);
    expect(traveller().getAttribute("data-join-pane")).toBe("surface");
    expect(bridgePane()).toBe("surface");
  });

  it("names no pane once it lands, and leaves the join to the destination's own box", () => {
    const draft = newDraft();
    const items = seedStrip([TASK_A, draft]);
    publish(draft.id, "full");
    startSlideTo(items, items[1]);
    expect(traveller().getAttribute("data-join-pane")).toBe("canvas");

    flyUntilLanded();

    expect(pendingFrame).toBeNull();
    expect(traveller().hidden).toBe(true);
    expect(traveller().hasAttribute("data-join-pane")).toBe(false);
    expect(traveller().hasAttribute("data-sheet-joined")).toBe(false);
    expect(
      document
        .querySelector('[data-sheet-join-bridge="top"]')
        ?.hasAttribute("data-join-active"),
    ).toBe(false);
  });

  it("is not drawn at all while nothing slides", () => {
    const draft = newDraft();
    const items = seedStrip([TASK_A, draft]);
    publish(draft.id, "full");

    render(
      <Strip items={items} activeItemId={items[0].id} markSelection={false} />,
    );
    drainFirstMeasurement();

    expect(framesRequested).toBe(0);
    expect(traveller().hidden).toBe(true);
    expect(traveller().hasAttribute("data-join-pane")).toBe(false);
  });
});

/**
 * A queue of animation frames, for a strip whose slots carry the selection:
 * the coordinator then schedules frames of its own beside the travel's, which
 * the single-slot stand-in above would let overwrite each other.
 */
function installFrameQueue(): {
  readonly step: () => void;
  readonly drain: () => void;
} {
  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number => {
      nextId += 1;
      queue.set(nextId, callback);
      return nextId;
    },
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    queue.delete(id);
  });
  let now = performance.now();
  const step = (): void => {
    const callbacks = [...queue.values()];
    queue.clear();
    now += FRAME_MS;
    act(() => {
      for (const callback of callbacks) callback(now);
    });
  };
  return {
    step,
    drain: () => {
      for (let frame = 0; frame < MAX_FRAMES && queue.size > 0; frame += 1) {
        step();
      }
    },
  };
}

describe("the selection travel measures nothing of its own", () => {
  const STRIP_REFS: ReadonlyArray<TabRef> = [
    { kind: "epic", id: "tab-a" },
    { kind: "epic", id: "tab-b" },
    { kind: "epic", id: "tab-c" },
    { kind: "epic", id: "tab-d" },
    { kind: "epic", id: "tab-e" },
  ];

  /** Every read of layout the strip's own code could make while it slides. */
  function installLayoutReadCounters(scroller: HTMLElement): {
    readonly rects: () => number;
    readonly scrollerReads: () => number;
    readonly clear: () => void;
  } {
    // Already spied by `beforeEach`; asking again returns that same spy.
    const rectReads = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const scrollLeftReads = vi.spyOn(Element.prototype, "scrollLeft", "get");
    const clientWidthReads = vi.spyOn(
      HTMLElement.prototype,
      "clientWidth",
      "get",
    );
    const onScroller = (contexts: ReadonlyArray<unknown>): number =>
      contexts.filter((context) => context === scroller).length;
    return {
      rects: () => rectReads.mock.calls.length,
      scrollerReads: () =>
        onScroller(scrollLeftReads.mock.contexts) +
        onScroller(clientWidthReads.mock.contexts),
      clear: () => {
        rectReads.mockClear();
        scrollLeftReads.mockClear();
        clientWidthReads.mockClear();
      },
    };
  }

  it("reads no rect, scroll offset or width through a held cycle of selection changes, and still lands on the destination", () => {
    const items = seedStrip(STRIP_REFS.slice(0, 3));
    const frames = installFrameQueue();
    const view = render(
      <Strip items={items} activeItemId={items[0].id} markSelection />,
    );
    // The strip's first measurement, which is the only one it makes.
    frames.drain();
    const scroller = traveller().parentElement;
    if (scroller === null) throw new Error("the traveller has no scroller");
    const reads = installLayoutReadCounters(scroller);
    reads.clear();

    // A held cycle: the next change arrives while the slide is still in the air.
    const route = [1, 2, 1, 2, 0];
    for (const index of route) {
      act(() => {
        view.rerender(
          <Strip items={items} activeItemId={items[index].id} markSelection />,
        );
      });
      expect(traveller().hidden).toBe(false);
      frames.step();
    }
    frames.drain();

    expect(reads.rects()).toBe(0);
    expect(reads.scrollerReads()).toBe(0);
    // The slide landed on the first slot's box, inset by 2px on each side.
    expect(traveller().hidden).toBe(true);
    expect(Number.parseFloat(traveller().style.left)).toBeCloseTo(2, 0);
    expect(Number.parseFloat(traveller().style.width)).toBeCloseTo(
      SLOT_WIDTH - 4,
      0,
    );
  });

  it("makes one whole-strip read phase for a tab added and selected in the same commit", () => {
    const items = seedStrip(STRIP_REFS);
    const before = items.slice(0, 4);
    const frames = installFrameQueue();
    const view = render(
      <Strip items={before} activeItemId={before[0].id} markSelection />,
    );
    frames.drain();
    const scroller = traveller().parentElement;
    if (scroller === null) throw new Error("the traveller has no scroller");
    const reads = installLayoutReadCounters(scroller);
    reads.clear();

    // The new tab has no cached box, so its destination box forces a read;
    // that read refreshes the strip once, and every box after it is cached.
    act(() => {
      view.rerender(
        <Strip items={items} activeItemId={items[4].id} markSelection />,
      );
    });

    // The scroller's own box plus one box for each of the strip's members.
    expect(reads.rects()).toBe(1 + items.length);
    expect(traveller().hidden).toBe(false);
  });
});
