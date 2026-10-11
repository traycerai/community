import { useCallback, useState } from "react";
import type { StripGeometrySnapshot } from "@/components/epic-canvas/surface-host/tile-surface-geometry-coordinator";

/** What the Activity view's scroll position says about the rows it hides. */
export interface SectionScroll {
  /** More rows lie below the bottom edge. */
  readonly moreBelow: boolean;
  /** The Needs you header has scrolled out of view, above the top edge. */
  readonly needsYouAbove: boolean;
  /**
   * The section whose header row is in front on the top edge: the one stuck
   * there, or the next one once it starts to push that one out. `null` at rest.
   */
  readonly stuck: string | null;
}

const AT_REST: SectionScroll = {
  moreBelow: false,
  needsYouAbove: false,
  stuck: null,
};

/**
 * The scroll state of the Activity view, from the strip's geometry snapshot.
 * Needs you is the first section and its header sticks, so it is out of view
 * once the next section's header has reached the top and covers it. That is
 * read from where the next header sits in the flow, the end of the row before
 * it, never from where it sticks, so nothing drawn in a stuck header can move
 * the answer. The header in front on the top edge is the last one stuck there,
 * since each covers the one before, or the next one from the moment it
 * overlaps that.
 */
export function sectionScrollOf(
  snapshot: StripGeometrySnapshot,
): SectionScroll {
  const { sections, offset } = snapshot;
  const top = 0.5;
  const stuckAt = sections.findLastIndex((row) => row.start <= top);
  // The next header takes over the moment it starts to slide over the stuck
  // one, so the row in front is never one being covered.
  const incoming = sections.at(stuckAt + 1);
  const stuck =
    stuckAt >= 0 &&
    incoming !== undefined &&
    incoming.start < sections[stuckAt].end - 0.5
      ? incoming
      : sections.at(stuckAt);
  const needsYouEnd = sections.at(1)?.precedingEnd ?? null;
  return {
    moreBelow: snapshot.maxOffset - offset > 1,
    needsYouAbove:
      offset > 0 &&
      needsYouEnd !== null &&
      sections[0].id === "needs-you" &&
      needsYouEnd <= top,
    stuck: offset > 0 ? (stuck?.id ?? null) : null,
  };
}

/**
 * The Activity view's scroll state and the listener that keeps it. The strip's
 * geometry owner already watches this scroller (its scroll, its size and its
 * rows) and reads every box in one phase per frame; `onGeometry` takes its
 * snapshot, so this hook observes and measures nothing itself. The state only
 * changes where an edge is crossed.
 */
export function useSectionScroll(enabled: boolean): {
  readonly scroll: SectionScroll;
  readonly onGeometry: (snapshot: StripGeometrySnapshot) => void;
} {
  const [scroll, setScroll] = useState(AT_REST);
  const onGeometry = useCallback((snapshot: StripGeometrySnapshot): void => {
    const next = sectionScrollOf(snapshot);
    setScroll((held) =>
      held.moreBelow === next.moreBelow &&
      held.needsYouAbove === next.needsYouAbove &&
      held.stuck === next.stuck
        ? held
        : next,
    );
  }, []);
  return { scroll: enabled ? scroll : AT_REST, onGeometry };
}
