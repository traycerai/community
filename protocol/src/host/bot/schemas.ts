import { z } from "zod";
import { lazySchema } from "@traycer/protocol/framework/lazy-schema";

/**
 * `bot.*` - bots (Tracy Bots): owner-only, host-bound chat containers that
 * live in a team or personal environment. The wire mirror of the cloud's
 * `bots` row - `@traycer/protocol` is an OSS package and must not depend on
 * the internal `@traycerai/common`, so the record is declared here the way
 * `usage-analytics/schemas.ts` mirrors its aggregator.
 *
 * Every schema is a `lazySchema` thunk (the lazy-import gate). Every method
 * is OPTIONAL: registered with `degrade: { kind: "unsupported" }`, off the
 * released floor, so a host that predates bots advertises nothing and a
 * client hides the surface rather than failing the connection.
 */

/**
 * `bot_` + a 26-character Crockford ULID, the one shape the cloud mints
 * (`mintBotId`). Exact rather than "1-36 characters" so a host never carries a
 * client-supplied string that is not a bot id into a cloud call or a log line.
 * The first character is `[0-7]`: a ULID's 48-bit timestamp leaves the top
 * bits of its first base32 digit zero. Mirrored by the server's `isBotIdShape`.
 */
export const botIdSchema = lazySchema(() =>
  z.string().regex(/^bot_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
);
const hostIdSchema = lazySchema(() => z.string().min(1).max(255));
const botTitleSchema = lazySchema(() => z.string().min(1).max(500));
const botHarnessSchema = lazySchema(() => z.string().min(1).max(64));
const botModelSchema = lazySchema(() => z.string().min(1).max(255));
const botEffortSchema = lazySchema(() => z.string().min(1).max(64).nullable());
const botProfileSchema = lazySchema(() =>
  z.string().min(1).max(255).nullable(),
);

/** The bot row as the cloud returns it. */
export const botRecordSchema = lazySchema(() =>
  z.object({
    botId: botIdSchema,
    /** The environment (team or personal) the bot lives in. */
    environmentId: z.string().min(1),
    ownerUserId: z.string().min(1),
    title: botTitleSchema,
    harness: botHarnessSchema,
    model: botModelSchema,
    effort: botEffortSchema,
    profile: botProfileSchema,
    /** The trunk chat: a chat row under `task_id = botId`. */
    trunkChatId: z.string().min(1),
    /** Which host runs the trunk now; `bot.claimAuthority` rebinds it. */
    boundHostId: hostIdSchema,
    /** Authority generation: 0 at create, +1 per claim. */
    hostEpoch: z.number().int().nonnegative(),
    createdAt: z.number().int(),
    archivedAt: z.number().int().nullable(),
  }),
);
export type BotRecord = z.infer<typeof botRecordSchema>;

// ---- bot.create -------------------------------------------------------- //

/**
 * The host mints the two chat ids and binds itself as the bot's host, the
 * same way it mints every chat id it owns; the cloud takes the owner from the
 * bearer. The response also names the app conversation's chat id so the
 * caller can open it without a list round trip.
 */
export const botCreateRequestSchema = lazySchema(() =>
  z.object({
    environmentId: z.string().min(1).max(36),
    title: botTitleSchema,
    harness: botHarnessSchema,
    model: botModelSchema,
    effort: botEffortSchema,
    profile: botProfileSchema,
  }),
);
export type BotCreateRequest = z.infer<typeof botCreateRequestSchema>;

export const botCreateResponseSchema = lazySchema(() =>
  z.object({
    bot: botRecordSchema,
    appConversationChatId: z.string().min(1),
  }),
);
export type BotCreateResponse = z.infer<typeof botCreateResponseSchema>;

// ---- bot.list ---------------------------------------------------------- //

/**
 * Every live bot across every environment the caller belongs to, each row
 * carrying its `environmentId` so a client groups them. No environment
 * argument: a user belongs to several environments (one per team plus a
 * personal one) and there is no "current" one.
 */
export const botListRequestSchema = lazySchema(() => z.object({}));
export type BotListRequest = z.infer<typeof botListRequestSchema>;

export const botListResponseSchema = lazySchema(() =>
  z.object({
    bots: z.array(botRecordSchema),
  }),
);
export type BotListResponse = z.infer<typeof botListResponseSchema>;

// ---- bot.read ---------------------------------------------------------- //

export const botReadRequestSchema = lazySchema(() =>
  z.object({ botId: botIdSchema }),
);
export type BotReadRequest = z.infer<typeof botReadRequestSchema>;

export const botReadResponseSchema = lazySchema(() =>
  z.object({ bot: botRecordSchema }),
);
export type BotReadResponse = z.infer<typeof botReadResponseSchema>;

// ---- bot.updateTitle / bot.updateRunSettings --------------------------- //

/**
 * Narrow updates, one method per field group - the `epic.updateChatProfile`
 * posture: a client never rebuilds and replays the whole row to move one
 * field.
 */
export const botUpdateTitleRequestSchema = lazySchema(() =>
  z.object({ botId: botIdSchema, title: botTitleSchema }),
);
export type BotUpdateTitleRequest = z.infer<typeof botUpdateTitleRequestSchema>;

export const botUpdateRunSettingsRequestSchema = lazySchema(() =>
  z.object({
    botId: botIdSchema,
    harness: botHarnessSchema,
    model: botModelSchema,
    effort: botEffortSchema,
    profile: botProfileSchema,
  }),
);
export type BotUpdateRunSettingsRequest = z.infer<
  typeof botUpdateRunSettingsRequestSchema
>;

export const botUpdateResponseSchema = lazySchema(() =>
  z.object({ bot: botRecordSchema }),
);
export type BotUpdateResponse = z.infer<typeof botUpdateResponseSchema>;

// ---- bot.delete -------------------------------------------------------- //

export const botDeleteRequestSchema = lazySchema(() =>
  z.object({ botId: botIdSchema }),
);
export type BotDeleteRequest = z.infer<typeof botDeleteRequestSchema>;

export const botDeleteResponseSchema = lazySchema(() =>
  z.object({
    /** False when the bot was already archived - idempotent, not an error. */
    deleted: z.boolean(),
  }),
);
export type BotDeleteResponse = z.infer<typeof botDeleteResponseSchema>;

// ---- bot.claimAuthority ------------------------------------------------ //

/**
 * Rebind the bot to THIS host (the host serving the call): the bot row and
 * every chat under it move together and both epochs advance, so the previous
 * host's next publication is refused. The request names the bot only; the
 * host supplies its own id.
 */
export const botClaimAuthorityRequestSchema = lazySchema(() =>
  z.object({ botId: botIdSchema }),
);
export type BotClaimAuthorityRequest = z.infer<
  typeof botClaimAuthorityRequestSchema
>;

export const botClaimAuthorityResponseSchema = lazySchema(() =>
  z.object({ bot: botRecordSchema }),
);
export type BotClaimAuthorityResponse = z.infer<
  typeof botClaimAuthorityResponseSchema
>;

// ---- bot.subscribe ----------------------------------------------------- //

/**
 * How often the bot hears about one of its tasks: a periodic check-in every
 * `seconds`, one check-in once the task's agents have all gone idle
 * (`on-completion`), or none.
 */
export const botTaskCadenceSchema = lazySchema(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("every"),
      seconds: z.number().int().positive(),
    }),
    z.object({ kind: z.literal("on-completion") }),
    z.object({ kind: z.literal("none") }),
  ]),
);
export type BotTaskCadence = z.infer<typeof botTaskCadenceSchema>;

