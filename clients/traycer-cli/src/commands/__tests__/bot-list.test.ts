import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotRecord } from "@traycer/protocol/host/bot/schemas";
import type { EnvironmentDescriptor } from "@traycer/protocol/host/environment/contracts";
import type { StreamFrameEnvelope } from "@traycer/protocol/host-transport/stream-session";
import { BOT_HOST_UPDATE_MESSAGE } from "../../internal/bot-host";
import { CLI_ERROR_CODES, CliError } from "../../runner/errors";
import type { CommandResult } from "../../runner/runner";
import {
  BOT_ID_A,
  BOT_ID_B,
  BOT_ID_C,
  OTHER_HOST_ID,
  THIS_HOST_ID,
  FakeStreamClient,
  botDeletedFrame,
  botRecord,
  botSnapshotFrame,
  botSubscribeClient,
  environmentDescriptor,
  fatalClose,
  makeCtx,
  routeRpc,
  unsupportedRpcError,
} from "./bot-test-support";
import { buildBotListCommand, groupByEnvironment } from "../bot-list";

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

/** Wires the two list RPCs and the stream client a run of `bot list` sees. */
function stage(input: {
  readonly environments: readonly EnvironmentDescriptor[];
  readonly bots: readonly BotRecord[];
  readonly client: FakeStreamClient;
}): void {
  hoisted.callHostRpc.mockImplementation(
    routeRpc({
      "environment.list": () => ({ environments: input.environments }),
      "bot.list": () => ({ bots: input.bots }),
    }),
  );
  hoisted.openLocalStreamClient.mockResolvedValue({
    client: input.client,
    endpoint: ENDPOINT,
  });
}

function snapshotAnswers(
  entries: readonly (readonly [BotRecord, number])[],
): Record<string, StreamFrameEnvelope> {
  return Object.fromEntries(
    entries.map(
      ([bot, openRequests]): readonly [string, StreamFrameEnvelope] => [
        bot.botId,
        botSnapshotFrame(bot, [], openRequests),
      ],
    ),
  );
}

async function runList(): Promise<CommandResult> {
  return buildBotListCommand()(makeCtx());
}

beforeEach(() => {
  vi.resetAllMocks();
  hoisted.resolveEndpoint.mockResolvedValue(ENDPOINT);
});

