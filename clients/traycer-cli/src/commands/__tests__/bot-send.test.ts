import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatSubscribeWindowedClientFrameSchema,
  openChatSubscribeWindowedServerFrameSchema,
  type ChatSubscribeWindowedClientFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { ChatIndexChange } from "@traycer/protocol/host/agent/gui/subscribe-windowed";
import type { BotConversationRecord } from "@traycer/protocol/host/bot/conversation-schemas";
import type { BotRecord } from "@traycer/protocol/host/bot/schemas";
import { TRANSCRIPT_RANGE_MAX_BYTES } from "@traycer/protocol/persistence/chat-transcript/read-range";
import type { RowSkeletonEntry } from "@traycer/protocol/persistence/chat-transcript/row-skeleton";
import { BOT_HOST_UPDATE_MESSAGE } from "../../internal/bot-host";
import { CLI_ERROR_CODES, CliError } from "../../runner/errors";
import type { CommandResult } from "../../runner/runner";
import {
  BOT_ID_A,
  BOT_ID_B,
  CONVERSATION_ID,
  OTHER_HOST_ID,
  REPLY_MESSAGE_ID,
  REQUEST_ID,
  THIS_HOST_ID,
  FakeStreamClient,
  type FakeStreamSession,
  assistantRow,
  botRecord,
  chatSnapshotFrame,
  conversationRecord,
  fatalClose,
  indexChangedFrame,
  makeCtx,
  rangeFrame,
  routeRpc,
  skeletonEntry,
  unsupportedRpcError,
  userRow,
} from "./bot-test-support";
import {
  buildBotSendCommand,
  firstConversation,
  parseWaitDuration,
  touchedOrdinals,
  waitForBotReply,
  type BotReplyOutcome,
} from "../bot-send";

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../logger", () => ({
  createCliLogger: () => loggerMock,
  errorFromUnknown: (value: unknown) =>
    value instanceof Error ? value : new Error(String(value)),
  noopLogger: loggerMock,
}));

const hoisted = vi.hoisted(() => ({
  callHostRpc: vi.fn(),
  resolveEndpoint: vi.fn(),
  openLocalStreamClient: vi.fn(),
}));

vi.mock("../../internal/host-rpc", async () => {
  const actual = await vi.importActual<
    typeof import("../../internal/host-rpc")
  >("../../internal/host-rpc");
  return {
    ...actual,
    callHostRpc: hoisted.callHostRpc,
    resolveEndpoint: hoisted.resolveEndpoint,
  };
});

vi.mock("../../internal/bot-host", async () => {
  const actual = await vi.importActual<
    typeof import("../../internal/bot-host")
  >("../../internal/bot-host");
  return { ...actual, openLocalStreamClient: hoisted.openLocalStreamClient };
});

const ENDPOINT = {
  hostId: THIS_HOST_ID,
  websocketUrl: "ws://127.0.0.1:9999/rpc",
};

beforeEach(() => {
  vi.resetAllMocks();
  hoisted.resolveEndpoint.mockResolvedValue(ENDPOINT);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- command: choosing the bot and conversation ------------------------- //

function stageSend(input: {
  readonly bots: readonly BotRecord[];
  readonly conversations: readonly BotConversationRecord[];
  readonly delivery: "written" | "queued";
}): void {
  hoisted.callHostRpc.mockImplementation(
    routeRpc({
      "bot.list": () => ({ bots: input.bots }),
      "bot.conversation.list": () => ({ conversations: input.conversations }),
      "bot.conversation.send": () => ({
        messageId: "msg-sent",
        requestId: REQUEST_ID,
        delivery: input.delivery,
      }),
    }),
  );
}

/** The params of every `callHostRpc(method, ...)` so far. */
function paramsOfCalls(method: string): unknown[] {
  return hoisted.callHostRpc.mock.calls
    .filter((call) => call[0] === method)
    .map((call) => call[1]);
}

function send(input: {
  readonly bot: string;
  readonly conversationId: string | null;
  readonly wait: string | null;
}): Promise<CommandResult> {
  return buildBotSendCommand({
    bot: input.bot,
    text: "ship it",
    conversationId: input.conversationId,
    wait: input.wait,
  })(makeCtx());
}

async function rejection(run: Promise<CommandResult>): Promise<CliError> {
  const error: unknown = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof CliError)) {
    throw new Error("expected the command to reject with a CliError");
  }
  return error;
}

