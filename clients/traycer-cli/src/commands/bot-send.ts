import { randomUUID } from "node:crypto";
import {
  botConversationListResponseSchema,
  botConversationSendRequestSchema,
  botConversationSendResponseSchema,
  type BotConversationRecord,
  type BotConversationSendDelivery,
} from "@traycer/protocol/host/bot/conversation-schemas";
import type { BotRecord } from "@traycer/protocol/host/bot/schemas";
import {
  openChatSubscribeWindowedServerFrameSchema,
  type ChatSubscribeWindowedClientFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { ChatIndexChange } from "@traycer/protocol/host/agent/gui/subscribe-windowed";
import type { OpenMessage } from "@traycer/protocol/persistence/epic/open-harness-records";
import { TRANSCRIPT_RANGE_MAX_BYTES } from "@traycer/protocol/persistence/chat-transcript/read-range";
import {
  findBot,
  type BotStreamClient,
  listBots,
  openLocalStreamClient,
  toBotCliError,
  unreadableStreamError,
} from "../internal/bot-host";
import {
  callHostRpc,
  parseCanonicalHostResponse,
  parseUserInput,
  resolveEndpoint,
} from "../internal/host-rpc";
import { cliError, CLI_ERROR_CODES } from "../runner/errors";
import type { CommandFn } from "../runner/runner";

/** How a `--wait` ended. */
export type BotReplyOutcome =
  | {
      readonly kind: "replied";
      readonly replyMessageId: string;
      /** Null when the reply row could not be read back. */
      readonly text: string | null;
    }
  | { readonly kind: "resolved-without-reply" }
  | { readonly kind: "timed-out" };

/**
 * `traycer bot send <bot> <text>` - write a message into a bot's conversation
 * (`bot.conversation.send`). Every message opens a request the bot answers;
 * the command prints its id and whether the message reached the bot now
 * (`written`) or waits for the bot's host to come back (`queued`).
 *
 * The conversation is `--conversation <id>` when given, otherwise the bot's
 * first conversation - the one created with it, which the app shows. A bot
 * with no conversation is refused; this command never creates one.
 *
 * `--wait <duration>` then follows the conversation until the bot answers the
 * request, for at most that long. Only the host the bot runs on can follow
 * its conversations, so on any other host `--wait` is refused before
 * anything is sent.
 */
export function buildBotSendCommand(opts: {
  readonly bot: string;
  readonly text: string;
  readonly conversationId: string | null;
  readonly wait: string | null;
}): CommandFn {
  return async () => {
    const waitMs = opts.wait === null ? null : parseWaitDuration(opts.wait);
    const bot = findBot(await listBots(), opts.bot);
    if (waitMs !== null) {
      const endpoint = await resolveEndpoint();
      if (bot.boundHostId !== endpoint.hostId) {
        throw cliError({
          code: CLI_ERROR_CODES.INVALID_ARGUMENT,
          message: `traycer: ${bot.title} runs on another of your hosts; --wait works only there. Send without --wait to queue it.`,
          details: null,
          exitCode: 1,
        });
      }
    }
    const conversationId = await chooseConversation(bot, opts.conversationId);
    const request = parseUserInput(botConversationSendRequestSchema, {
      botId: bot.botId,
      conversationId,
      text: opts.text,
    });
    const sent = parseCanonicalHostResponse(
      "bot.conversation.send",
      botConversationSendResponseSchema,
      await toBotCliError(callHostRpc("bot.conversation.send", request)),
    );
    const sentLine = `Sent to ${bot.title} (request ${sent.requestId}, ${describeDelivery(sent.delivery)}).`;
    const sentData = {
      botId: bot.botId,
      conversationId,
      messageId: sent.messageId,
      requestId: sent.requestId,
      delivery: sent.delivery,
    };
    if (waitMs === null) {
      return { data: sentData, human: sentLine, exitCode: 0 };
    }
    const { client } = await openLocalStreamClient();
    const outcome = await waitForBotReply({
      client,
      botId: bot.botId,
      conversationId,
      requestId: sent.requestId,
      timeoutMs: waitMs,
    }).finally(() => {
      client.close("bot-send-wait-settled");
    });
    return {
      data: { ...sentData, outcome },
      human: `${sentLine}\n${describeOutcome(bot.title, opts.wait ?? "", outcome)}`,
      exitCode: outcome.kind === "timed-out" ? 1 : 0,
    };
  };
}

function describeDelivery(delivery: BotConversationSendDelivery): string {
  return delivery === "written"
    ? "delivered"
    : "queued until the bot's host is back";
}

function describeOutcome(
  title: string,
  wait: string,
  outcome: BotReplyOutcome,
): string {
  switch (outcome.kind) {
    case "replied":
      return outcome.text === null
        ? `${title} replied (message ${outcome.replyMessageId}).`
        : `${title} replied:\n${outcome.text}`;
    case "resolved-without-reply":
      return `${title} closed the request without a reply.`;
    case "timed-out":
      return `No reply from ${title} within ${wait}. The request stays open.`;
  }
}

/**
 * The named conversation, or the bot's first one by creation time (the app
 * conversation every bot is created with).
 */
async function chooseConversation(
  bot: BotRecord,
  named: string | null,
): Promise<string> {
  const { conversations } = parseCanonicalHostResponse(
    "bot.conversation.list",
    botConversationListResponseSchema,
    await toBotCliError(
      callHostRpc("bot.conversation.list", { botId: bot.botId }),
    ),
  );
  if (named !== null) {
    if (conversations.some((c) => c.conversationId === named)) return named;
    throw cliError({
      code: CLI_ERROR_CODES.NOT_FOUND,
      message: `traycer: ${bot.title} has no conversation ${named}.`,
      details: null,
      exitCode: 1,
    });
  }
  const first = firstConversation(conversations);
  if (first === null) {
    throw cliError({
      code: CLI_ERROR_CODES.NOT_FOUND,
      message: `traycer: ${bot.title} has no conversation yet - open it in the Traycer app first.`,
      details: null,
      exitCode: 1,
    });
  }
  return first.conversationId;
}

export function firstConversation(
  conversations: readonly BotConversationRecord[],
): BotConversationRecord | null {
  let first: BotConversationRecord | null = null;
  for (const conversation of conversations) {
    if (first === null || conversation.createdAt < first.createdAt) {
      first = conversation;
    }
  }
  return first;
}

const DURATION_UNIT_MS: Readonly<Record<string, number>> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

/** The longest wait a single timer can hold (2^31 - 1 ms, about 24 days). */
const MAX_TIMER_MS = 2_147_483_647;

/** `30s`, `5m`, `2h`: a positive whole number and a unit. */
export function parseWaitDuration(value: string): number {
  const match = /^(\d+)([smh])$/.exec(value.trim());
  const ms =
    match === null ? Number.NaN : Number(match[1]) * DURATION_UNIT_MS[match[2]];
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_TIMER_MS) {
    throw cliError({
      code: CLI_ERROR_CODES.INVALID_ARGUMENT,
      message:
        "traycer: --wait takes a duration such as 30s, 5m or 2h (at most 24 days).",
      details: null,
      exitCode: 1,
    });
  }
  return ms;
}