describe("bot list", () => {
  it("groups bots under their environment, in environment.list order, and marks this host's bots", async () => {
    const scout = botRecord({
      botId: BOT_ID_B,
      title: "Scout",
      environmentId: "env-personal",
      boundHostId: OTHER_HOST_ID,
    });
    const tracy = botRecord({
      botId: BOT_ID_A,
      title: "Tracy",
      environmentId: "env-team",
      boundHostId: THIS_HOST_ID,
    });
    stage({
      environments: [
        environmentDescriptor("env-personal", "Personal"),
        environmentDescriptor("env-team", "Acme"),
      ],
      // The bot.list order is the reverse of the environment order, so the
      // output order can only come from environment.list.
      bots: [tracy, scout],
      client: botSubscribeClient(
        snapshotAnswers([
          [scout, 3],
          [tracy, 1],
        ]),
      ),
    });

    const result = await runList();

    expect(result.human).toBe(
      [
        "Personal",
        `  Scout  ${BOT_ID_B}  host ${OTHER_HOST_ID}  3 open requests`,
        "",
        "Acme",
        `  Tracy  ${BOT_ID_A}  host ${THIS_HOST_ID} (this host)  1 open request`,
      ].join("\n"),
    );
    expect(result.data).toEqual({
      environments: [
        {
          environmentId: "env-personal",
          label: "Personal",
          bots: [
            {
              botId: BOT_ID_B,
              title: "Scout",
              boundHostId: OTHER_HOST_ID,
              boundToThisHost: false,
              openRequestCount: 3,
            },
          ],
        },
        {
          environmentId: "env-team",
          label: "Acme",
          bots: [
            {
              botId: BOT_ID_A,
              title: "Tracy",
              boundHostId: THIS_HOST_ID,
              boundToThisHost: true,
              openRequestCount: 1,
            },
          ],
        },
      ],
    });
    expect(result.exitCode).toBe(0);
  });

  it("prints '  no bots' under an environment that has none", async () => {
    const tracy = botRecord({ botId: BOT_ID_A, environmentId: "env-team" });
    stage({
      environments: [
        environmentDescriptor("env-personal", "Personal"),
        environmentDescriptor("env-team", "Acme"),
      ],
      bots: [tracy],
      client: botSubscribeClient(snapshotAnswers([[tracy, 0]])),
    });

    const result = await runList();

    expect(result.human).toBe(
      [
        "Personal",
        "  no bots",
        "",
        "Acme",
        `  Tracy  ${BOT_ID_A}  host ${THIS_HOST_ID} (this host)  0 open requests`,
      ].join("\n"),
    );
    expect(result.data).toMatchObject({
      environments: [
        { environmentId: "env-personal", label: "Personal", bots: [] },
        { environmentId: "env-team", label: "Acme" },
      ],
    });
  });

  it("marks '(this host)' only on a bot whose boundHostId equals the endpoint's host id", async () => {
    const here = botRecord({
      botId: BOT_ID_A,
      title: "Here",
      boundHostId: THIS_HOST_ID,
    });
    const there = botRecord({
      botId: BOT_ID_B,
      title: "There",
      boundHostId: OTHER_HOST_ID,
    });
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [here, there],
      client: botSubscribeClient(
        snapshotAnswers([
          [here, 0],
          [there, 0],
        ]),
      ),
    });

    const result = await runList();

    const lines = (result.human ?? "").split("\n");
    expect(lines.filter((line) => line.includes("(this host)"))).toEqual([
      `  Here  ${BOT_ID_A}  host ${THIS_HOST_ID} (this host)  0 open requests`,
    ]);
    expect(result.data).toMatchObject({
      environments: [
        {
          bots: [
            { title: "Here", boundToThisHost: true },
            { title: "There", boundToThisHost: false },
          ],
        },
      ],
    });
  });

  it("says '1 open request' for one and 'N open requests' for any other count", async () => {
    const one = botRecord({ botId: BOT_ID_A, title: "One" });
    const many = botRecord({ botId: BOT_ID_B, title: "Many" });
    const none = botRecord({ botId: BOT_ID_C, title: "None" });
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [one, many, none],
      client: botSubscribeClient(
        snapshotAnswers([
          [one, 1],
          [many, 12],
          [none, 0],
        ]),
      ),
    });

    const result = await runList();

    expect(result.human).toContain(
      `${BOT_ID_A}  host ${THIS_HOST_ID} (this host)  1 open request\n`,
    );
    expect(result.human).toContain("  12 open requests\n");
    expect(result.human).toMatch(/ {2}0 open requests$/);
    expect(result.human).not.toContain("1 open requests");
  });

  it("leaves out a bot whose stream answers deleted", async () => {
    const kept = botRecord({ botId: BOT_ID_A, title: "Kept" });
    const gone = botRecord({ botId: BOT_ID_B, title: "Gone" });
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [kept, gone],
      client: botSubscribeClient({
        [BOT_ID_A]: botSnapshotFrame(kept, [], 2),
        [BOT_ID_B]: botDeletedFrame(),
      }),
    });

    const result = await runList();

    expect(result.human).toContain("Kept");
    expect(result.human).not.toContain("Gone");
    expect(result.human).not.toContain(BOT_ID_B);
    expect(result.data).toMatchObject({
      environments: [{ bots: [{ botId: BOT_ID_A }] }],
    });
    expect(JSON.stringify(result.data)).not.toContain(BOT_ID_B);
  });

  it("shows no group for an unknown environment whose only bot was deleted", async () => {
    const gone = botRecord({ botId: BOT_ID_A, environmentId: "env-gone" });
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [gone],
      client: botSubscribeClient({ [BOT_ID_A]: botDeletedFrame() }),
    });

    const result = await runList();

    expect(result.human).toBe("Personal\n  no bots");
    expect(result.human).not.toContain("env-gone");
  });

  it("lists a bot naming an environment absent from environment.list under that environment's id", async () => {
    const known = botRecord({
      botId: BOT_ID_A,
      title: "Known",
      environmentId: "env-personal",
    });
    const stray = botRecord({
      botId: BOT_ID_B,
      title: "Stray",
      environmentId: "env-removed",
    });
    const strayToo = botRecord({
      botId: BOT_ID_C,
      title: "StrayToo",
      environmentId: "env-removed",
    });
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [stray, known, strayToo],
      client: botSubscribeClient(
        snapshotAnswers([
          [known, 0],
          [stray, 0],
          [strayToo, 4],
        ]),
      ),
    });

    const result = await runList();

    expect(result.human).toBe(
      [
        "Personal",
        `  Known  ${BOT_ID_A}  host ${THIS_HOST_ID} (this host)  0 open requests`,
        "",
        "env-removed",
        `  Stray  ${BOT_ID_B}  host ${THIS_HOST_ID} (this host)  0 open requests`,
        `  StrayToo  ${BOT_ID_C}  host ${THIS_HOST_ID} (this host)  4 open requests`,
      ].join("\n"),
    );
    expect(result.data).toMatchObject({
      environments: [
        { environmentId: "env-personal", label: "Personal" },
        {
          environmentId: "env-removed",
          label: "env-removed",
          bots: [{ botId: BOT_ID_B }, { botId: BOT_ID_C }],
        },
      ],
    });
  });

  it("says so when the person belongs to no environments", async () => {
    stage({
      environments: [],
      bots: [],
      client: botSubscribeClient({}),
    });

    const result = await runList();

    expect(result.human).toBe("You belong to no environments yet.");
    expect(result.data).toEqual({ environments: [] });
    expect(result.exitCode).toBe(0);
  });

  it("opens one bot.subscribe per bot, closes each session, and closes the client afterwards", async () => {
    const first = botRecord({ botId: BOT_ID_A });
    const second = botRecord({ botId: BOT_ID_B });
    const client = botSubscribeClient(
      snapshotAnswers([
        [first, 0],
        [second, 0],
      ]),
    );
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [first, second],
      client,
    });

    await runList();

    expect(client.sessions.map((session) => session.method)).toEqual([
      "bot.subscribe",
      "bot.subscribe",
    ]);
    expect(client.sessions.map((session) => session.params)).toEqual([
      { botId: BOT_ID_A },
      { botId: BOT_ID_B },
    ]);
    expect(client.sessions.map((session) => session.closeCount)).toEqual([
      1, 1,
    ]);
    expect(client.closeReasons).toEqual(["bot-list-settled"]);
  });

  it("closes the stream client even when a snapshot read fails", async () => {
    const bot = botRecord({ botId: BOT_ID_A });
    const client = new FakeStreamClient((session) => {
      session.pushStatus(
        "closed",
        fatalClose({
          code: "INTERNAL",
          reason: "host blew up",
          incompatibleMethod: null,
        }),
      );
    });
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [bot],
      client,
    });

    await expect(runList()).rejects.toMatchObject({
      code: CLI_ERROR_CODES.HOST_UNREACHABLE,
      exitCode: 1,
      message: expect.stringContaining("host blew up"),
    });
    expect(client.closeReasons).toEqual(["bot-list-settled"]);
  });
});