describe("bot send", () => {
  const tracy = botRecord({ botId: BOT_ID_A, title: "Tracy" });

  it("sends into the conversation with the smallest createdAt when none is named", async () => {
    stageSend({
      bots: [tracy],
      conversations: [
        conversationRecord({ conversationId: "conv-late", createdAt: 3_000 }),
        conversationRecord({ conversationId: "conv-first", createdAt: 1_000 }),
        conversationRecord({ conversationId: "conv-mid", createdAt: 2_000 }),
      ],
      delivery: "written",
    });

    const result = await send({
      bot: BOT_ID_A,
      conversationId: null,
      wait: null,
    });

    expect(paramsOfCalls("bot.conversation.list")).toEqual([
      { botId: BOT_ID_A },
    ]);
    expect(paramsOfCalls("bot.conversation.send")).toEqual([
      { botId: BOT_ID_A, conversationId: "conv-first", text: "ship it" },
    ]);
    expect(result.human).toBe(
      `Sent to Tracy (request ${REQUEST_ID}, delivered).`,
    );
    expect(result.data).toEqual({
      botId: BOT_ID_A,
      conversationId: "conv-first",
      messageId: "msg-sent",
      requestId: REQUEST_ID,
      delivery: "written",
    });
    expect(result.exitCode).toBe(0);
    // Without --wait nothing follows the conversation.
    expect(hoisted.openLocalStreamClient).not.toHaveBeenCalled();
  });

  it("sends into the named conversation, even when it is not the first", async () => {
    stageSend({
      bots: [tracy],
      conversations: [
        conversationRecord({ conversationId: "conv-first", createdAt: 1_000 }),
        conversationRecord({ conversationId: "conv-named", createdAt: 9_000 }),
      ],
      delivery: "written",
    });

    const result = await send({
      bot: BOT_ID_A,
      conversationId: "conv-named",
      wait: null,
    });

    expect(paramsOfCalls("bot.conversation.send")).toEqual([
      { botId: BOT_ID_A, conversationId: "conv-named", text: "ship it" },
    ]);
    expect(result.data).toMatchObject({ conversationId: "conv-named" });
  });

  it("refuses a named conversation the bot does not have, and sends nothing", async () => {
    stageSend({
      bots: [tracy],
      conversations: [conversationRecord({ conversationId: "conv-first" })],
      delivery: "written",
    });

    const error = await rejection(
      send({ bot: BOT_ID_A, conversationId: "conv-nope", wait: null }),
    );

    expect(error.code).toBe(CLI_ERROR_CODES.NOT_FOUND);
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe("traycer: Tracy has no conversation conv-nope.");
    expect(paramsOfCalls("bot.conversation.send")).toEqual([]);
  });

  it("refuses a bot with no conversations, and sends nothing", async () => {
    stageSend({ bots: [tracy], conversations: [], delivery: "written" });

    const error = await rejection(
      send({ bot: BOT_ID_A, conversationId: null, wait: null }),
    );

    expect(error.code).toBe(CLI_ERROR_CODES.NOT_FOUND);
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe(
      "traycer: Tracy has no conversation yet - open it in the Traycer app first.",
    );
    expect(paramsOfCalls("bot.conversation.send")).toEqual([]);
  });

  it("says a queued message waits for the bot's host", async () => {
    stageSend({
      bots: [tracy],
      conversations: [conversationRecord({})],
      delivery: "queued",
    });

    const result = await send({
      bot: BOT_ID_A,
      conversationId: null,
      wait: null,
    });

    expect(result.human).toBe(
      `Sent to Tracy (request ${REQUEST_ID}, queued until the bot's host is back).`,
    );
    expect(result.data).toMatchObject({ delivery: "queued" });
  });

  it("finds the bot by its exact id", async () => {
    stageSend({
      bots: [
        botRecord({ botId: BOT_ID_A, title: "Tracy" }),
        botRecord({ botId: BOT_ID_B, title: "Scout" }),
      ],
      conversations: [conversationRecord({ botId: BOT_ID_B })],
      delivery: "written",
    });

    const result = await send({
      bot: BOT_ID_B,
      conversationId: null,
      wait: null,
    });

    expect(paramsOfCalls("bot.conversation.send")).toMatchObject([
      { botId: BOT_ID_B },
    ]);
    expect(result.human).toMatch(/^Sent to Scout /);
  });

  it("finds the bot by its title, ignoring case", async () => {
    stageSend({
      bots: [
        botRecord({ botId: BOT_ID_A, title: "Tracy" }),
        botRecord({ botId: BOT_ID_B, title: "Scout" }),
      ],
      conversations: [conversationRecord({})],
      delivery: "written",
    });

    const result = await send({
      bot: "sCoUt",
      conversationId: null,
      wait: null,
    });

    expect(paramsOfCalls("bot.conversation.list")).toEqual([
      { botId: BOT_ID_B },
    ]);
    expect(result.human).toMatch(/^Sent to Scout /);
  });

  it("refuses an ambiguous title and lists both ids", async () => {
    stageSend({
      bots: [
        botRecord({ botId: BOT_ID_A, title: "Twin" }),
        botRecord({ botId: BOT_ID_B, title: "twin" }),
      ],
      conversations: [conversationRecord({})],
      delivery: "written",
    });

    const error = await rejection(
      send({ bot: "TWIN", conversationId: null, wait: null }),
    );

    expect(error.code).toBe(CLI_ERROR_CODES.INVALID_ARGUMENT);
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe(
      `traycer: more than one bot is called 'TWIN' - name it by id: ${BOT_ID_A}, ${BOT_ID_B}.`,
    );
    expect(paramsOfCalls("bot.conversation.send")).toEqual([]);
  });

  it("refuses a bot nobody has by that name", async () => {
    stageSend({ bots: [tracy], conversations: [], delivery: "written" });

    const error = await rejection(
      send({ bot: "Nobody", conversationId: null, wait: null }),
    );

    expect(error.code).toBe(CLI_ERROR_CODES.NOT_FOUND);
    expect(error.message).toBe(
      "traycer: no bot called 'Nobody' - run `traycer bot list` to see yours.",
    );
    expect(paramsOfCalls("bot.conversation.send")).toEqual([]);
  });

  it("rejects an invalid --wait before any host call", async () => {
    stageSend({ bots: [tracy], conversations: [], delivery: "written" });

    const error = await rejection(
      send({ bot: BOT_ID_A, conversationId: null, wait: "5" }),
    );

    expect(error.code).toBe(CLI_ERROR_CODES.INVALID_ARGUMENT);
    expect(hoisted.callHostRpc).not.toHaveBeenCalled();
  });
});

