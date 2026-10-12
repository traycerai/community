import { NO_TRANSPORT_EVIDENCE } from "@traycer-clients/shared/host-selection/transport-evidence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CURRENT_CLIENT_COMPATIBILITY_EPOCH,
  UNARY_CAPABILITY_IDEMPOTENCY_KEY,
  UNARY_CAPABILITY_PERSISTENT_SESSION,
  defineFallbackMethodDegrade,
  defineRpcContract,
  defineVersionedRpcRegistry,
  type FirstPartyClientIdentity,
  type VersionedRpcRegistry,
} from "@traycer/protocol/framework/index";
import type {
  ClientCancelFrame,
  ClientFrame,
  ClientOpenFrame,
  ClientRequestFrame,
  HostFrame,
  HostOpenAckFrame,
} from "@traycer/protocol/framework/ws-protocol";
import {
  HostMethodVersionUnsatisfiedError,
  HostRequestAbortedError,
  HostRpcError,
  HostTransportFailureError,
  RetryableTransportError,
  type HostRequestAuthority,
  type HostRequestOptions,
  type RequiredHostMethodVersion,
} from "../host-messenger";
import {
  MutableBearerLease,
  type OpenFrameBearerSource,
} from "@traycer-clients/shared/auth/bearer-source";
import {
  createRequestContext,
  identityFromAuthenticatedUser,
  type RequestContext,
} from "@traycer/protocol/auth/request-context";
import { createAuthenticatedUserFixture } from "../../test-fixtures/authenticated-user";
import { mockLocalHostEntry } from "../../host-client/mock/mock-host-directory";
import type {
  IWebSocketFactory,
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocketLike,
  WebSocketMessageEvent,
  WebSocketOpenEvent,
} from "../ws-factory";
import type { DialPriority } from "../dial-priority";
import { WsRpcClient } from "../ws-rpc-client";
import { resetNegotiatedManifests } from "../negotiated-manifest-registry";
import {
  installPersistentUnaryHostStore,
  resetPersistentUnaryHosts,
} from "../persistent-unary-hosts";
import { createAuthAwareMessenger } from "../auth-aware-messenger";
import { createRetryingMessenger } from "../retrying-messenger";
import { TEST_CLIENT_IDENTITY } from "@traycer-clients/shared/test-fixtures/client-identity";

/**
 * Local unary connection reuse through the public `WsRpcClient` surface, with
 * a scripted host on the other end of stub sockets.
 */

// Mirrors the host's documented per-session ceiling.
const MAX_RUNNING_REQUESTS = 64;
const IDLE_TIMEOUT_MS = 30_000;

const echoV10 = defineRpcContract({
  method: "host.echo",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: z.object({ message: z.string() }),
  responseSchema: z.object({ echoed: z.string() }),
});
const statusV10 = defineRpcContract({
  method: "host.status",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: z.object({}),
  responseSchema: z.object({ ready: z.boolean() }),
});
const readFallbackV10 = defineRpcContract({
  method: "host.readFallback",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: z.object({}),
  responseSchema: z.object({ summary: z.string() }),
});

const statusLine = {
  1: {
    latestMinor: 0 as const,
    versions: { 0: { contract: statusV10, upgradeFromPreviousVersion: null } },
    downgradePathsFromLatest: {},
  },
};
// host.echo is a read (may be cancelled after dispatch); host.status is not.
const registry = defineVersionedRpcRegistry({
  "host.echo": {
    cancelAfterDispatch: true,
    1: {
      latestMinor: 0,
      versions: { 0: { contract: echoV10, upgradeFromPreviousVersion: null } },
      downgradePathsFromLatest: {},
    },
  },
  "host.status": statusLine,
});
// A cancellable read that degrades onto the non-cancellable host.status.
const degradeRegistry = defineVersionedRpcRegistry({
  "host.readFallback": {
    cancelAfterDispatch: true,
    degrade: defineFallbackMethodDegrade<
      typeof readFallbackV10,
      typeof statusV10,
      "host.status"
    >({
      kind: "fallback",
      to: { method: "host.status", major: 1, minor: 0 },
      adaptRequest: () => ({}),
      adaptResponse: (response) => ({
        summary: response.ready ? "ready" : "not-ready",
      }),
    }),
    1: {
      latestMinor: 0,
      versions: {
        0: { contract: readFallbackV10, upgradeFromPreviousVersion: null },
      },
      downgradePathsFromLatest: {},
    },
  },
  "host.status": statusLine,
});

class StubWebSocket implements WebSocketLike {
  onopen: ((event: WebSocketOpenEvent) => void) | null = null;
  onmessage: ((event: WebSocketMessageEvent) => void) | null = null;
  onerror: ((event: WebSocketErrorEvent) => void) | null = null;
  onclose: ((event: WebSocketCloseEvent) => void) | null = null;
  readonly sentFrames: ClientFrame[] = [];
  closed: { readonly code: number; readonly reason: string } | null = null;

  constructor(
    private readonly index: number,
    private readonly events: string[],
  ) {}