/**
 * One task the bot created, as the stream lists it (the bot row's task list,
 * written by the task tools and the check-in composer). An ended entry stays
 * listed with its reason; setting a cadence again re-arms it.
 *
 * Reshaped in place on `bot.subscribe@1.0`: the method has not shipped in a
 * host release, and nothing filled the earlier shape.
 */
export const botTaskEntrySchema = lazySchema(() =>
  z
    .object({
      taskId: z.string().min(1),
      cadence: botTaskCadenceSchema,
      /** When the last check-in for this task was consumed; null if never. */
      lastCheckinAt: z.number().int().nullable(),
      /** When the next periodic check-in is due; null for any other cadence. */
      nextAt: z.number().int().nullable(),
      state: z.enum(["tracking", "ended"]),
      /**
       * Null while tracking. `by-bot`: the bot set `none`; `deleted`: the task
       * was deleted; `archived`: its owner archived it; `completed`: an
       * `on-completion` check-in fired.
       */
      endedReason: z
        .enum(["by-bot", "deleted", "archived", "completed"])
        .nullable(),
    })
    .superRefine((entry, ctx) => {
      // The two invariants the fields document, enforced: an entry with a
      // reason it ended is ended, and only a periodic cadence has a due time.
      if ((entry.state === "ended") !== (entry.endedReason !== null)) {
        ctx.addIssue({
          code: "custom",
          path: ["endedReason"],
          message: "endedReason is set exactly when state is ended",
        });
      }
      if (entry.nextAt !== null && entry.cadence.kind !== "every") {
        ctx.addIssue({
          code: "custom",
          path: ["nextAt"],
          message: "nextAt is null unless the cadence is every",
        });
      }
    }),
);
export type BotTaskEntry = z.infer<typeof botTaskEntrySchema>;

export const botSubscribeOpenRequestSchema = lazySchema(() =>
  z.object({ botId: botIdSchema }),
);
export type BotSubscribeOpenRequest = z.infer<
  typeof botSubscribeOpenRequestSchema
>;

/**
 * The bot as one subscriber sees it. `snapshot` opens the stream and is
 * re-sent whole whenever the bot row, its task list or its open-request
 * count changes on this host; `deleted` ends it (the bot was archived, or
 * the caller lost it). The conversation rows stay authoritative for open
 * requests; `openRequestCount` is a hint, as the GUI spec says.
 */
export const botSubscribeServerFrameSchema = lazySchema(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("snapshot"),
      bot: botRecordSchema,
      tasks: z.array(botTaskEntrySchema),
      openRequestCount: z.number().int().nonnegative(),
      /** `boundHostId` and `hostEpoch` restated for cheap comparison. */
      boundHost: z.object({
        hostId: hostIdSchema,
        epoch: z.number().int().nonnegative(),
        /** Whether the serving host is the bound one. */
        isThisHost: z.boolean(),
      }),
      hasBinaryPayload: z.literal(false),
    }),
    z.object({
      kind: z.literal("deleted"),
      hasBinaryPayload: z.literal(false),
    }),
    z.object({
      kind: z.literal("pong"),
      hasBinaryPayload: z.literal(false),
    }),
  ]),
);
export type BotSubscribeServerFrame = z.infer<
  typeof botSubscribeServerFrameSchema
>;

export const botSubscribeClientFrameSchema = lazySchema(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ping"),
      hasBinaryPayload: z.literal(false),
    }),
  ]),
);
export type BotSubscribeClientFrame = z.infer<
  typeof botSubscribeClientFrameSchema
>;