describe("bot send --wait on a bot bound to another host", () => {
  it("refuses with the exact copy and never calls bot.conversation.send", async () => {
    const away = botRecord({
      botId: BOT_ID_A,
      title: "Tracy",
      boundHostId: OTHER_HOST_ID,
    });
    stageSend({
      bots: [away],
      conversations: [conversationRecord({})],
      delivery: "queued",
    });

    const error = await rejection(
      send({ bot: BOT_ID_A, conversationId: null, wait: "30s" }),
    );

    expect(error.code).toBe(CLI_ERROR_CODES.INVALID_ARGUMENT);
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe(
      "traycer: Tracy runs on another of your hosts; --wait works only there. Send without --wait to queue it.",
    );
    expect(paramsOfCalls("bot.conversation.send")).toEqual([]);
    expect(hoisted.openLocalStreamClient).not.toHaveBeenCalled();
  });

  it("still sends without --wait, queued for the bot's host", async () => {
    const away = botRecord({ botId: BOT_ID_A, boundHostId: OTHER_HOST_ID });
    stageSend({
      bots: [away],
      conversations: [conversationRecord({})],
      delivery: "queued",
    });

    const result = await send({
      bot: BOT_ID_A,
      conversationId: null,
      wait: null,
    });

    expect(paramsOfCalls("bot.conversation.send")).toHaveLength(1);
    expect(result.exitCode).toBe(0);
  });
});

describe("bot send on a host without bots", () => {
  it.each(["bot.list", "bot.conversation.list", "bot.conversation.send"])(
    "rejects with the update message when %s is unsupported",
    async (missing) => {
      hoisted.callHostRpc.mockImplementation(
        routeRpc({
          "bot.list": () => {
            if (missing === "bot.list") throw unsupportedRpcError(missing);
            return { bots: [botRecord({ botId: BOT_ID_A })] };
          },
          "bot.conversation.list": () => {
            if (missing === "bot.conversation.list") {
              throw unsupportedRpcError(missing);
            }
            return { conversations: [conversationRecord({})] };
          },
          "bot.conversation.send": () => {
            throw unsupportedRpcError(missing);
          },
        }),
      );

      const error = await rejection(
        send({ bot: BOT_ID_A, conversationId: null, wait: null }),
      );

      expect(error.message).toBe(BOT_HOST_UPDATE_MESSAGE);
      expect(error.code).toBe(CLI_ERROR_CODES.HOST_UNSUPPORTED);
      expect(error.exitCode).toBe(1);
    },
  );
});

// ---- command: --wait, end to end ---------------------------------------- //

/** Starts a `--wait` run and returns once it is following the conversation. */
async function startWaitingSend(wait: string): Promise<{
  readonly run: Promise<CommandResult>;
  readonly client: FakeStreamClient;
  readonly session: FakeStreamSession;
}> {
  stageSend({
    bots: [botRecord({ botId: BOT_ID_A, title: "Tracy" })],
    conversations: [conversationRecord({ conversationId: CONVERSATION_ID })],
    delivery: "written",
  });
  const client = new FakeStreamClient(() => undefined);
  hoisted.openLocalStreamClient.mockResolvedValue({
    client,
    endpoint: ENDPOINT,
  });
  const run = send({ bot: BOT_ID_A, conversationId: null, wait });
  // Let the command get through its RPCs and subscribe.
  await vi.advanceTimersByTimeAsync(0);
  const session = client.sessions[0];
  if (session === undefined) throw new Error("the command never subscribed");
  return { run, client, session };
}

function resolvedSnapshot(
  resolvedBy: string | null,
  extraRows: readonly Record<string, unknown>[],
) {
  return chatSnapshotFrame({
    botId: BOT_ID_A,
    conversationId: CONVERSATION_ID,
    epoch: 1,
    rowCount: 1 + extraRows.length,
    tailFromOrdinal: 0,
    messages: [
      userRow({
        messageId: "msg-sent",
        requestId: REQUEST_ID,
        resolvedAt: 5_000,
        resolvedByMessageId: resolvedBy,
      }),
      ...extraRows,
    ],
  });
}

