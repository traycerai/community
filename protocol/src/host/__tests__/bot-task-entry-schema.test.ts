import { describe, expect, it } from "vitest";
import {
  botSubscribeServerFrameSchema,
  botTaskEntrySchema,
  type BotTaskEntry,
} from "@traycer/protocol/host/bot/schemas";

const TRACKING_EVERY: BotTaskEntry = {
  taskId: "task-1",
  cadence: { kind: "every", seconds: 1800 },
  lastCheckinAt: 1_760_000_000_000,
  nextAt: 1_760_001_800_000,
  state: "tracking",
  endedReason: null,
};

const TRACKING_ON_COMPLETION: BotTaskEntry = {
  taskId: "task-2",
  cadence: { kind: "on-completion" },
  lastCheckinAt: null,
  nextAt: null,
  state: "tracking",
  endedReason: null,
};

function issuePaths(entry: BotTaskEntry): string[] {
  const parsed = botTaskEntrySchema.safeParse(entry);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => issue.path.join("."));
}

describe("host bot.subscribe botTaskEntrySchema invariants", () => {
  it("accepts a tracking every entry with a due time", () => {
    expect(botTaskEntrySchema.safeParse(TRACKING_EVERY).success).toBe(true);
  });

  it("accepts a tracking on-completion entry with no due time", () => {
    expect(botTaskEntrySchema.safeParse(TRACKING_ON_COMPLETION).success).toBe(
      true,
    );
  });

  it("accepts a tracking every entry whose due time is null", () => {
    expect(
      botTaskEntrySchema.safeParse({ ...TRACKING_EVERY, nextAt: null }).success,
    ).toBe(true);
  });

  it("accepts an entry the bot ended, with its reason and no due time", () => {
    expect(
      botTaskEntrySchema.safeParse({
        ...TRACKING_ON_COMPLETION,
        cadence: { kind: "none" },
        state: "ended",
        endedReason: "by-bot",
      }).success,
    ).toBe(true);
  });

  it("accepts an entry ended because its task was deleted", () => {
    expect(
      botTaskEntrySchema.safeParse({
        ...TRACKING_EVERY,
        nextAt: null,
        state: "ended",
        endedReason: "deleted",
      }).success,
    ).toBe(true);
  });

  it("accepts every ended reason on an ended entry", () => {
    for (const endedReason of [
      "by-bot",
      "deleted",
      "archived",
      "completed",
    ] as const) {
      expect(
        botTaskEntrySchema.safeParse({
          ...TRACKING_EVERY,
          nextAt: null,
          state: "ended",
          endedReason,
        }).success,
      ).toBe(true);
    }
  });

  it("refuses a tracking entry that carries an ended reason", () => {
    const entry: BotTaskEntry = { ...TRACKING_EVERY, endedReason: "by-bot" };

    expect(botTaskEntrySchema.safeParse(entry).success).toBe(false);
    expect(issuePaths(entry)).toEqual(["endedReason"]);
  });

  it("refuses an ended entry that has no ended reason", () => {
    const entry: BotTaskEntry = {
      ...TRACKING_EVERY,
      nextAt: null,
      state: "ended",
      endedReason: null,
    };

    expect(botTaskEntrySchema.safeParse(entry).success).toBe(false);
    expect(issuePaths(entry)).toEqual(["endedReason"]);
  });

  it("refuses an on-completion entry that has a due time", () => {
    const entry: BotTaskEntry = { ...TRACKING_ON_COMPLETION, nextAt: 5 };

    expect(botTaskEntrySchema.safeParse(entry).success).toBe(false);
    expect(issuePaths(entry)).toEqual(["nextAt"]);
  });

  it("refuses a none entry that has a due time", () => {
    const entry: BotTaskEntry = {
      ...TRACKING_ON_COMPLETION,
      cadence: { kind: "none" },
      nextAt: 5,
      state: "ended",
      endedReason: "by-bot",
    };

    expect(botTaskEntrySchema.safeParse(entry).success).toBe(false);
    expect(issuePaths(entry)).toEqual(["nextAt"]);
  });

  it("refuses an ended entry that still has a due time on a non-periodic cadence", () => {
    const entry: BotTaskEntry = {
      ...TRACKING_ON_COMPLETION,
      nextAt: 5,
      state: "ended",
      endedReason: "completed",
    };

    expect(issuePaths(entry)).toEqual(["nextAt"]);
  });

  it("reports both contradictions of an entry that has both", () => {
    const entry: BotTaskEntry = {
      ...TRACKING_ON_COMPLETION,
      nextAt: 5,
      endedReason: "by-bot",
    };

    expect(issuePaths(entry).sort()).toEqual(["endedReason", "nextAt"]);
  });

  it("still refuses an empty task id before it reaches the invariants", () => {
    expect(
      botTaskEntrySchema.safeParse({ ...TRACKING_EVERY, taskId: "" }).success,
    ).toBe(false);
  });
});

function snapshotFrame(tasks: readonly BotTaskEntry[]): {
  readonly kind: "snapshot";
  readonly bot: object;
  readonly tasks: readonly BotTaskEntry[];
  readonly openRequestCount: number;
  readonly boundHost: object;
  readonly hasBinaryPayload: false;
} {
  return {
    kind: "snapshot",
    bot: {
      botId: "bot_01HZX5Y8K3M2N4P6Q7R8S9T0V1",
      environmentId: "env-1",
      ownerUserId: "owner-1",
      title: "Nightly triage",
      harness: "claude",
      model: "claude-opus-5-5",
      effort: null,
      profile: null,
      trunkChatId: "trunk-1",
      boundHostId: "host-1",
      hostEpoch: 0,
      createdAt: 1_760_000_000_000,
      archivedAt: null,
    },
    tasks,
    openRequestCount: 0,
    boundHost: { hostId: "host-1", epoch: 0, isThisHost: true },
    hasBinaryPayload: false,
  };
}

describe("the bot.subscribe snapshot frame's task list", () => {
  it("accepts a snapshot whose tasks are consistent", () => {
    expect(
      botSubscribeServerFrameSchema.safeParse(
        snapshotFrame([TRACKING_EVERY, TRACKING_ON_COMPLETION]),
      ).success,
    ).toBe(true);
  });

  it("refuses a snapshot that lists a contradictory task", () => {
    expect(
      botSubscribeServerFrameSchema.safeParse(
        snapshotFrame([{ ...TRACKING_EVERY, endedReason: "by-bot" }]),
      ).success,
    ).toBe(false);
    expect(
      botSubscribeServerFrameSchema.safeParse(
        snapshotFrame([{ ...TRACKING_ON_COMPLETION, nextAt: 5 }]),
      ).success,
    ).toBe(false);
  });
});
