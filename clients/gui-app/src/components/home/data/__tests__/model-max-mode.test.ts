import { describe, expect, it } from "vitest";
import type { ModelOption } from "@/components/home/data/landing-options";
import {
  maxModeListedFor,
  maxModeOnlyRow,
  type MaxModeContext,
} from "@/components/home/data/model-max-mode";

const EFFORTS = ["low", "medium", "high"].map((id) => ({
  id,
  label: id,
  description: null,
}));

function row(metadata: Record<string, unknown>): ModelOption {
  return {
    harnessId: "cursor",
    slug: "example",
    label: "Example",
    description: null,
    contextWindow: null,
    maxOutputTokens: null,
    defaultReasoningEffort: null,
    supportedReasoningEfforts: EFFORTS,
    defaultServiceTier: null,
    supportedServiceTiers: [],
    deprecationNotice: null,
    metadata,
  };
}

// chat and judge lists deliberately differ for the same row: chat lists only
// high+Fast, judge lists only the no-effort selection.
const MIXED = row({
  maxMode: {
    chat: [{ reasoningEffort: "high", fast: true }],
    judge: [{ reasoningEffort: null }, { reasoningEffort: "high" }],
    fastServiceTierId: "fast",
    futureKey: 1,
  },
});

function chat(
  reasoningEffort: string | null,
  serviceTier: string | null,
): MaxModeContext {
  return { kind: "chat", tuple: { reasoningEffort, serviceTier } };
}

describe("maxModeListedFor", () => {
  it("is false without a model, without metadata, or with invalid metadata", () => {
    expect(maxModeListedFor(null, chat("high", "fast"))).toBe(false);
    expect(maxModeListedFor(row({}), chat("high", "fast"))).toBe(false);
    expect(
      maxModeListedFor(
        row({ maxMode: { chat: "x", judge: [], fastServiceTierId: null } }),
        chat("high", "fast"),
      ),
    ).toBe(false);
    expect(
      maxModeListedFor(row({ maxMode: { chat: [], judge: [] } }), {
        kind: "judge",
        reasoningEffort: null,
      }),
    ).toBe(false);
  });

  it("is false for the none context and for an unknown chat tuple", () => {
    expect(maxModeListedFor(MIXED, { kind: "none" })).toBe(false);
    expect(maxModeListedFor(MIXED, { kind: "chat", tuple: null })).toBe(false);
  });

  it("keys chat on effort and Fast together", () => {
    expect(maxModeListedFor(MIXED, chat("high", "fast"))).toBe(true);
    expect(maxModeListedFor(MIXED, chat("high", null))).toBe(false);
    expect(maxModeListedFor(MIXED, chat("low", "fast"))).toBe(false);
  });

  it("answers differently for chat and judge on the same row", () => {
    expect(maxModeListedFor(MIXED, chat("high", null))).toBe(false);
    expect(
      maxModeListedFor(MIXED, { kind: "judge", reasoningEffort: "high" }),
    ).toBe(true);
    expect(
      maxModeListedFor(MIXED, { kind: "judge", reasoningEffort: null }),
    ).toBe(true);
    expect(
      maxModeListedFor(MIXED, { kind: "judge", reasoningEffort: "low" }),
    ).toBe(false);
  });

  it("treats an effort the row does not advertise as null", () => {
    expect(
      maxModeListedFor(MIXED, { kind: "judge", reasoningEffort: "bogus" }),
    ).toBe(true);
    const nullChat = row({
      maxMode: {
        chat: [{ reasoningEffort: null, fast: false }],
        judge: [],
        fastServiceTierId: null,
      },
    });
    expect(maxModeListedFor(nullChat, chat("bogus", null))).toBe(true);
    expect(maxModeListedFor(nullChat, chat(null, null))).toBe(true);
    expect(maxModeListedFor(nullChat, chat("high", null))).toBe(false);
  });

  it.each([
    [" fast ", true],
    ["fast", true],
    ["   ", false],
    ["", false],
    ["FAST", false],
    [null, false],
  ])("Fast preference %j keys as Fast=%s", (serviceTier, isFast) => {
    const fastRow = row({
      maxMode: {
        chat: [{ reasoningEffort: "high", fast: true }],
        judge: [],
        fastServiceTierId: "fast",
      },
    });
    expect(maxModeListedFor(fastRow, chat("high", serviceTier))).toBe(isFast);
  });

  it("never keys Fast on a row whose fastServiceTierId is null", () => {
    const noFast = row({
      maxMode: {
        chat: [{ reasoningEffort: "high", fast: true }],
        judge: [],
        fastServiceTierId: null,
      },
    });
    expect(maxModeListedFor(noFast, chat("high", "fast"))).toBe(false);
    expect(maxModeListedFor(noFast, chat("high", null))).toBe(false);
  });

  it("does not mutate the tuple it reads", () => {
    const tuple = { reasoningEffort: "high", serviceTier: " fast " };
    maxModeListedFor(MIXED, { kind: "chat", tuple });
    expect(tuple).toEqual({ reasoningEffort: "high", serviceTier: " fast " });
  });
});

describe("maxModeOnlyRow", () => {
  const allChat = (fastValues: ReadonlyArray<boolean>) =>
    [null, "low", "medium", "high"].flatMap((reasoningEffort) =>
      fastValues.map((fast) => ({ reasoningEffort, fast })),
    );

  it("is true only when every offered chat key is listed", () => {
    const full = row({
      maxMode: {
        chat: allChat([false, true]),
        judge: [],
        fastServiceTierId: "fast",
      },
    });
    expect(maxModeOnlyRow(full, "chat")).toBe(true);
    const partial = row({
      maxMode: {
        chat: allChat([false, true]).slice(1),
        judge: [],
        fastServiceTierId: "fast",
      },
    });
    expect(maxModeOnlyRow(partial, "chat")).toBe(false);
  });

  it("needs only Fast=false keys on a row without a Fast tier", () => {
    const noFast = row({
      maxMode: {
        chat: allChat([false]),
        judge: [],
        fastServiceTierId: null,
      },
    });
    expect(maxModeOnlyRow(noFast, "chat")).toBe(true);
  });

  it("checks the judge list for a judge context and nothing for none", () => {
    const judgeAll = row({
      maxMode: {
        chat: [],
        judge: [null, "low", "medium", "high"].map((reasoningEffort) => ({
          reasoningEffort,
        })),
        fastServiceTierId: null,
      },
    });
    expect(maxModeOnlyRow(judgeAll, "judge")).toBe(true);
    expect(maxModeOnlyRow(judgeAll, "chat")).toBe(false);
    expect(maxModeOnlyRow(judgeAll, "none")).toBe(false);
  });

  it("is false for missing or invalid metadata", () => {
    expect(maxModeOnlyRow(row({}), "chat")).toBe(false);
    expect(maxModeOnlyRow(row({ maxMode: 3 }), "judge")).toBe(false);
  });
});