describe("bot send --wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("prints the reply and exits 0 once the request is resolved", async () => {
    const { run, client, session } = await startWaitingSend("30s");

    expect(session.method).toBe("chat.subscribe");
    expect(session.params).toEqual({
      epicId: BOT_ID_A,
      chatId: CONVERSATION_ID,
      resume: null,
    });
    session.pushFrame(
      resolvedSnapshot(REPLY_MESSAGE_ID, [
        assistantRow({
          messageId: REPLY_MESSAGE_ID,
          texts: ["All shipped."],
        }),
      ]),
    );
    const result = await run;

    expect(result.human).toBe(
      `Sent to Tracy (request ${REQUEST_ID}, delivered).\nTracy replied:\nAll shipped.`,
    );
    expect(result.data).toEqual({
      botId: BOT_ID_A,
      conversationId: CONVERSATION_ID,
      messageId: "msg-sent",
      requestId: REQUEST_ID,
      delivery: "written",
      outcome: {
        kind: "replied",
        replyMessageId: REPLY_MESSAGE_ID,
        text: "All shipped.",
      },
    });
    expect(result.exitCode).toBe(0);
    expect(session.closeCount).toBe(1);
    expect(client.closeReasons).toEqual(["bot-send-wait-settled"]);
  });

  it("names the reply message when its text could not be read back", async () => {
    const { run, session } = await startWaitingSend("30s");

    session.pushFrame(resolvedSnapshot(REPLY_MESSAGE_ID, []));
    // The reply row is unseen: the command asks for a fresh snapshot, which
    // also lacks it.
    session.pushFrame(resolvedSnapshot(REPLY_MESSAGE_ID, []));
    const result = await run;

    expect(result.human).toBe(
      `Sent to Tracy (request ${REQUEST_ID}, delivered).\nTracy replied (message ${REPLY_MESSAGE_ID}).`,
    );
    expect(result.data).toMatchObject({
      outcome: {
        kind: "replied",
        replyMessageId: REPLY_MESSAGE_ID,
        text: null,
      },
    });
    expect(result.exitCode).toBe(0);
  });

  it("says the bot closed the request without a reply, and exits 0", async () => {
    const { run, session } = await startWaitingSend("30s");

    session.pushFrame(resolvedSnapshot(null, []));
    const result = await run;

    expect(result.human).toBe(
      `Sent to Tracy (request ${REQUEST_ID}, delivered).\nTracy closed the request without a reply.`,
    );
    expect(result.data).toMatchObject({
      outcome: { kind: "resolved-without-reply" },
    });
    expect(result.exitCode).toBe(0);
  });

  it("exits 1 and leaves the request open when the wait runs out", async () => {
    const { run, client, session } = await startWaitingSend("30s");

    await vi.advanceTimersByTimeAsync(30_000);
    const result = await run;

    expect(result.human).toBe(
      `Sent to Tracy (request ${REQUEST_ID}, delivered).\nNo reply from Tracy within 30s. The request stays open.`,
    );
    expect(result.data).toMatchObject({ outcome: { kind: "timed-out" } });
    expect(result.exitCode).toBe(1);
    expect(session.closeCount).toBe(1);
    expect(client.closeReasons).toEqual(["bot-send-wait-settled"]);
  });

  it("closes the stream client when following the conversation fails", async () => {
    const { run, client, session } = await startWaitingSend("30s");

    session.pushStatus(
      "closed",
      fatalClose({
        code: "INTERNAL",
        reason: "host blew up",
        incompatibleMethod: null,
      }),
    );

    const error = await rejection(run);
    expect(error.code).toBe(CLI_ERROR_CODES.HOST_UNREACHABLE);
    expect(client.closeReasons).toEqual(["bot-send-wait-settled"]);
  });
});

// ---- the pure helpers --------------------------------------------------- //

describe("firstConversation", () => {
  it("is null for no conversations", () => {
    expect(firstConversation([])).toBeNull();
  });

  it("picks the smallest createdAt wherever it sits in the list", () => {
    const early = conversationRecord({
      conversationId: "early",
      createdAt: 10,
    });
    const middle = conversationRecord({
      conversationId: "middle",
      createdAt: 20,
    });
    const late = conversationRecord({ conversationId: "late", createdAt: 30 });

    expect(firstConversation([late, early, middle])).toBe(early);
    expect(firstConversation([early, middle, late])).toBe(early);
    expect(firstConversation([middle, late, early])).toBe(early);
  });

  it("keeps the earlier-listed one on a tie", () => {
    const one = conversationRecord({ conversationId: "one", createdAt: 10 });
    const two = conversationRecord({ conversationId: "two", createdAt: 10 });

    expect(firstConversation([one, two])).toBe(one);
  });
});