  send(data: string): void {
    const frame = JSON.parse(data) as ClientFrame;
    this.sentFrames.push(frame);
    this.events.push(`send:${frame.kind}:${this.index}`);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  fireOpen(): void {
    this.onopen?.({ type: "open" });
  }
  fireMessage(frame: HostFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  fireClose(): void {
    this.onclose?.({ code: 1006, reason: "", wasClean: false });
  }
}

const requestFrames = (socket: StubWebSocket): ClientRequestFrame[] =>
  socket.sentFrames.filter(
    (frame): frame is ClientRequestFrame => frame.kind === "request",
  );
const cancelFrames = (socket: StubWebSocket): ClientCancelFrame[] =>
  socket.sentFrames.filter(
    (frame): frame is ClientCancelFrame => frame.kind === "cancel",
  );
const openFrames = (sockets: readonly StubWebSocket[]): ClientOpenFrame[] =>
  sockets.flatMap((socket) =>
    socket.sentFrames.filter(
      (frame): frame is ClientOpenFrame => frame.kind === "open",
    ),
  );

const HOST_MANIFEST = { "host.status": { major: 1, minor: 0 } };
const PERSISTENT_ACK: HostOpenAckFrame = {
  kind: "openAck",
  manifest: HOST_MANIFEST,
  optionalManifest: { "host.echo": { major: 1, minor: 0 } },
  capabilities: [
    UNARY_CAPABILITY_IDEMPOTENCY_KEY,
    UNARY_CAPABILITY_PERSISTENT_SESSION,
  ],
};
const LEGACY_ACK: HostOpenAckFrame = {
  ...PERSISTENT_ACK,
  capabilities: [UNARY_CAPABILITY_IDEMPOTENCY_KEY],
};
const DEGRADE_ACK: HostOpenAckFrame = {
  kind: "openAck",
  manifest: HOST_MANIFEST,
  optionalManifest: {},
  capabilities: [UNARY_CAPABILITY_PERSISTENT_SESSION],
};

function harness<R extends VersionedRpcRegistry>(
  reg: R,
  identity: FirstPartyClientIdentity,
) {
  const sockets: StubWebSocket[] = [];
  const events: string[] = [];
  const priorities: DialPriority[] = [];
  const factory: IWebSocketFactory = {
    create(_url: string, priority: DialPriority): WebSocketLike {
      priorities.push(priority);
      const socket = new StubWebSocket(sockets.length, events);
      sockets.push(socket);
      return socket;
    },
  };
  let counter = 0;
  const client = new WsRpcClient<R>({
    clientIdentity: identity,
    registry: reg,
    requestId: () => `req-${++counter}`,
    webSocketFactory: factory,
    dialTimeoutMs: 1_000,
    frameTimeoutMs: 1_000,
    hostAttestationWindowMs: 0,
    evidence: NO_TRANSPORT_EVIDENCE,
  });
  return { client, sockets, events, priorities };
}

type AuthorityKnobs = {
  readonly verdict: { value: boolean } | undefined;
  readonly cancel: boolean | undefined;
  readonly controller: AbortController | undefined;
};
function authorityWith(
  lease: OpenFrameBearerSource,
  knobs: AuthorityKnobs,
): HostRequestAuthority {
  const controller = knobs.controller ?? new AbortController();
  const verdict = knobs.verdict;
  return {
    endpoint: {
      hostId: mockLocalHostEntry.hostId,
      websocketUrl: mockLocalHostEntry.websocketUrl,
    },
    bearer: lease,
    abortSignal: controller.signal,
    ...(knobs.cancel === undefined
      ? {}
      : { cancelAfterDispatch: knobs.cancel }),
    ...(verdict === undefined ? {} : { cloudAuthorized: () => verdict.value }),
  };
}
const authority = (lease: OpenFrameBearerSource): HostRequestAuthority =>
  authorityWith(lease, {
    verdict: undefined,
    cancel: undefined,
    controller: undefined,
  });
const readAuthority = (
  lease: MutableBearerLease,
  controller: AbortController | undefined,
): HostRequestAuthority =>
  authorityWith(lease, { verdict: undefined, cancel: true, controller });

/** A real releasable credential lease: `credentials.release()` withdraws the bearer, `abort()` releases AND signals abort. */
function realLease(token: string): RequestContext {
  return createRequestContext({
    identity: identityFromAuthenticatedUser(
      createAuthenticatedUserFixture(undefined),
    ),
    bearerToken: token,
    origin: "renderer",
    connectionId: undefined,
    operationId: undefined,
    externalAbortSignal: undefined,
    cloudAuthorized: true,
  });
}
function leaseAuthority(lease: RequestContext): HostRequestAuthority {
  return {
    endpoint: {
      hostId: mockLocalHostEntry.hostId,
      websocketUrl: mockLocalHostEntry.websocketUrl,
    },
    bearer: lease.credentials,
    abortSignal: lease.abortSignal,
  };
}
function opts(
  auth: HostRequestAuthority,
  idempotencyKey: string | null,
  requiredHostMethodVersion: RequiredHostMethodVersion | null,
): HostRequestOptions {
  return {
    authority: auth,
    idempotencyKey,
    replayMustBeKeyed: false,
    requiredHostMethodVersion,
  };
}
const plain = (auth: HostRequestAuthority): HostRequestOptions =>
  opts(auth, null, null);

async function settle(): Promise<void> {
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
async function establish(
  socket: StubWebSocket,
  ack: HostOpenAckFrame,
): Promise<void> {
  await settle();
  socket.fireOpen();
  await settle();
  socket.fireMessage(ack);
  await settle();
}
/** Negotiates and caches a capable session with one completed call, so later overlapping calls reuse it. */
async function warmSession(
  client: WsRpcClient<typeof registry>,
  sockets: readonly StubWebSocket[],
  lease: MutableBearerLease,
): Promise<void> {
  const warm = client.request(
    "host.echo",
    { message: "warm" },
    plain(authority(lease)),
  );
  await establish(sockets[0], PERSISTENT_ACK);
  respond(sockets[0], requestFrames(sockets[0])[0], { echoed: "WARM" });
  await warm;
}
/**
 * A host whose persistent support the client has already seen, with no session
 * left to reuse: the next call has to dial. `answered` holds the warm-up
 * request, so `answerAll` leaves it alone.
 */
async function coldKnownHost() {
  const built = harness(registry, DESKTOP);
  const lease = new MutableBearerLease("token-1", "test-user");
  await warmSession(built.client, built.sockets, lease);
  built.sockets[0].fireClose();
  await settle();
  const answered = new Set(
    requestFrames(built.sockets[0]).map((frame) => frame.requestId),
  );
  return { ...built, lease, answered };
}
/** Reads a call's outcome without awaiting it, so a call still waiting reads as not settled. */
function track(call: Promise<unknown>): {
  settled: boolean;
  error: unknown;
} {
  const state: { settled: boolean; error: unknown } = {
    settled: false,
    error: null,
  };
  void call.then(
    () => {
      state.settled = true;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}
/** Answers every request frame not answered yet, whichever socket carries it. */
function answerAll(
  sockets: readonly StubWebSocket[],
  answered: Set<string>,
): void {
  for (const socket of sockets) {
    for (const frame of requestFrames(socket)) {
      if (answered.has(frame.requestId)) continue;
      answered.add(frame.requestId);
      respond(
        socket,
        frame,
        frame.method === "host.status" ? { ready: true } : { echoed: "ok" },
      );
    }
  }
}
function respond(
  socket: StubWebSocket,
  frame: ClientRequestFrame,
  result: unknown,
): void {
  socket.fireMessage({
    kind: "response",
    requestId: frame.requestId,
    method: frame.method,
    schemaVersion: frame.schemaVersion,
    result,
    error: null,
  });
}
const fatalUnauthorized: HostFrame = {
  kind: "fatalError",
  details: {
    code: "UNAUTHORIZED",
    reason: "Bearer expired",
    incompatibleMethods: null,
    upgradeGuidance: null,
  },
};

/** Reads a rotated token once `rotateAfterReads` reads have happened, and logs when it does. */
class ScriptedBearer implements OpenFrameBearerSource {
  readonly identity = { userId: "test-user" };
  rotateAfterReads = Number.POSITIVE_INFINITY;
  reads = 0;
  constructor(private readonly events: string[]) {}
  getBearerToken(): string {
    const rotated = this.reads >= this.rotateAfterReads;
    this.reads += 1;
    if (rotated) this.events.push("read:token-2");
    return rotated ? "token-2" : "token-1";
  }
}

const DESKTOP = TEST_CLIENT_IDENTITY;
const CLI: FirstPartyClientIdentity = {
  kind: "cli",
  compatibilityEpoch: CURRENT_CLIENT_COMPATIBILITY_EPOCH,
  appVersion: "0.0.0-test",
};

describe("WsRpcClient persistent local session", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetNegotiatedManifests();
    resetPersistentUnaryHosts();
  });

  it("reuses a negotiated session for a burst and later calls, and answers correlated calls out of order", async () => {
    const { client, sockets } = harness(registry, DESKTOP);
    const lease = new MutableBearerLease("token-1", "test-user");
    await warmSession(client, sockets, lease);

    const a = client.request(
      "host.echo",
      { message: "a" },
      plain(authority(lease)),
    );
    const b = client.request(
      "host.echo",
      { message: "b" },
      plain(authority(lease)),
    );
    await settle();
    expect(sockets).toHaveLength(1);
    const [, frameA, frameB] = requestFrames(sockets[0]);
    expect([frameA.sequence, frameB.sequence]).toEqual([2, 3]);
    respond(sockets[0], frameB, { echoed: "B" });
    await expect(b).resolves.toEqual({ echoed: "B" });
    respond(sockets[0], frameA, { echoed: "A" });
    await expect(a).resolves.toEqual({ echoed: "A" });

    const c = client.request(
      "host.echo",
      { message: "c" },
      plain(authority(lease)),
    );
    await settle();
    const frameC = requestFrames(sockets[0])[3];
    expect(frameC.sequence).toBe(4);
    respond(sockets[0], frameC, { echoed: "C" });
    await expect(c).resolves.toEqual({ echoed: "C" });

    expect(sockets).toHaveLength(1);
    expect(openFrames(sockets)).toHaveLength(1);
    expect(sockets[0].closed).toBeNull();
  });

  it("dials each overlapping cold call on its own socket and priority, and both complete", async () => {
    const { client, sockets, priorities } = harness(registry, DESKTOP);
    const lease = new MutableBearerLease("token-1", "test-user");
    const background = client.request(
      "host.status",
      {},
      plain(authority(lease)),
    );
    const interactive = client.request(
      "host.echo",
      { message: "hi" },
      plain(authority(lease)),
    );
    await settle();

    // No handshake is shared while none has completed.
    expect(sockets).toHaveLength(2);
    expect(priorities).toEqual(["background", "interactive"]);

    await establish(sockets[0], PERSISTENT_ACK);
    await establish(sockets[1], PERSISTENT_ACK);
    await settle();
    // The first ack wins: both requests ride its session, and the second
    // handshake's socket is retired unused.
    expect(requestFrames(sockets[0])).toHaveLength(2);
    expect(requestFrames(sockets[1])).toEqual([]);
    expect(sockets[1].closed).not.toBeNull();
    const answered = new Set<string>();
    answerAll(sockets, answered);
    await settle();
    answerAll(sockets, answered);

    await expect(background).resolves.toEqual({ ready: true });
    await expect(interactive).resolves.toEqual({ echoed: "ok" });
    expect(answered.size).toBe(2);
    expect(sockets[0].closed).toBeNull();
  });

  describe("cold burst", () => {
    const burst = (
      client: WsRpcClient<typeof registry>,
      lease: MutableBearerLease,
      size: number,
    ): Promise<{ echoed: string }>[] =>
      Array.from({ length: size }, (_, index) =>
        client.request(
          "host.echo",
          { message: `m${index}` },
          plain(authority(lease)),
        ),
      );

    it("shares one handshake among a burst against a host already known to be capable", async () => {
      const { client, sockets, lease, answered } = await coldKnownHost();

      const calls = burst(client, lease, 8);
      await settle();
      // Warm socket plus ONE new dial, not one per call.
      expect(sockets).toHaveLength(2);
      sockets[1].fireOpen();
      await settle();
      expect(sockets).toHaveLength(2);
      expect(openFrames(sockets)).toHaveLength(2);
      expect(requestFrames(sockets[1])).toEqual([]);

      sockets[1].fireMessage(PERSISTENT_ACK);
      await settle();
      expect(requestFrames(sockets[1])).toHaveLength(8);
      expect(sockets).toHaveLength(2);
      answerAll(sockets, answered);

      expect(await Promise.all(calls)).toEqual(
        Array.from({ length: 8 }, () => ({ echoed: "ok" })),
      );
      expect(sockets).toHaveLength(2);
    });

    it("shares one handshake among the first burst of a page when the host was recorded by an earlier page", async () => {
      installPersistentUnaryHostStore({
        read: () => [mockLocalHostEntry.hostId],
        write: () => undefined,
      });
      const { client, sockets } = harness(registry, DESKTOP);
      const lease = new MutableBearerLease("token-1", "test-user");

      const calls = burst(client, lease, 8);
      await settle();
      expect(sockets).toHaveLength(1);

      await establish(sockets[0], PERSISTENT_ACK);
      expect(sockets).toHaveLength(1);
      expect(requestFrames(sockets[0])).toHaveLength(8);
      answerAll(sockets, new Set<string>());

      expect(await Promise.all(calls)).toEqual(
        Array.from({ length: 8 }, () => ({ echoed: "ok" })),
      );
      expect(openFrames(sockets)).toHaveLength(1);
    });

    it("falls back to a one-shot socket per waiter when the recorded host answers without the capability, and forgets the host", async () => {
      const written: string[][] = [];
      installPersistentUnaryHostStore({
        read: () => [mockLocalHostEntry.hostId],
        write: (hostIds) => {
          written.push([...hostIds]);
        },
      });
      const { client, sockets } = harness(registry, DESKTOP);
      const lease = new MutableBearerLease("token-1", "test-user");

      const calls = burst(client, lease, 3);
      await settle();
      expect(sockets).toHaveLength(1);

      await establish(sockets[0], LEGACY_ACK);
      // The dialing call completes one-shot here; each waiter dials its own.
      expect(sockets).toHaveLength(3);
      expect(requestFrames(sockets[0])).toHaveLength(1);
      await establish(sockets[1], LEGACY_ACK);
      await establish(sockets[2], LEGACY_ACK);
      expect(sockets.map((socket) => requestFrames(socket).length)).toEqual([
        1, 1, 1,
      ]);
      expect(sockets).toHaveLength(3);
      answerAll(sockets, new Set<string>());

      expect(await Promise.all(calls)).toEqual([
        { echoed: "ok" },
        { echoed: "ok" },
        { echoed: "ok" },
      ]);
      expect(sockets.map((socket) => socket.closed?.code)).toEqual([
        1000, 1000, 1000,
      ]);
      expect(written[written.length - 1]).toEqual([]);

      // The next overlapping pair is a first contact again: a socket each, at once.
      const pair = burst(client, lease, 2);
      await settle();
      expect(sockets).toHaveLength(5);
      await establish(sockets[3], LEGACY_ACK);
      await establish(sockets[4], LEGACY_ACK);
      answerAll(sockets, new Set<string>(["req-1", "req-2", "req-3"]));
      await Promise.all(pair);
    });

    it("never makes an interactive call wait behind a background dial, and sends late callers over the interactive session", async () => {
      const { client, sockets, priorities, lease, answered } =
        await coldKnownHost();

      const first = client.request("host.status", {}, plain(authority(lease)));
      await settle();
      const interactive = client.request(
        "host.echo",
        { message: "i" },
        plain(authority(lease)),
      );
      await settle();
      expect(sockets).toHaveLength(3);
      expect(priorities.slice(1)).toEqual(["background", "interactive"]);

      const lateStatus = client.request(
        "host.status",
        {},
        plain(authority(lease)),
      );
      const lateEcho = client.request(
        "host.echo",
        { message: "late" },
        plain(authority(lease)),
      );
      await settle();
      expect(sockets).toHaveLength(3);

      await establish(sockets[2], PERSISTENT_ACK);
      expect(
        requestFrames(sockets[2])
          .map((frame) => frame.method)
          .sort(),
      ).toEqual(["host.echo", "host.echo", "host.status"]);
      expect(requestFrames(sockets[1])).toEqual([]);

      // The slower background handshake lands last: its caller moves over too.
      await establish(sockets[1], PERSISTENT_ACK);
      expect(
        requestFrames(sockets[2])
          .map((frame) => frame.method)
          .sort(),
      ).toEqual(["host.echo", "host.echo", "host.status", "host.status"]);
      expect(requestFrames(sockets[1])).toEqual([]);
      expect(sockets[1].closed).not.toBeNull();
      expect(sockets).toHaveLength(3);
      answerAll(sockets, answered);

      expect(
        await Promise.all([first, interactive, lateStatus, lateEcho]),
      ).toEqual([
        { ready: true },
        { echoed: "ok" },
        { ready: true },
        { echoed: "ok" },
      ]);
    });

    it("lets a waiter abort alone without disturbing the shared dial or the other callers", async () => {
      const { client, sockets, lease, answered } = await coldKnownHost();
      const aborting = new AbortController();

      const kept = client.request(
        "host.echo",
        { message: "kept" },
        plain(authority(lease)),
      );
      const leaving = track(
        client.request(
          "host.echo",
          { message: "leaving" },
          plain(
            authorityWith(lease, {
              verdict: undefined,
              cancel: undefined,
              controller: aborting,
            }),
          ),
        ),
      );
      await settle();
      expect(sockets).toHaveLength(2);

      aborting.abort();
      await settle();
      expect(leaving.settled).toBe(true);
      expect(leaving.error).toBeInstanceOf(HostRequestAbortedError);
      expect(sockets[1].closed).toBeNull();

      await establish(sockets[1], PERSISTENT_ACK);
      expect(requestFrames(sockets[1]).map((frame) => frame.params)).toEqual([
        { message: "kept" },
      ]);
      answerAll(sockets, answered);
      await expect(kept).resolves.toEqual({ echoed: "ok" });
      expect(sockets).toHaveLength(2);
    });

    it("rejects every waiter at once, retryably and without dialing, when the shared dial closes before it opens", async () => {
      const { client, sockets, lease } = await coldKnownHost();

      const calls = burst(client, lease, 3).map(track);
      await settle();
      expect(sockets).toHaveLength(2);

      sockets[1].fireClose();
      await settle();

      expect(calls.map((call) => call.settled)).toEqual([true, true, true]);
      for (const call of calls)
        expect(call.error).toBeInstanceOf(RetryableTransportError);
      expect(sockets).toHaveLength(2);
    });

    it("hands the dial to one waiter when the dialing call aborts, and the other waiters wait on that one", async () => {
      const { client, sockets, lease, answered } = await coldKnownHost();
      const dialer = new AbortController();

      const aborted = track(
        client.request(
          "host.echo",
          { message: "dialer" },
          plain(
            authorityWith(lease, {
              verdict: undefined,
              cancel: undefined,
              controller: dialer,
            }),
          ),
        ),
      );
      const second = client.request(
        "host.echo",
        { message: "second" },
        plain(authority(lease)),
      );
      const third = client.request(
        "host.echo",
        { message: "third" },
        plain(authority(lease)),
      );
      await settle();
      expect(sockets).toHaveLength(2);

      dialer.abort();
      await settle();
      expect(aborted.settled).toBe(true);
      expect(aborted.error).toBeInstanceOf(HostRequestAbortedError);
      expect(sockets[1].closed).not.toBeNull();
      // Exactly one waiter took over the dial.
      expect(sockets).toHaveLength(3);

      await establish(sockets[2], PERSISTENT_ACK);
      expect(sockets).toHaveLength(3);
      expect(requestFrames(sockets[2])).toHaveLength(2);
      expect(requestFrames(sockets[2]).map((frame) => frame.params)).toEqual(
        expect.arrayContaining([{ message: "second" }, { message: "third" }]),
      );
      expect(requestFrames(sockets[1])).toEqual([]);
      answerAll(sockets, answered);

      await expect(second).resolves.toEqual({ echoed: "ok" });
      await expect(third).resolves.toEqual({ echoed: "ok" });
    });

    it("does not make a call with a different token wait for a dial made under another token", async () => {
      const { client, sockets, lease, answered } = await coldKnownHost();

      const first = client.request(
        "host.echo",
        { message: "old" },
        plain(authority(lease)),
      );
      await settle();
      expect(sockets).toHaveLength(2);

      lease.rotate("token-2");
      const second = client.request(
        "host.echo",
        { message: "new" },
        plain(authority(lease)),
      );
      await settle();
      expect(sockets).toHaveLength(3);

      sockets[1].fireOpen();
      sockets[2].fireOpen();
      await settle();
      expect(openFrames([sockets[1]])[0]).toMatchObject({ token: "token-1" });
      expect(openFrames([sockets[2]])[0]).toMatchObject({ token: "token-2" });

      await establish(sockets[2], PERSISTENT_ACK);
      sockets[1].fireMessage(PERSISTENT_ACK);
      await settle();
      answerAll(sockets, answered);
      await expect(second).resolves.toEqual({ echoed: "ok" });
      await expect(first).resolves.toEqual({ echoed: "ok" });
    });

    it("sends every waiter to its own dial at once when the dialing call gets a host verdict", async () => {
      const { client, sockets, lease, answered } = await coldKnownHost();

      const calls = burst(client, lease, 3);
      const states = calls.map(track);
      await settle();
      expect(sockets).toHaveLength(2);

      sockets[1].fireOpen();
      await settle();
      sockets[1].fireMessage(fatalUnauthorized);
      await settle();

      // The host answered: its verdict belongs to the dialing call alone.
      expect(states[0].settled).toBe(true);
      expect(states[0].error).toBeInstanceOf(HostRpcError);
      expect(states[0].error).not.toBeInstanceOf(RetryableTransportError);
      expect(states[0].error).toMatchObject({ code: "UNAUTHORIZED" });
      // Both waiters dialed for themselves at once, neither behind the other.
      expect(sockets).toHaveLength(4);
      expect(states.map((state) => state.settled)).toEqual([
        true,
        false,
        false,
      ]);

      await establish(sockets[2], PERSISTENT_ACK);
      await establish(sockets[3], PERSISTENT_ACK);
      expect(
        requestFrames(sockets[2]).length + requestFrames(sockets[3]).length,
      ).toBe(2);
      answerAll(sockets, answered);

      await expect(calls[1]).resolves.toEqual({ echoed: "ok" });
      await expect(calls[2]).resolves.toEqual({ echoed: "ok" });
      expect(sockets).toHaveLength(4);
    });

    it("still treats the host as capable after host verdicts, so the next burst shares one handshake", async () => {
      const { client, sockets, lease, answered } = await coldKnownHost();

      const dialer = track(
        client.request(
          "host.echo",
          { message: "dialer" },
          plain(authority(lease)),
        ),
      );
      const waiter = track(
        client.request(
          "host.echo",
          { message: "waiter" },
          plain(authority(lease)),
        ),
      );
      await settle();
      expect(sockets).toHaveLength(2);
      sockets[1].fireOpen();
      await settle();
      sockets[1].fireMessage(fatalUnauthorized);
      await settle();
      expect(dialer.error).toMatchObject({ code: "UNAUTHORIZED" });

      // The waiter dialed its own socket and gets a verdict too: no capable
      // ack has been seen since, so only the verdicts could have changed what
      // the client believes about this host.
      expect(sockets).toHaveLength(3);
      sockets[2].fireOpen();
      await settle();
      sockets[2].fireMessage(fatalUnauthorized);
      await settle();
      expect(waiter.error).toMatchObject({ code: "UNAUTHORIZED" });

      const pair = burst(client, lease, 2);
      await settle();
      expect(sockets).toHaveLength(4);
      await establish(sockets[3], PERSISTENT_ACK);
      expect(requestFrames(sockets[3])).toHaveLength(2);
      expect(sockets).toHaveLength(4);
      answerAll(sockets, answered);
      expect(await Promise.all(pair)).toEqual([
        { echoed: "ok" },
        { echoed: "ok" },
      ]);
    });

    it("treats a retryable host fatal in place of the ack as a verdict, so each waiter still dials its own socket", async () => {
      const { client, sockets, lease, answered } = await coldKnownHost();
      const details = {
        code: "HOST_NOT_READY",
        reason: "Host is not ready",
        incompatibleMethods: null,
        upgradeGuidance: null,
        retryable: true,
      };

      const calls = burst(client, lease, 3);
      const states = calls.map(track);
      await settle();
      expect(sockets).toHaveLength(2);

      sockets[1].fireOpen();
      await settle();
      sockets[1].fireMessage({ kind: "fatalError", details });
      await settle();

      expect(states[0].settled).toBe(true);
      expect(states[0].error).toBeInstanceOf(RetryableTransportError);
      expect(states[0].error).toMatchObject({ fatalDetails: details });
      // Socket count and the waiters' outcomes in one value, so a failure shows both.
      expect({
        sockets: sockets.length,
        waiters: states.slice(1).map((state) => ({
          settled: state.settled,
          error: state.error,
        })),
      }).toEqual({
        sockets: 4,
        waiters: [
          { settled: false, error: null },
          { settled: false, error: null },
        ],
      });

      await establish(sockets[2], PERSISTENT_ACK);
      await establish(sockets[3], PERSISTENT_ACK);
      expect(
        requestFrames(sockets[2]).length + requestFrames(sockets[3]).length,
      ).toBe(2);
      answerAll(sockets, answered);
      await expect(calls[1]).resolves.toEqual({ echoed: "ok" });
      await expect(calls[2]).resolves.toEqual({ echoed: "ok" });
      expect(sockets).toHaveLength(4);
    });

    it("rejects every waiter retryably in the step the shared dial times out, without a further socket", async () => {
      vi.useFakeTimers();
      const { client, sockets, lease } = await coldKnownHost();

      const states = burst(client, lease, 3).map(track);
      await settle();
      expect(sockets).toHaveLength(2);
      expect(states.map((state) => state.settled)).toEqual([
        false,
        false,
        false,
      ]);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(states.map((state) => state.settled)).toEqual([true, true, true]);
      for (const state of states)
        expect(state.error).toBeInstanceOf(RetryableTransportError);
      expect(sockets).toHaveLength(2);
    });

    it("rejects every waiter retryably in the step the shared handshake gets no ack in time, without a further socket", async () => {
      vi.useFakeTimers();
      const { client, sockets, lease } = await coldKnownHost();

      const states = burst(client, lease, 3).map(track);
      await settle();
      sockets[1].fireOpen();
      await settle();
      expect(sockets).toHaveLength(2);
      expect(states.map((state) => state.settled)).toEqual([
        false,
        false,
        false,
      ]);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(states.map((state) => state.settled)).toEqual([true, true, true]);
      for (const state of states)
        expect(state.error).toBeInstanceOf(RetryableTransportError);
      expect(sockets).toHaveLength(2);
    });

    it("does not make a call with a different cloud verdict wait for a dial made under another verdict", async () => {
      const { client, sockets, lease, answered } = await coldKnownHost();
      const allowed = authorityWith(lease, {
        verdict: { value: true },
        cancel: undefined,
        controller: undefined,
      });
      const denied = authorityWith(lease, {
        verdict: { value: false },
        cancel: undefined,
        controller: undefined,
      });

      const first = client.request(
        "host.echo",
        { message: "a" },
        plain(allowed),
      );
      await settle();
      expect(sockets).toHaveLength(2);
      const second = client.request(
        "host.echo",
        { message: "d" },
        plain(denied),
      );
      await settle();
      expect(sockets).toHaveLength(3);

      sockets[1].fireOpen();
      sockets[2].fireOpen();
      await settle();
      expect(openFrames([sockets[1]])[0]).toMatchObject({
        cloudAuthorized: true,
      });
      expect(openFrames([sockets[2]])[0]).toMatchObject({
        cloudAuthorized: false,
      });

      sockets[1].fireMessage(PERSISTENT_ACK);
      await settle();
      answerAll(sockets, answered);
      await expect(first).resolves.toEqual({ echoed: "ok" });
      sockets[2].fireMessage(PERSISTENT_ACK);
      await settle();
      answerAll(sockets, answered);
      await expect(second).resolves.toEqual({ echoed: "ok" });
      expect(sockets).toHaveLength(3);
    });

    it("still wakes the waiters of a dial whose registration a later interactive dial replaced", async () => {
      const { client, sockets, priorities, lease, answered } =
        await coldKnownHost();

      const a = client.request("host.status", {}, plain(authority(lease)));
      await settle();
      const b = client.request("host.status", {}, plain(authority(lease)));
      await settle();
      expect(sockets).toHaveLength(2);
      const c = client.request(
        "host.echo",
        { message: "c" },
        plain(authority(lease)),
      );
      await settle();
      expect(sockets).toHaveLength(3);
      expect(priorities.slice(1)).toEqual(["background", "interactive"]);

      await establish(sockets[1], PERSISTENT_ACK);
      expect(requestFrames(sockets[1]).map((frame) => frame.method)).toEqual([
        "host.status",
        "host.status",
      ]);
      expect(sockets).toHaveLength(3);

      await establish(sockets[2], PERSISTENT_ACK);
      expect(
        requestFrames(sockets[1]).length + requestFrames(sockets[2]).length,
      ).toBe(3);
      expect(sockets).toHaveLength(3);
      answerAll(sockets, answered);

      expect(await Promise.all([a, b, c])).toEqual([
        { ready: true },
        { ready: true },
        { echoed: "ok" },
      ]);
    });

    it("makes the host prove itself again after the shared dial fails at transport level, until a capable ack", async () => {
      const written: string[][] = [];
      installPersistentUnaryHostStore({
        read: () => [mockLocalHostEntry.hostId],
        write: (hostIds) => {
          written.push([...hostIds]);
        },
      });
      const { client, sockets } = harness(registry, DESKTOP);
      const lease = new MutableBearerLease("token-1", "test-user");

      const failed = burst(client, lease, 3).map(track);
      await settle();
      expect(sockets).toHaveLength(1);

      sockets[0].fireClose();
      await settle();
      expect(failed.map((state) => state.settled)).toEqual([true, true, true]);
      for (const state of failed)
        expect(state.error).toBeInstanceOf(RetryableTransportError);
      expect(sockets).toHaveLength(1);

      // The failure is evidence against the host, not a verdict from it: the
      // memo no longer vouches for it.
      expect(written[written.length - 1]).toEqual([]);
      const pair = burst(client, lease, 2);
      await settle();
      expect(sockets).toHaveLength(3);

      await establish(sockets[1], PERSISTENT_ACK);
      await establish(sockets[2], PERSISTENT_ACK);
      expect(
        requestFrames(sockets[1]).length + requestFrames(sockets[2]).length,
      ).toBe(2);
      expect(sockets).toHaveLength(3);
      answerAll(sockets, new Set<string>());
      expect(await Promise.all(pair)).toEqual([
        { echoed: "ok" },
        { echoed: "ok" },
      ]);

      expect(written[written.length - 1]).toEqual([mockLocalHostEntry.hostId]);
    });
  });

  it("falls back to a socket per call when the host does not acknowledge the capability", async () => {
    const { client, sockets } = harness(registry, DESKTOP);
    const lease = new MutableBearerLease("token-1", "test-user");
    const a = client.request(
      "host.echo",
      { message: "a" },
      plain(authority(lease)),
    );
    const b = client.request(
      "host.echo",
      { message: "b" },
      plain(authority(lease)),
    );
    await settle();
    expect(sockets).toHaveLength(2);
    await establish(sockets[0], LEGACY_ACK);
    await establish(sockets[1], LEGACY_ACK);

    respond(sockets[0], requestFrames(sockets[0])[0], { echoed: "A" });
    respond(sockets[1], requestFrames(sockets[1])[0], { echoed: "B" });
    await expect(a).resolves.toEqual({ echoed: "A" });
    await expect(b).resolves.toEqual({ echoed: "B" });
    expect(sockets.map((socket) => socket.closed?.code)).toEqual([1000, 1000]);
  });

  it("offers the capability from a desktop client but keeps the CLI one-shot even against a capable host", async () => {
    const desktop = harness(registry, DESKTOP);
    const cli = harness(registry, CLI);
    const lease = new MutableBearerLease("token-1", "test-user");

    void desktop.client
      .request("host.echo", { message: "d" }, plain(authority(lease)))
      .catch(() => undefined);
    await establish(desktop.sockets[0], PERSISTENT_ACK);
    expect(openFrames(desktop.sockets)[0].capabilities).toContain(
      UNARY_CAPABILITY_PERSISTENT_SESSION,
    );

    const first = cli.client.request(
      "host.echo",
      { message: "1" },
      plain(authority(lease)),
    );
    await establish(cli.sockets[0], PERSISTENT_ACK);
    expect(openFrames(cli.sockets)[0].capabilities).not.toContain(
      UNARY_CAPABILITY_PERSISTENT_SESSION,
    );
    respond(cli.sockets[0], requestFrames(cli.sockets[0])[0], { echoed: "1" });
    await first;
    expect(cli.sockets[0].closed?.code).toBe(1000);

    const second = cli.client.request(
      "host.echo",
      { message: "2" },
      plain(authority(lease)),
    );
    await establish(cli.sockets[1], PERSISTENT_ACK);
    respond(cli.sockets[1], requestFrames(cli.sockets[1])[0], { echoed: "2" });
    await second;
    expect(cli.sockets).toHaveLength(2);
  });

  it.each(["token", "verdict"] as const)(
    "drains an in-flight command, then negotiates a fresh session, after the %s changes",
    async (change) => {
      const { client, sockets } = harness(registry, DESKTOP);
      const lease = new MutableBearerLease("token-1", "test-user");
      const verdict = { value: true };
      const auth = authorityWith(lease, {
        verdict,
        cancel: undefined,
        controller: undefined,
      });
      const command = client.request("host.status", {}, plain(auth));
      await establish(sockets[0], PERSISTENT_ACK);
      const commandFrame = requestFrames(sockets[0])[0];

      if (change === "token") lease.rotate("token-2");
      else verdict.value = false;
      const next = client.request(
        "host.echo",
        { message: "next" },
        plain(auth),
      );
      await settle();

      expect(sockets).toHaveLength(2);
      await settle();
      sockets[1].fireOpen();
      await settle();
      expect(openFrames([sockets[1]])[0]).toMatchObject(
        change === "token" ? { token: "token-2" } : { cloudAuthorized: false },
      );
      expect(sockets[0].closed).toBeNull();
      respond(sockets[0], commandFrame, { ready: true });
      await expect(command).resolves.toEqual({ ready: true });
      expect(sockets[0].closed).not.toBeNull();

      sockets[1].fireMessage(PERSISTENT_ACK);
      await settle();
      respond(sockets[1], requestFrames(sockets[1])[0], { echoed: "next" });
      await expect(next).resolves.toEqual({ echoed: "next" });
    },
  );

  it("checks a required host version against the session's own negotiated manifest without dialing again", async () => {
    const { client, sockets } = harness(registry, DESKTOP);
    const lease = new MutableBearerLease("token-1", "test-user");
    const first = client.request(
      "host.echo",
      { message: "a" },
      plain(authority(lease)),
    );
    await establish(sockets[0], PERSISTENT_ACK);
    respond(sockets[0], requestFrames(sockets[0])[0], { echoed: "A" });
    await first;

    const tooNew = client.request(
      "host.echo",
      { message: "b" },
      opts(authority(lease), null, {
        method: "host.echo",
        version: { major: 1, minor: 1 },
      }),
    );

    await expect(tooNew).rejects.toBeInstanceOf(
      HostMethodVersionUnsatisfiedError,
    );
    expect(sockets).toHaveLength(1);
    expect(requestFrames(sockets[0])).toHaveLength(1);
  });

  describe("a break after the request was sent", () => {
    it.each([
      {
        name: "socket close",
        key: null,
        deliver: (socket: StubWebSocket) => socket.fireClose(),
      },
      {
        name: "session UNAUTHORIZED fatal",
        key: null,
        deliver: (socket: StubWebSocket) =>
          socket.fireMessage(fatalUnauthorized),
      },
    ])(
      "is an ambiguous transport failure that no layer replays: $name",
      async ({ key, deliver }) => {
        const { client, sockets } = harness(registry, DESKTOP);
        const lease = new MutableBearerLease("token-1", "test-user");
        const revalidate = vi.fn(async () => {
          lease.rotate("token-2");
          return "rotated" as const;
        });
        const stack = createRetryingMessenger<typeof registry>(
          createAuthAwareMessenger<typeof registry>(client, {
            revalidateExpectedBearer: revalidate,
          }),
          {
            maxRetries: 3,
            initialDelayMs: 0,
            maxDelayMs: 0,
            sleep: () => Promise.resolve(),
            random: () => 0,
          },
        );

        const pending = stack.request(
          "host.status",
          {},
          opts(authority(lease), key, null),
        );
        const rejection = pending.then(
          () => null,
          (error: unknown) => error,
        );
        await establish(sockets[0], PERSISTENT_ACK);
        expect(requestFrames(sockets[0])).toHaveLength(1);
        deliver(sockets[0]);

        const error = await rejection;
        expect(error).toBeInstanceOf(HostTransportFailureError);
        expect(error).not.toBeInstanceOf(RetryableTransportError);
        expect(revalidate).not.toHaveBeenCalled();
        expect(sockets).toHaveLength(1);
        expect(requestFrames(sockets[0])).toHaveLength(1);
      },
    );

    it("replays a keyed command after a socket close, on a fresh session under the same idempotency key", async () => {
      // The host deduplicates a negotiated key, so a replay of a command that
      // may already have run is safe - unlike the unkeyed close above.
      const { client, sockets } = harness(registry, DESKTOP);
      const lease = new MutableBearerLease("token-1", "test-user");
      const revalidate = vi.fn(async () => {
        lease.rotate("token-2");
        return "rotated" as const;
      });
      const stack = createRetryingMessenger<typeof registry>(
        createAuthAwareMessenger<typeof registry>(client, {
          revalidateExpectedBearer: revalidate,
        }),
        {
          maxRetries: 3,
          initialDelayMs: 0,
          maxDelayMs: 0,
          sleep: () => Promise.resolve(),
          random: () => 0,
        },
      );

      const pending = stack.request(
        "host.status",
        {},
        opts(authority(lease), "key-1", null),
      );
      await establish(sockets[0], PERSISTENT_ACK);
      const sent = requestFrames(sockets[0]);
      expect(sent).toHaveLength(1);
      expect(sent[0].idempotencyKey).toBe("key-1");

      sockets[0].fireClose();
      await settle();
      expect(sockets).toHaveLength(2);
      await establish(sockets[1], PERSISTENT_ACK);
      const replayed = requestFrames(sockets[1]);
      expect(replayed).toHaveLength(1);
      expect(replayed[0].idempotencyKey).toBe("key-1");
      respond(sockets[1], replayed[0], { ready: true });

      await expect(pending).resolves.toEqual({ ready: true });
      expect(revalidate).not.toHaveBeenCalled();
    });
  });

  describe("cancellation of a dispatched call", () => {
    it.each([
      {
        name: "the authority and the method both permit it",
        method: "host.echo",
        cancel: true,
        sends: true,
      },
      {
        name: "the authority does not opt in",
        method: "host.echo",
        cancel: false,
        sends: false,
      },
      {
        name: "the method is not a cancellable read",
        method: "host.status",
        cancel: true,
        sends: false,
      },
    ] as const)(
      "sends a cancel frame only when $name",
      async ({ method, cancel, sends }) => {
        const { client, sockets } = harness(registry, DESKTOP);
        const lease = new MutableBearerLease("token-1", "test-user");
        const controller = new AbortController();
        const auth = authorityWith(lease, {
          verdict: undefined,
          cancel,
          controller,
        });
        const pending =
          method === "host.echo"
            ? client.request("host.echo", { message: "m" }, plain(auth))
            : client.request("host.status", {}, plain(auth));
        const outcome = (async () => {
          try {
            return { value: await pending };
          } catch (error) {
            return { error };
          }
        })();
        await establish(sockets[0], PERSISTENT_ACK);
        const frame = requestFrames(sockets[0])[0];

        controller.abort();
        await settle();

        if (sends) {
          expect(cancelFrames(sockets[0])).toEqual([
            { kind: "cancel", requestId: frame.requestId },
          ]);
          expect(await outcome).toMatchObject({
            error: expect.any(HostRequestAbortedError),
          });
        } else {
          expect(cancelFrames(sockets[0])).toEqual([]);
          respond(
            sockets[0],
            frame,
            method === "host.echo" ? { echoed: "m" } : { ready: true },
          );
          expect(await outcome).toHaveProperty("value");
        }
      },
    );

    it("does not cancel a read that was degraded onto a method that is not cancellable", async () => {
      const { client, sockets } = harness(degradeRegistry, DESKTOP);
      const lease = new MutableBearerLease("token-1", "test-user");
      const controller = new AbortController();
      const pending = client.request(
        "host.readFallback",
        {},
        plain(readAuthority(lease, controller)),
      );
      const outcome = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await establish(sockets[0], DEGRADE_ACK);
      const frame = requestFrames(sockets[0])[0];
      expect(frame.method).toBe("host.status");

      controller.abort();
      await settle();
      expect(cancelFrames(sockets[0])).toEqual([]);
      respond(sockets[0], frame, { ready: true });

      expect(await outcome).toEqual({ value: { summary: "ready" } });
    });
  });

  it("retires the session when a response deadline passes, so the next call dials a fresh one", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness(registry, DESKTOP);
    const lease = new MutableBearerLease("token-1", "test-user");
    const pending = client.requestWithResponseTimeout(
      "host.echo",
      { message: "slow" },
      50,
      plain(readAuthority(lease, undefined)),
    );
    const rejection = expect(pending).rejects.toBeInstanceOf(
      HostTransportFailureError,
    );
    await establish(sockets[0], PERSISTENT_ACK);

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    // A host that missed a deadline is not trusted with more work, and with
    // nobody left waiting the socket does not linger for a receipt that may
    // never come.
    expect(sockets[0].closed).not.toBeNull();

    const next = client.request(
      "host.echo",
      { message: "next" },
      plain(authority(lease)),
    );
    await settle();
    expect(sockets).toHaveLength(2);
    await establish(sockets[1], PERSISTENT_ACK);
    respond(sockets[1], requestFrames(sockets[1])[0], { echoed: "next" });
    await expect(next).resolves.toEqual({ echoed: "next" });
  });

  it("keeps a sibling that is still waiting alive through a deadline, then closes without the timed-out call's receipt", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness(registry, DESKTOP);
    const lease = new MutableBearerLease("token-1", "test-user");
    await warmSession(client, sockets, lease);

    // Two calls on one session with different deadlines.
    const slow = client.requestWithResponseTimeout(
      "host.echo",
      { message: "slow" },
      50,
      plain(readAuthority(lease, undefined)),
    );
    const slowRejection = expect(slow).rejects.toBeInstanceOf(
      HostTransportFailureError,
    );
    const sibling = client.requestWithResponseTimeout(
      "host.echo",
      { message: "sibling" },
      5_000,
      plain(readAuthority(lease, undefined)),
    );
    await settle();
    const [, slowFrame, siblingFrame] = requestFrames(sockets[0]);

    await vi.advanceTimersByTimeAsync(50);
    await slowRejection;
    // The sibling is still waiting on this socket: it stays open, and the
    // host is told to stop the read that timed out.
    expect(sockets[0].closed).toBeNull();
    expect(cancelFrames(sockets[0])).toEqual([
      { kind: "cancel", requestId: slowFrame.requestId },
    ]);

    // The session takes no new work, so the next call dials its own.
    const next = client.request(
      "host.echo",
      { message: "next" },
      plain(authority(lease)),
    );
    await settle();
    expect(sockets).toHaveLength(2);
    expect(requestFrames(sockets[0])).toHaveLength(3);
    await establish(sockets[1], PERSISTENT_ACK);
    respond(sockets[1], requestFrames(sockets[1])[0], { echoed: "next" });
    await expect(next).resolves.toEqual({ echoed: "next" });

    // The sibling finishes undisturbed. The timed-out call's receipt never
    // arrives, and the retired session still closes.
    respond(sockets[0], siblingFrame, { echoed: "sibling" });
    await expect(sibling).resolves.toEqual({ echoed: "sibling" });
    expect(sockets[0].closed).not.toBeNull();
  });

  it("dials a fresh session for a call that finds the running cap full, and closes the full one once no caller is waiting on it", async () => {
    const { client, sockets } = harness(registry, DESKTOP);
    const lease = new MutableBearerLease("token-1", "test-user");
    await warmSession(client, sockets, lease);
    const controllers = Array.from(
      { length: MAX_RUNNING_REQUESTS },
      () => new AbortController(),
    );
    const calls = controllers.map((controller, index) => {
      const call = client.request(
        "host.echo",
        { message: `m${index}` },
        plain(readAuthority(lease, controller)),
      );
      return call.then(
        () => "resolved",
        (error: unknown) => error,
      );
    });
    await settle();
    const frames = requestFrames(sockets[0]).slice(1);
    expect(frames).toHaveLength(MAX_RUNNING_REQUESTS);

    for (const controller of controllers) controller.abort();
    for (const outcome of await Promise.all(calls))
      expect(outcome).toBeInstanceOf(HostRequestAbortedError);
    expect(cancelFrames(sockets[0])).toHaveLength(MAX_RUNNING_REQUESTS);

    // The caller stopped waiting on every one of these, but the host has not
    // finished them: they still hold their slots, so the full session is not
    // offered the next call (it would have reused this socket had the aborts
    // freed capacity). It dials its own and completes there.
    const over = client.request(
      "host.echo",
      { message: "over" },
      plain(authority(lease)),
    );
    await settle();
    expect(sockets).toHaveLength(2);
    expect(requestFrames(sockets[0])).toHaveLength(MAX_RUNNING_REQUESTS + 1);
    // Nobody is waiting on the retired session, so it does not linger for 64
    // receipts: closing the socket is what ends the host's abandoned work.
    expect(sockets[0].closed).not.toBeNull();
    await establish(sockets[1], PERSISTENT_ACK);
    respond(sockets[1], requestFrames(sockets[1])[0], { echoed: "over" });
    await expect(over).resolves.toEqual({ echoed: "over" });
  });

  describe("a burst larger than the running cap", () => {
    const OVER_CAP = 6;
    const overlapping = (
      client: WsRpcClient<typeof registry>,
      lease: MutableBearerLease,
    ): Promise<{ echoed: string }>[] =>
      Array.from({ length: MAX_RUNNING_REQUESTS + OVER_CAP }, (_, index) =>
        client.request(
          "host.echo",
          { message: `m${index}` },
          plain(authority(lease)),
        ),
      );
    const rejected = (states: readonly { error: unknown }[]): unknown[] =>
      states.map((state) => state.error).filter((error) => error !== null);
    const allAnswered = Array.from(
      { length: MAX_RUNNING_REQUESTS + OVER_CAP },
      () => ({ echoed: "ok" }),
    );

    it("sends the calls beyond the cap of a warm session over one new socket, and rejects none", async () => {
      const { client, sockets } = harness(registry, DESKTOP);
      const lease = new MutableBearerLease("token-1", "test-user");
      await warmSession(client, sockets, lease);
      const answered = new Set(
        requestFrames(sockets[0]).map((frame) => frame.requestId),
      );

      const calls = overlapping(client, lease);
      const states = calls.map(track);
      await settle();

      expect(rejected(states)).toEqual([]);
      expect(requestFrames(sockets[0])).toHaveLength(1 + MAX_RUNNING_REQUESTS);
      expect(sockets).toHaveLength(2);
      expect(requestFrames(sockets[1])).toEqual([]);

      await establish(sockets[1], PERSISTENT_ACK);
      expect(rejected(states)).toEqual([]);
      expect(sockets).toHaveLength(2);
      expect(requestFrames(sockets[1])).toHaveLength(OVER_CAP);
      answerAll(sockets, answered);

      expect(await Promise.all(calls)).toEqual(allAnswered);
      expect(sockets).toHaveLength(2);
    });

    it("fills the first session of a cold known host to the cap, then sends the rest over one more socket, and rejects none", async () => {
      const { client, sockets, lease, answered } = await coldKnownHost();

      const calls = overlapping(client, lease);
      const states = calls.map(track);
      await settle();
      expect(rejected(states)).toEqual([]);
      expect(sockets).toHaveLength(2);

      await establish(sockets[1], PERSISTENT_ACK);
      expect(rejected(states)).toEqual([]);
      expect(requestFrames(sockets[1])).toHaveLength(MAX_RUNNING_REQUESTS);
      expect(sockets).toHaveLength(3);
      expect(requestFrames(sockets[2])).toEqual([]);

      await establish(sockets[2], PERSISTENT_ACK);
      expect(rejected(states)).toEqual([]);
      expect(requestFrames(sockets[2])).toHaveLength(OVER_CAP);
      expect(sockets).toHaveLength(3);
      answerAll(sockets, answered);

      expect(await Promise.all(calls)).toEqual(allAnswered);
      expect(sockets).toHaveLength(3);
    });
  });

  it("closes after the idle window and negotiates a new session for the next call", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness(registry, DESKTOP);
    const lease = new MutableBearerLease("token-1", "test-user");
    const first = client.request(
      "host.echo",
      { message: "a" },
      plain(authority(lease)),
    );
    await establish(sockets[0], PERSISTENT_ACK);
    respond(sockets[0], requestFrames(sockets[0])[0], { echoed: "A" });
    await first;

    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 1);
    expect(sockets[0].closed).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[0].closed).not.toBeNull();

