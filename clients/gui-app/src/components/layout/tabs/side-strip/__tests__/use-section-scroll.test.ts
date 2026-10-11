/**
 * `sectionScrollOf`: what the Activity view's scroll position says about the
 * rows it hides, decided from the strip's geometry snapshot alone. Section
 * rows are given as the strip draws them: `start` and `end` from its leading
 * edge, and `precedingEnd`, where the row before the header ends - the
 * header's place in the flow, which no sticky offset moves.
 */
import { describe, expect, it } from "vitest";
import type {
  StripGeometrySnapshot,
  StripSection,
} from "@/components/epic-canvas/surface-host/tile-surface-geometry-coordinator";
import { sectionScrollOf } from "../use-section-scroll";

const HEADER_HEIGHT = 28;

function section(
  id: string,
  start: number,
  precedingEnd: number | null,
): StripSection {
  return { id, start, end: start + HEADER_HEIGHT, precedingEnd };
}

function snapshot(input: {
  readonly offset: number;
  readonly maxOffset: number;
  readonly sections: ReadonlyArray<StripSection>;
}): StripGeometrySnapshot {
  return {
    hiddenTabKeys: { left: [], right: [] },
    hasOverflow: input.maxOffset > 0,
    ...input,
  };
}

describe("sectionScrollOf", () => {
  it("is at rest with the list unscrolled, whatever header sits on the top edge", () => {
    expect(
      sectionScrollOf(
        snapshot({
          offset: 0,
          maxOffset: 0,
          sections: [section("needs-you", 0, null), section("idle", 60, 60)],
        }),
      ),
    ).toEqual({ moreBelow: false, needsYouAbove: false, stuck: null });
  });

  it("names the first header while it is stuck, with the next one still below it", () => {
    expect(
      sectionScrollOf(
        snapshot({
          offset: 50,
          maxOffset: 200,
          sections: [
            section("needs-you", 0, null),
            section("to-review", 120, 120),
          ],
        }),
      ),
    ).toEqual({ moreBelow: true, needsYouAbove: false, stuck: "needs-you" });
  });

  it("hands the top edge to the next header the moment it starts to cover the stuck one", () => {
    const covering = snapshot({
      offset: 100,
      maxOffset: 200,
      sections: [section("needs-you", 0, null), section("to-review", 20, 20)],
    });
    expect(sectionScrollOf(covering).stuck).toBe("to-review");

    // Just clear of it, the stuck header is still the one in front.
    const clear = snapshot({
      offset: 100,
      maxOffset: 200,
      sections: [
        section("needs-you", 0, null),
        section("to-review", HEADER_HEIGHT - 0.5, HEADER_HEIGHT - 0.5),
      ],
    });
    expect(sectionScrollOf(clear).stuck).toBe("needs-you");
  });

  it("says Needs you is above once the header after it sits at the top, read from its place in the flow", () => {
    const scrolledPast = snapshot({
      offset: 80,
      maxOffset: 200,
      sections: [
        section("needs-you", 0, null),
        // Stuck at the top; the row before it ended 10px above the edge.
        section("to-review", 0, -10),
        section("working", 200, 200),
      ],
    });
    expect(sectionScrollOf(scrolledPast)).toEqual({
      moreBelow: true,
      needsYouAbove: true,
      stuck: "to-review",
    });

    // Its rows are still in view: the header after it has not reached the top.
    const stillInView = snapshot({
      offset: 80,
      maxOffset: 200,
      sections: [
        section("needs-you", 0, null),
        section("to-review", 30, 30),
        section("working", 200, 200),
      ],
    });
    expect(sectionScrollOf(stillInView).needsYouAbove).toBe(false);
  });

  it("does not say Needs you is above when the first section is another one, or at rest", () => {
    const otherFirst = snapshot({
      offset: 80,
      maxOffset: 200,
      sections: [section("to-review", 0, null), section("working", 0, -10)],
    });
    expect(sectionScrollOf(otherFirst).needsYouAbove).toBe(false);

    const atRest = snapshot({
      offset: 0,
      maxOffset: 200,
      sections: [section("needs-you", 0, null), section("to-review", 0, -10)],
    });
    expect(sectionScrollOf(atRest).needsYouAbove).toBe(false);
  });

  it("has more below only while more than a pixel of scroll range remains", () => {
    const at = (remaining: number): boolean =>
      sectionScrollOf(
        snapshot({ offset: 100, maxOffset: 100 + remaining, sections: [] }),
      ).moreBelow;

    expect(at(0)).toBe(false);
    expect(at(1)).toBe(false);
    expect(at(1.5)).toBe(true);
    expect(at(40)).toBe(true);
  });

  it("names nothing for a list with no section headers", () => {
    expect(
      sectionScrollOf(snapshot({ offset: 30, maxOffset: 100, sections: [] })),
    ).toEqual({ moreBelow: true, needsYouAbove: false, stuck: null });
  });
});