describe("parseWaitDuration", () => {
  it.each([
    { value: "30s", ms: 30_000 },
    { value: "5m", ms: 300_000 },
    { value: "2h", ms: 7_200_000 },
    { value: "  45s  ", ms: 45_000 },
    // The largest whole hours that still fit one timer (2^31 - 1 ms).
    { value: "596h", ms: 2_145_600_000 },
  ])("accepts '$value' as $ms ms", ({ value, ms }) => {
    expect(parseWaitDuration(value)).toBe(ms);
  });

  it.each([
    "0s",
    "0m",
    "5",
    "5d",
    "-1m",
    "",
    "s",
    "1.5h",
    "30 s",
    "1w",
    // One hour past the largest timer.
    "597h",
    "2147484s",
    "9".repeat(400) + "h",
  ])("rejects %j with the duration message", (value) => {
    let thrown: unknown = null;
    try {
      parseWaitDuration(value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CliError);
    if (!(thrown instanceof CliError)) return;
    expect(thrown.code).toBe(CLI_ERROR_CODES.INVALID_ARGUMENT);
    expect(thrown.exitCode).toBe(1);
    expect(thrown.message).toBe(
      "traycer: --wait takes a duration such as 30s, 5m or 2h (at most 24 days).",
    );
  });
});

function skeleton(rowId: string): RowSkeletonEntry {
  return {
    rowId,
    createdAt: 1_000,
    role: "user",
    byteLength: 10,
    bodyDigest: `digest-${rowId}`,
  };
}

function appended(count: number): ChatIndexChange {
  return {
    type: "appended",
    entries: Array.from({ length: count }, (_, index) =>
      skeleton(`new-${index}`),
    ),
  };
}

function updated(...ordinals: readonly number[]): ChatIndexChange {
  return {
    type: "updated",
    entries: ordinals.map((ordinal) => ({
      ordinal,
      entry: skeleton(`row-${ordinal}`),
    })),
  };
}

const reindexed: ChatIndexChange = { type: "reindexed" };

describe("touchedOrdinals", () => {
  it("spans the appended rows at the end of the index", () => {
    expect(touchedOrdinals([appended(3)], 10)).toEqual({ from: 7, to: 9 });
  });

  it("spans the updated ordinals, whatever order they come in", () => {
    expect(touchedOrdinals([updated(4, 2, 3)], 10)).toEqual({
      from: 2,
      to: 4,
    });
  });

  it("covers an updated row and the appended rows in one inclusive span", () => {
    expect(touchedOrdinals([updated(3), appended(2)], 10)).toEqual({
      from: 3,
      to: 9,
    });
  });

  it("adds the rows of several appended changes", () => {
    expect(touchedOrdinals([appended(1), appended(2)], 10)).toEqual({
      from: 7,
      to: 9,
    });
  });

  it("is a single ordinal for one appended row", () => {
    expect(touchedOrdinals([appended(1)], 5)).toEqual({ from: 4, to: 4 });
  });

  it("never starts below ordinal 0", () => {
    expect(touchedOrdinals([appended(3)], 1)).toEqual({ from: 0, to: 0 });
  });

  it.each([
    { name: "no changes", changes: [] },
    { name: "a reindex alone", changes: [reindexed] },
    { name: "an appended change with no entries", changes: [appended(0)] },
    { name: "an updated change with no entries", changes: [updated()] },
  ])("is null for $name", ({ changes }) => {
    expect(touchedOrdinals(changes, 10)).toBeNull();
  });
});

// ---- waitForBotReply, driven frame by frame ------------------------------ //

function sentFrames(
  session: FakeStreamSession,
): ChatSubscribeWindowedClientFrame[] {
  return session.sent.map((frame) =>
    chatSubscribeWindowedClientFrameSchema.parse(frame),
  );
}

function loadRanges(session: FakeStreamSession) {
  return sentFrames(session).flatMap((frame) =>
    frame.kind === "loadRange" ? [frame.request] : [],
  );
}

function resnapshots(session: FakeStreamSession) {
  return sentFrames(session).filter((frame) => frame.kind === "resnapshot");
}

function startWait(timeoutMs: number): {
  readonly session: FakeStreamSession;
  readonly outcome: Promise<BotReplyOutcome>;
  readonly settled: () => boolean;
} {
  const client = new FakeStreamClient(() => undefined);
  let done = false;
  const outcome = waitForBotReply({
    client,
    botId: BOT_ID_A,
    conversationId: CONVERSATION_ID,
    requestId: REQUEST_ID,
    timeoutMs,
  }).finally(() => {
    done = true;
  });
  const session = client.sessions[0];
  if (session === undefined)
    throw new Error("waitForBotReply never subscribed");
  return { session, outcome, settled: () => done };
}

const openUserRow = userRow({
  messageId: "msg-sent",
  requestId: REQUEST_ID,
  resolvedAt: null,
  resolvedByMessageId: null,
});

function resolvedUserRow(resolvedByMessageId: string | null) {
  return userRow({
    messageId: "msg-sent",
    requestId: REQUEST_ID,
    resolvedAt: 5_000,
    resolvedByMessageId,
  });
}

const replyRow = assistantRow({
  messageId: REPLY_MESSAGE_ID,
  texts: ["Hello", "", "world"],
});

function snapshotOf(
  messages: readonly Record<string, unknown>[],
  epoch: number,
) {
  return chatSnapshotFrame({
    botId: BOT_ID_A,
    conversationId: CONVERSATION_ID,
    epoch,
    rowCount: messages.length,
    tailFromOrdinal: 0,
    messages,
  });
}

describe("fixtures", () => {
  it("are accepted by the real windowed chat.subscribe schema", () => {
    const frames = [
      snapshotOf([resolvedUserRow(REPLY_MESSAGE_ID), replyRow], 3),
      indexChangedFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        epoch: 3,
        rowCount: 4,
        indexRevision: 1,
        changes: [
          { type: "appended", entries: [skeletonEntry("r3", "assistant")] },
          {
            type: "updated",
            entries: [{ ordinal: 1, entry: skeletonEntry("r1", "user") }],
          },
          { type: "reindexed" },
        ],
      }),
      rangeFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        requestId: "range-1",
        epoch: 3,
        fromOrdinal: 0,
        rowIds: ["r0", "r1"],
        messages: [resolvedUserRow(REPLY_MESSAGE_ID), replyRow],
        truncatedAtOrdinal: 1,
      }),
    ];

    for (const frame of frames) {
      expect(
        openChatSubscribeWindowedServerFrameSchema.safeParse(frame),
      ).toMatchObject({ success: true });
    }
  });
});