    const second = client.request(
      "host.echo",
      { message: "b" },
      plain(authority(lease)),
    );
    await settle();
    expect(sockets).toHaveLength(2);
    await establish(sockets[1], PERSISTENT_ACK);
    respond(sockets[1], requestFrames(sockets[1])[0], { echoed: "B" });
    await expect(second).resolves.toEqual({ echoed: "B" });
    expect(openFrames(sockets)).toHaveLength(2);
  });

  it("never dispatches on a session negotiated under a token the client has already seen replaced", async () => {
    for (const rotateAfterReads of [0, 1, 2, 3, 4, 5]) {
      const { client, sockets, events } = harness(registry, DESKTOP);
      const bearer = new ScriptedBearer(events);
      const first = client.request(
        "host.echo",
        { message: "a" },
        plain(authority(bearer)),
      );
      await establish(sockets[0], PERSISTENT_ACK);
      respond(sockets[0], requestFrames(sockets[0])[0], { echoed: "A" });
      await first;

      bearer.rotateAfterReads = rotateAfterReads;
      bearer.reads = 0;
      const second = client.request(
        "host.echo",
        { message: "b" },
        plain(authority(bearer)),
      );
      const outcome = second.then(
        () => "resolved",
        (error: unknown) => error,
      );
      await settle();
      if (sockets.length > 1) await establish(sockets[1], PERSISTENT_ACK);
      const newest = sockets[sockets.length - 1];
      const pendingFrame = requestFrames(newest).find(
        (frame) => frame.requestId === "req-2",
      );
      if (pendingFrame !== undefined)
        respond(newest, pendingFrame, { echoed: "B" });

      const result = await outcome;
      if (result !== "resolved") {
        // Definitely unsent: retry-safe, and nothing may have reached any socket.
        expect(result).toBeInstanceOf(RetryableTransportError);
        expect(
          events.filter((event) => event.startsWith("send:request")),
        ).toEqual(["send:request:0"]);
      }
      const rotatedAt = events.indexOf("read:token-2");
      if (rotatedAt >= 0)
        expect(events.slice(rotatedAt)).not.toContain("send:request:0");
    }
  });

  it.each(
    (["before-ack", "at-handoff"] as const).flatMap((timing) =>
      (["abort", "release"] as const).flatMap((release) =>
        [
          { host: "capable", ack: PERSISTENT_ACK },
          { host: "old", ack: LEGACY_ACK },
        ].map(({ host, ack }) => ({ timing, release, host, ack })),
      ),
    ),
  )(
    "closes the cold socket and writes nothing when the credential lease ends $timing ($release, $host host)",
    async ({ timing, release, ack }) => {
      const { client, sockets } = harness(registry, DESKTOP);
      const lease = realLease("token-1");
      const call = client.request(
        "host.echo",
        { message: "m" },
        plain(leaseAuthority(lease)),
      );
      const outcome = call.then(
        () => null,
        (error: unknown) => error,
      );
      await settle();
      expect(sockets).toHaveLength(1);
      sockets[0].fireOpen();
      await settle();
      expect(sockets[0].sentFrames.map((frame) => frame.kind)).toEqual([
        "open",
      ]);

      const end = (): void => {
        if (release === "abort") lease.abort("superseded");
        else lease.credentials.release();
      };
      if (timing === "before-ack") {
        end();
        sockets[0].fireMessage(ack);
      } else {
        // The ack's continuation is already queued when the lease ends, so the handshake completes first and the
        // release lands in the gap before the caller resumes to re-read the bearer.
        sockets[0].fireMessage(ack);
        queueMicrotask(end);
      }

      const error = await outcome;
      await settle();
      if (release === "abort")
        expect(error).toBeInstanceOf(HostRequestAbortedError);
      else {
        expect(error).toBeInstanceOf(HostRpcError);
        expect(error).not.toBeInstanceOf(HostRequestAbortedError);
      }
      expect(sockets[0].closed).not.toBeNull();
      expect(requestFrames(sockets[0])).toEqual([]);
      expect(sockets).toHaveLength(1);
    },
  );

  it.each([
    { name: "dial against a capable host", phase: "dial", ack: PERSISTENT_ACK },
    {
      name: "ack wait against a capable host",
      phase: "ack",
      ack: PERSISTENT_ACK,
    },
    { name: "dial against an old host", phase: "dial", ack: LEGACY_ACK },
    { name: "ack wait against an old host", phase: "ack", ack: LEGACY_ACK },
  ] as const)(
    "closes a cold caller's own socket promptly when it aborts during the $name, without disturbing the other caller",
    async ({ phase, ack }) => {
      const { client, sockets } = harness(registry, DESKTOP);
      const lease = new MutableBearerLease("token-1", "test-user");
      const aborting = new AbortController();
      const abortingCall = client.request(
        "host.echo",
        { message: "aborting" },
        plain(
          authorityWith(lease, {
            verdict: undefined,
            cancel: undefined,
            controller: aborting,
          }),
        ),
      );
      const other = client.request(
        "host.echo",
        { message: "other" },
        plain(authority(lease)),
      );
      const abortingOutcome = abortingCall.then(
        () => null,
        (error: unknown) => error,
      );
      await settle();
      expect(sockets).toHaveLength(2);
      const own = sockets[0];
      if (phase === "ack") {
        own.fireOpen();
        await settle();
        expect(own.sentFrames.map((frame) => frame.kind)).toEqual(["open"]);
      }

      aborting.abort();

      expect(await abortingOutcome).toBeInstanceOf(HostRequestAbortedError);
      expect(own.closed).not.toBeNull();
      own.fireOpen();
      own.fireMessage(ack);
      await settle();
      expect(own.sentFrames.map((frame) => frame.kind)).toEqual(
        phase === "ack" ? ["open"] : [],
      );

      await establish(sockets[1], ack);
      respond(sockets[1], requestFrames(sockets[1])[0], { echoed: "OTHER" });
      await expect(other).resolves.toEqual({ echoed: "OTHER" });
      expect(requestFrames(own)).toEqual([]);
    },
  );
});