describe("bot list on a host without bots", () => {
  async function expectUpdateMessage(run: Promise<CommandResult>) {
    const error: unknown = await run.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    if (!(error instanceof CliError)) throw error;
    expect(error.message).toBe(BOT_HOST_UPDATE_MESSAGE);
    expect(error.code).toBe(CLI_ERROR_CODES.HOST_UNSUPPORTED);
    expect(error.exitCode).toBe(1);
  }

  it.each(["bot.list", "environment.list"] as const)(
    "rejects with the update message when %s is unsupported",
    async (missing) => {
      hoisted.callHostRpc.mockImplementation(
        routeRpc({
          "environment.list": () => {
            if (missing === "environment.list") {
              throw unsupportedRpcError("environment.list");
            }
            return { environments: [] };
          },
          "bot.list": () => {
            if (missing === "bot.list") throw unsupportedRpcError("bot.list");
            return { bots: [] };
          },
        }),
      );

      await expectUpdateMessage(runList());

      // The RPCs failed first: no stream client was ever opened.
      expect(hoisted.openLocalStreamClient).not.toHaveBeenCalled();
    },
  );

  it("rejects with the update message when bot.subscribe closes as incompatible for that method", async () => {
    const bot = botRecord({ botId: BOT_ID_A });
    const client = new FakeStreamClient((session) => {
      session.pushStatus(
        "closed",
        fatalClose({
          code: "INCOMPATIBLE",
          reason: "host does not offer bot.subscribe",
          incompatibleMethod: "bot.subscribe",
        }),
      );
    });
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [bot],
      client,
    });

    await expectUpdateMessage(runList());

    expect(client.closeReasons).toEqual(["bot-list-settled"]);
  });

  it("rejects with the update message when the client reports bot.subscribe unsupported", async () => {
    const bot = botRecord({ botId: BOT_ID_A });
    const client = new FakeStreamClient((session) => {
      session.pushStatus("closed", { kind: "caller" });
    });
    client.methodSupport = "unsupported";
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [bot],
      client,
    });

    await expectUpdateMessage(runList());
  });

  it("does not read an INCOMPATIBLE close about another method as a missing bots capability", async () => {
    const bot = botRecord({ botId: BOT_ID_A });
    const client = new FakeStreamClient((session) => {
      session.pushStatus(
        "closed",
        fatalClose({
          code: "INCOMPATIBLE",
          reason: "protocol skew",
          incompatibleMethod: "chat.subscribe",
        }),
      );
    });
    stage({
      environments: [environmentDescriptor("env-personal", "Personal")],
      bots: [bot],
      client,
    });

    await expect(runList()).rejects.toMatchObject({
      code: CLI_ERROR_CODES.HOST_UNREACHABLE,
    });
  });
});

describe("groupByEnvironment", () => {
  it("keeps an environment with no rows and orders unknown environments after the listed ones", () => {
    const bots = [
      botRecord({ botId: BOT_ID_A, environmentId: "env-z" }),
      botRecord({ botId: BOT_ID_B, environmentId: "env-a" }),
    ];
    const rows = bots.map((bot) => ({
      botId: bot.botId,
      title: bot.title,
      boundHostId: bot.boundHostId,
      boundToThisHost: true,
      openRequestCount: 0,
    }));

    const groups = groupByEnvironment(
      [
        environmentDescriptor("env-a", "A"),
        environmentDescriptor("env-b", "B"),
      ],
      rows,
      bots,
    );

    expect(
      groups.map((group) => [
        group.environmentId,
        group.label,
        group.bots.map((row) => row.botId),
      ]),
    ).toEqual([
      ["env-a", "A", [BOT_ID_B]],
      ["env-b", "B", []],
      ["env-z", "env-z", [BOT_ID_A]],
    ]);
  });
});