describe("waitForBotReply", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("follows the conversation the request was sent into", () => {
    const { session } = startWait(60_000);

    expect(session.method).toBe("chat.subscribe");
    expect(session.params).toEqual({
      epicId: BOT_ID_A,
      chatId: CONVERSATION_ID,
      resume: null,
    });
    expect(session.sent).toEqual([]);
  });

  it("replies from the snapshot tail when the request is resolved and the reply row is there", async () => {
    const { session, outcome } = startWait(60_000);

    session.pushFrame(
      snapshotOf([resolvedUserRow(REPLY_MESSAGE_ID), replyRow], 1),
    );

    // Text blocks join with a newline; an empty block adds nothing.
    await expect(outcome).resolves.toEqual({
      kind: "replied",
      replyMessageId: REPLY_MESSAGE_ID,
      text: "Hello\nworld",
    });
    expect(session.closeCount).toBe(1);
    expect(session.sent).toEqual([]);
  });

  it("reads the reply row even when it sits before the resolved user row", async () => {
    const { session, outcome } = startWait(60_000);

    session.pushFrame(
      snapshotOf([replyRow, resolvedUserRow(REPLY_MESSAGE_ID)], 1),
    );

    await expect(outcome).resolves.toMatchObject({
      kind: "replied",
      text: "Hello\nworld",
    });
  });

  it("reports resolved-without-reply when the request names no reply message", async () => {
    const { session, outcome } = startWait(60_000);

    session.pushFrame(snapshotOf([resolvedUserRow(null)], 1));

    await expect(outcome).resolves.toEqual({ kind: "resolved-without-reply" });
    expect(session.closeCount).toBe(1);
    expect(session.sent).toEqual([]);
  });

  it("keeps waiting while the request is open, and while another request is the resolved one", async () => {
    const { session, outcome, settled } = startWait(60_000);
    const otherResolved = userRow({
      messageId: "msg-other",
      requestId: "req-other",
      resolvedAt: 5_000,
      resolvedByMessageId: REPLY_MESSAGE_ID,
    });

    session.pushFrame(snapshotOf([otherResolved, openUserRow, replyRow], 1));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(settled()).toBe(false);
    expect(session.closeCount).toBe(0);
    expect(session.sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(outcome).resolves.toEqual({ kind: "timed-out" });
  });

  it("asks for one loadRange over the updated and appended rows, and settles on the range answer", async () => {
    const { session, outcome } = startWait(60_000);
    session.pushFrame(snapshotOf([openUserRow], 4));

    session.pushFrame(
      indexChangedFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        epoch: 4,
        rowCount: 4,
        indexRevision: 1,
        changes: [
          {
            type: "updated",
            entries: [{ ordinal: 1, entry: skeletonEntry("r1", "user") }],
          },
          {
            type: "appended",
            entries: [
              skeletonEntry("r2", "assistant"),
              skeletonEntry("r3", "assistant"),
            ],
          },
        ],
      }),
    );

    // updated ordinal 1, appended rows 2..3 of a 4-row index: 1..3 inclusive.
    const asked = loadRanges(session);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      epoch: 4,
      fromOrdinal: 1,
      toOrdinal: 3,
      maxBytes: TRANSCRIPT_RANGE_MAX_BYTES,
    });
    expect(session.sent).toHaveLength(1);
    expect(session.closeCount).toBe(0);

    session.pushFrame(
      rangeFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        requestId: asked[0].requestId,
        epoch: 4,
        fromOrdinal: 1,
        rowIds: ["r1", "r2", "r3"],
        messages: [resolvedUserRow(REPLY_MESSAGE_ID), replyRow],
        truncatedAtOrdinal: null,
      }),
    );

    await expect(outcome).resolves.toEqual({
      kind: "replied",
      replyMessageId: REPLY_MESSAGE_ID,
      text: "Hello\nworld",
    });
    expect(session.closeCount).toBe(1);
    // The answer arrived whole: nothing more was asked for.
    expect(session.sent).toHaveLength(1);
  });

  it("asks for the remainder when a range stops early at truncatedAtOrdinal", async () => {
    const { session, outcome } = startWait(60_000);
    session.pushFrame(snapshotOf([openUserRow], 4));
    session.pushFrame(
      indexChangedFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        epoch: 4,
        rowCount: 6,
        indexRevision: 1,
        changes: [
          {
            type: "appended",
            entries: [1, 2, 3, 4, 5].map((n) =>
              skeletonEntry(`r${n}`, "assistant"),
            ),
          },
        ],
      }),
    );
    const [first] = loadRanges(session);
    expect(first).toMatchObject({ fromOrdinal: 1, toOrdinal: 5 });

    session.pushFrame(
      rangeFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        requestId: first.requestId,
        epoch: 4,
        fromOrdinal: 1,
        rowIds: ["r1", "r2"],
        messages: [],
        truncatedAtOrdinal: 3,
      }),
    );

    const afterTruncation = loadRanges(session);
    expect(afterTruncation).toHaveLength(2);
    expect(afterTruncation[1]).toMatchObject({
      epoch: 4,
      fromOrdinal: 3,
      toOrdinal: 5,
      maxBytes: TRANSCRIPT_RANGE_MAX_BYTES,
    });
    expect(afterTruncation[1].requestId).not.toBe(first.requestId);

    // A repeat of the answered range asks for nothing more.
    session.pushFrame(
      rangeFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        requestId: first.requestId,
        epoch: 4,
        fromOrdinal: 1,
        rowIds: ["r1", "r2"],
        messages: [],
        truncatedAtOrdinal: 3,
      }),
    );
    expect(loadRanges(session)).toHaveLength(2);

    session.pushFrame(
      rangeFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        requestId: afterTruncation[1].requestId,
        epoch: 4,
        fromOrdinal: 3,
        rowIds: ["r3", "r4", "r5"],
        messages: [resolvedUserRow(null)],
        truncatedAtOrdinal: null,
      }),
    );
    await expect(outcome).resolves.toEqual({ kind: "resolved-without-reply" });
  });

  it("asks for a fresh snapshot, and no range, when the index was reindexed", async () => {
    const { session, settled } = startWait(60_000);
    session.pushFrame(snapshotOf([openUserRow], 4));

    session.pushFrame(
      indexChangedFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        epoch: 5,
        rowCount: 3,
        indexRevision: 1,
        // A reindex among other changes still wins: their ordinals are stale.
        changes: [
          { type: "appended", entries: [skeletonEntry("r2", "assistant")] },
          { type: "reindexed" },
        ],
      }),
    );

    expect(sentFrames(session)).toEqual([
      {
        kind: "resnapshot",
        hasBinaryPayload: false,
        epicId: BOT_ID_A,
        chatId: CONVERSATION_ID,
      },
    ]);
    expect(loadRanges(session)).toEqual([]);
    expect(settled()).toBe(false);
  });

  it("asks for nothing when an index change touches no row", () => {
    const { session } = startWait(60_000);
    session.pushFrame(snapshotOf([openUserRow], 4));

    session.pushFrame(
      indexChangedFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        epoch: 4,
        rowCount: 1,
        indexRevision: 1,
        changes: [],
      }),
    );

    expect(session.sent).toEqual([]);
  });

  it("asks once for a fresh snapshot when the reply row was not read, then reports its id without text", async () => {
    const { session, outcome, settled } = startWait(60_000);

    session.pushFrame(snapshotOf([resolvedUserRow(REPLY_MESSAGE_ID)], 1));
    await vi.advanceTimersByTimeAsync(0);

    expect(resnapshots(session)).toHaveLength(1);
    expect(session.sent).toHaveLength(1);
    expect(settled()).toBe(false);
    expect(session.closeCount).toBe(0);

    // The fresh snapshot's tail does not hold the reply row either.
    session.pushFrame(snapshotOf([resolvedUserRow(REPLY_MESSAGE_ID)], 1));

    await expect(outcome).resolves.toEqual({
      kind: "replied",
      replyMessageId: REPLY_MESSAGE_ID,
      text: null,
    });
    expect(session.sent).toHaveLength(1);
    expect(session.closeCount).toBe(1);
  });

  it("reports the reply text when the fresh snapshot does hold the reply row", async () => {
    const { session, outcome } = startWait(60_000);

    session.pushFrame(snapshotOf([resolvedUserRow(REPLY_MESSAGE_ID)], 1));
    session.pushFrame(
      snapshotOf([resolvedUserRow(REPLY_MESSAGE_ID), replyRow], 1),
    );

    await expect(outcome).resolves.toEqual({
      kind: "replied",
      replyMessageId: REPLY_MESSAGE_ID,
      text: "Hello\nworld",
    });
    expect(resnapshots(session)).toHaveLength(1);
  });

  it("does not settle on a range that resolves the request without the reply row", async () => {
    const { session, outcome, settled } = startWait(60_000);
    session.pushFrame(snapshotOf([openUserRow], 4));
    session.pushFrame(
      indexChangedFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        epoch: 4,
        rowCount: 2,
        indexRevision: 1,
        changes: [
          { type: "appended", entries: [skeletonEntry("r1", "assistant")] },
        ],
      }),
    );
    const [asked] = loadRanges(session);

    session.pushFrame(
      rangeFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        requestId: asked.requestId,
        epoch: 4,
        fromOrdinal: 1,
        rowIds: ["r1"],
        messages: [resolvedUserRow(REPLY_MESSAGE_ID)],
        truncatedAtOrdinal: null,
      }),
    );

    // Only a snapshot may report the id without text: a range is asked for
    // its rows, and the reply may still be on its way.
    expect(resnapshots(session)).toHaveLength(1);
    expect(settled()).toBe(false);

    session.pushFrame(snapshotOf([resolvedUserRow(REPLY_MESSAGE_ID)], 4));
    await expect(outcome).resolves.toEqual({
      kind: "replied",
      replyMessageId: REPLY_MESSAGE_ID,
      text: null,
    });
  });

  it("times out after exactly the wait, leaves the request open, and closes the session", async () => {
    const { session, outcome, settled } = startWait(30_000);
    session.pushFrame(snapshotOf([openUserRow], 1));

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled()).toBe(false);
    expect(session.closeCount).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toEqual({ kind: "timed-out" });
    expect(session.closeCount).toBe(1);
  });

  it("rejects with E_HOST_UNREACHABLE on a fatal close, and closes the session", async () => {
    const { session, outcome } = startWait(60_000);

    session.pushStatus(
      "closed",
      fatalClose({
        code: "INTERNAL",
        reason: "lost the host",
        incompatibleMethod: null,
      }),
    );

    await expect(outcome).rejects.toMatchObject({
      code: CLI_ERROR_CODES.HOST_UNREACHABLE,
      exitCode: 1,
      message:
        "traycer: stopped following the conversation - lost the host. The message was sent; the request stays open.",
    });
    expect(session.closeCount).toBe(1);
  });

  it("rides out a reconnect or a caller close and stays bounded by the timeout", async () => {
    const { session, outcome, settled } = startWait(30_000);

    session.pushStatus("reconnecting", null);
    session.pushStatus("closed", { kind: "caller" });
    session.pushStatus("open", null);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(20_000);
    await expect(outcome).resolves.toEqual({ kind: "timed-out" });
  });

  it("rejects with E_HOST_INCOMPATIBLE on a row-bearing frame it cannot read", async () => {
    const { session, outcome } = startWait(60_000);

    session.pushFrame({
      kind: "snapshot",
      hasBinaryPayload: false,
      epicId: BOT_ID_A,
      chatId: CONVERSATION_ID,
      snapshot: { rowCount: "many" },
    });

    await expect(outcome).rejects.toMatchObject({
      code: CLI_ERROR_CODES.HOST_INCOMPATIBLE,
      exitCode: 1,
    });
    expect(session.closeCount).toBe(1);
  });

  it("ignores a frame it cannot read that carries no rows", async () => {
    const { session, outcome, settled } = startWait(30_000);

    session.pushFrame({ kind: "turnStateChanged", hasBinaryPayload: false });
    session.pushFrame({ kind: "somethingNew", hasBinaryPayload: false });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(settled()).toBe(false);
    expect(session.sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(outcome).resolves.toEqual({ kind: "timed-out" });
  });

  it("settles once: later frames, status changes and the timer do nothing", async () => {
    const { session, outcome } = startWait(30_000);
    session.pushFrame(snapshotOf([resolvedUserRow(null)], 1));
    await expect(outcome).resolves.toEqual({ kind: "resolved-without-reply" });

    session.pushFrame(
      indexChangedFrame({
        botId: BOT_ID_A,
        conversationId: CONVERSATION_ID,
        epoch: 2,
        rowCount: 2,
        indexRevision: 1,
        changes: [{ type: "reindexed" }],
      }),
    );
    session.pushStatus(
      "closed",
      fatalClose({
        code: "INTERNAL",
        reason: "late",
        incompatibleMethod: null,
      }),
    );
    await vi.advanceTimersByTimeAsync(60_000);

    // Closed once, at the moment it settled; nothing after it closes it again
    // or asks for anything - not a range, not a fresh snapshot.
    expect(session.closeCount).toBe(1);
    expect(session.sent).toEqual([]);
  });
});