/**
 * Follows one conversation over `chat.subscribe` until the user row holding
 * `requestId` is resolved, or `timeoutMs` passes.
 *
 * Resolution is recorded on the user row (`conversationRequest.resolvedAt`,
 * and `resolvedByMessageId` naming the reply). The snapshot's tail holds the
 * newest rows; after it, a change arrives as an `indexChanged` naming the rows
 * it touched, and their bodies are read with `loadRange`. A reconnect simply
 * re-subscribes and starts again from a fresh snapshot.
 */
export function waitForBotReply(input: {
  readonly client: BotStreamClient;
  readonly botId: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly timeoutMs: number;
}): Promise<BotReplyOutcome> {
  const { client, botId, conversationId, requestId } = input;
  return new Promise<BotReplyOutcome>((resolve, reject) => {
    let settled = false;
    /** Reply text by message id, from every row read so far. */
    const replies = new Map<string, string>();
    /** The reply the resolved row names; undefined until it is resolved. */
    let resolvedBy: string | null | undefined;
    let resnapshotAsked = false;
    /** Each outstanding `loadRange`'s last ordinal, to ask for a remainder. */
    const rangeEnds = new Map<string, number>();
    const session = client.subscribe("chat.subscribe", {
      epicId: botId,
      chatId: conversationId,
      resume: null,
    });
    const timer = setTimeout(() => {
      finish(() => resolve({ kind: "timed-out" }));
    }, input.timeoutMs);
    const finish = (act: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.close();
      act();
    };
    const send = (frame: ChatSubscribeWindowedClientFrame): void => {
      session.sendClientFrame(frame, null);
    };
    const resnapshot = (): void => {
      send({
        kind: "resnapshot",
        hasBinaryPayload: false,
        epicId: botId,
        chatId: conversationId,
      });
    };
    const loadRange = (
      epoch: number,
      fromOrdinal: number,
      toOrdinal: number,
    ): void => {
      const rangeRequestId = randomUUID();
      rangeEnds.set(rangeRequestId, toOrdinal);
      send({
        kind: "loadRange",
        hasBinaryPayload: false,
        epicId: botId,
        chatId: conversationId,
        request: {
          requestId: rangeRequestId,
          epoch,
          fromOrdinal,
          toOrdinal,
          maxBytes: TRANSCRIPT_RANGE_MAX_BYTES,
        },
      });
    };
    const read = (messages: readonly OpenMessage[]): void => {
      for (const message of messages) {
        if (message.role === "assistant") {
          replies.set(message.messageId, replyText(message));
          continue;
        }
        const request = message.conversationRequest;
        if (
          request !== undefined &&
          request.requestId === requestId &&
          request.resolvedAt !== null
        ) {
          resolvedBy = request.resolvedByMessageId;
        }
      }
    };
    /** Settles once the request is resolved and its reply has been read. */
    const settleIfResolved = (afterSnapshot: boolean): void => {
      if (resolvedBy === undefined) return;
      if (resolvedBy === null) {
        finish(() => resolve({ kind: "resolved-without-reply" }));
        return;
      }
      const replyMessageId = resolvedBy;
      const text = replies.get(replyMessageId);
      if (text !== undefined) {
        finish(() => resolve({ kind: "replied", replyMessageId, text }));
        return;
      }
      // The reply row was not among the rows read. A fresh snapshot's tail
      // holds the newest rows; if it is not there either, report the id.
      if (!resnapshotAsked) {
        resnapshotAsked = true;
        resnapshot();
        return;
      }
      if (afterSnapshot) {
        finish(() =>
          resolve({ kind: "replied", replyMessageId, text: null }),
        );
      }
    };
    session.onServerFrame((envelope) => {
      const parsed = openChatSubscribeWindowedServerFrameSchema.safeParse(
        envelope,
      );
      if (!parsed.success) {
        // Only the frames that carry rows matter here; any other frame this
        // CLI cannot read is not the one it is waiting for.
        const kind = envelope.kind;
        if (kind === "snapshot" || kind === "range" || kind === "indexChanged") {
          finish(() => reject(unreadableStreamError()));
        }
        return;
      }
      const frame = parsed.data;
      switch (frame.kind) {
        case "snapshot":
          read(frame.snapshot.tail.messages);
          settleIfResolved(true);
          return;
        case "range": {
          const { range } = frame;
          read(range.messages);
          const end = rangeEnds.get(range.requestId);
          rangeEnds.delete(range.requestId);
          // The host stops early to stay under the byte budget; ask for the
          // rest of the span this range was asked for.
          if (end !== undefined && range.truncatedAtOrdinal !== undefined) {
            loadRange(range.epoch, range.truncatedAtOrdinal, end);
          }
          settleIfResolved(false);
          return;
        }
        case "indexChanged": {
          if (frame.changes.some((change) => change.type === "reindexed")) {
            resnapshot();
            return;
          }
          const span = touchedOrdinals(frame.changes, frame.rowCount);
          if (span !== null) loadRange(frame.epoch, span.from, span.to);
          return;
        }
        default:
          return;
      }
    });
    session.onStatusChange((status, reason) => {
      // A drop re-subscribes on its own and the new snapshot starts over;
      // the person's timeout bounds the wait either way.
      if (status !== "closed" || reason === null || reason.kind !== "fatalError")
        return;
      finish(() =>
        reject(
          cliError({
            code: CLI_ERROR_CODES.HOST_UNREACHABLE,
            message: `traycer: stopped following the conversation - ${reason.details.reason}. The message was sent; the request stays open.`,
            details: null,
            exitCode: 1,
          }),
        ),
      );
    });
  });
}

/**
 * The inclusive ordinal span an `indexChanged` touched: every `updated`
 * ordinal and the appended rows, which sit at the end of the index.
 */
export function touchedOrdinals(
  changes: readonly ChatIndexChange[],
  rowCount: number,
): { readonly from: number; readonly to: number } | null {
  const ordinals: number[] = [];
  let appended = 0;
  for (const change of changes) {
    if (change.type === "updated") {
      for (const entry of change.entries) ordinals.push(entry.ordinal);
    } else if (change.type === "appended") {
      appended += change.entries.length;
    }
  }
  if (appended > 0) {
    ordinals.push(rowCount - appended, rowCount - 1);
  }
  if (ordinals.length === 0) return null;
  return {
    from: Math.max(0, Math.min(...ordinals)),
    to: Math.max(...ordinals),
  };
}

function replyText(message: OpenMessage): string {
  if (message.role !== "assistant") return "";
  return message.blocks
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}
