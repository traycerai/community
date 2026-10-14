import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../app/logger";
import {
  DeviceFlowController,
  type DeviceFlowResultPayload,
} from "../device-flow-controller";

vi.mock("../../app/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * Drives the main-process device-flow controller against a mocked global
 * `fetch` so the `/device/authorize` + `/device/token` poll loop runs end to
 * end without a real authn service. Covers the Finding 7/9 guarantees: a
 * terminal result is delivered exactly once, cancellation stops the loop and
 * delivers nothing, and an authorize failure is reported as `ok: false`.
 */
const AUTHN = "http://authn.test";
// A slot-suffixed dev scheme, the shape that most needs to round-trip: the
// /device page must deep-link back to THIS run, not an installed sibling.
const RETURN_SCHEME = "traycer-dev-spry-panda-a2acaa5e";

type FetchHandler = (url: string) => Response;

function installFetch(handler: FetchHandler): () => void {
  const original: unknown = (globalThis as { fetch?: unknown }).fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (input: unknown): Promise<Response> =>
      Promise.resolve(
        handler(typeof input === "string" ? input : String(input)),
      ),
  });
  return () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

function authorizeOk(): Response {
  return new Response(
    JSON.stringify({
      device_code: "device-code-123",
      user_code: "ABCDE-FGHIJ",
      verification_uri: "https://app.test/device",
      verification_uri_complete:
        "https://app.test/device?user_code=ABCDE-FGHIJ",
      expires_in: 600,
      interval: 1,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function tokenAuthorized(): Response {
  return new Response(
    JSON.stringify({ token: "tok", refreshToken: "tok-refresh" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("DeviceFlowController", () => {
  let restoreFetch: () => void = () => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreFetch();
  });

  it("delivers an authorized result after polling through a pending state", async () => {
    let tokenCalls = 0;
    restoreFetch = installFetch((url) => {
      if (url.endsWith("/device/authorize")) {
        return authorizeOk();
      }
      if (url.endsWith("/device/token")) {
        tokenCalls += 1;
        return tokenCalls === 1
          ? new Response(null, { status: 428 }) // authorization-pending
          : tokenAuthorized();
      }
      return new Response(null, { status: 500 });
    });

    const results: Array<{
      attemptId: string;
      result: DeviceFlowResultPayload;
    }> = [];
    const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
    const outcome = await controller.start({
      onResult: (attemptId, result) => results.push({ attemptId, result }),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.authorization.userCode).toBe("ABCDE-FGHIJ");

    // First poll (428) → 1s backoff → second poll (200 authorized).
    await vi.advanceTimersByTimeAsync(1500);

    expect(results).toEqual([
      {
        attemptId: outcome.attemptId,
        result: {
          kind: "authorized",
          token: "tok",
          refreshToken: "tok-refresh",
        },
      },
    ]);
  });

  it("nudges an immediate re-poll on pollNow, collapsing the interval wait", async () => {
    let tokenCalls = 0;
    restoreFetch = installFetch((url) => {
      if (url.endsWith("/device/authorize")) {
        return authorizeOk();
      }
      if (url.endsWith("/device/token")) {
        tokenCalls += 1;
        return tokenCalls === 1
          ? new Response(null, { status: 428 }) // authorization-pending
          : tokenAuthorized();
      }
      return new Response(null, { status: 500 });
    });

    const results: Array<{
      attemptId: string;
      result: DeviceFlowResultPayload;
    }> = [];
    const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
    const outcome = await controller.start({
      onResult: (attemptId, result) => results.push({ attemptId, result }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    // Let the first poll resolve (428) so the loop parks in its ~1s sleep.
    await vi.advanceTimersByTimeAsync(0);
    expect(tokenCalls).toBe(1);
    expect(results).toEqual([]);

    // The browser-return nudge collapses the remaining interval into an
    // immediate re-poll WITHOUT advancing the interval timer.
    controller.pollNow(outcome.attemptId);
    await vi.advanceTimersByTimeAsync(0);

    expect(tokenCalls).toBe(2);
    expect(results).toEqual([
      {
        attemptId: outcome.attemptId,
        result: {
          kind: "authorized",
          token: "tok",
          refreshToken: "tok-refresh",
        },
      },
    ]);
  });

  it("decays the poll interval back to base after a compliant pending poll", async () => {
    let tokenCalls = 0;
    restoreFetch = installFetch((url) => {
      if (url.endsWith("/device/authorize")) {
        return authorizeOk();
      }
      if (url.endsWith("/device/token")) {
        tokenCalls += 1;
        if (tokenCalls === 1) {
          // slow_down widens the 1s base interval to 6s (+5s, no Retry-After).
          return new Response(JSON.stringify({ error: "slow_down" }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }
        return tokenCalls === 2
          ? new Response(null, { status: 428 }) // authorization-pending
          : tokenAuthorized();
      }
      return new Response(null, { status: 500 });
    });

    const results: DeviceFlowResultPayload[] = [];
    const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
    const outcome = await controller.start({
      onResult: (_attemptId, result) => results.push(result),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    // Poll 1 resolves (429): the loop parks in the widened 6s sleep.
    await vi.advanceTimersByTimeAsync(0);
    expect(tokenCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(6_000);
    // Poll 2 (428 pending) was accepted, so the interval must be back at the
    // 1s base - the widened 6s must NOT outlive the violation.
    expect(tokenCalls).toBe(2);
    expect(results).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(tokenCalls).toBe(3);
    expect(results).toEqual([
      { kind: "authorized", token: "tok", refreshToken: "tok-refresh" },
    ]);
  });

  it("ignores pollNow for an unknown or settled attempt", async () => {
    restoreFetch = installFetch((url) => {
      if (url.endsWith("/device/authorize")) {
        return authorizeOk();
      }
      return new Response(null, { status: 428 });
    });

    const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
    const outcome = await controller.start({ onResult: () => undefined });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    // No throw for an unknown attempt id, and a known id is a safe no-op.
    expect(() => controller.pollNow("does-not-exist")).not.toThrow();
    expect(() => controller.pollNow(outcome.attemptId)).not.toThrow();
    controller.cancel(outcome.attemptId);
  });

  it("delivers nothing once the attempt is cancelled (no leaked poll)", async () => {
    restoreFetch = installFetch((url) => {
      if (url.endsWith("/device/authorize")) {
        return authorizeOk();
      }
      // Never approves: stays pending forever.
      return new Response(null, { status: 428 });
    });

    const results: DeviceFlowResultPayload[] = [];
    const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
    const outcome = await controller.start({
      onResult: (_attemptId, result) => results.push(result),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    // Let the first poll resolve, then cancel before the next one.
    await vi.advanceTimersByTimeAsync(0);
    controller.cancel(outcome.attemptId);

    // Advancing well past several poll intervals yields no delivery.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(results).toEqual([]);
  });

  it("threads the return scheme into the verification URL it hands the shell (display URI stays clean)", async () => {
    restoreFetch = installFetch((url) => {
      if (url.endsWith("/device/authorize")) {
        return authorizeOk();
      }
      return tokenAuthorized();
    });
    const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
    const outcome = await controller.start({ onResult: () => undefined });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const opened = new URL(outcome.authorization.verificationUriComplete);
    expect(opened.searchParams.get("return_scheme")).toBe(RETURN_SCHEME);
    // The pre-filled code survives alongside the scheme.
    expect(opened.searchParams.get("user_code")).toBe("ABCDE-FGHIJ");
    // The short display URI stays clean for manual entry.
    expect(outcome.authorization.verificationUri).toBe(
      "https://app.test/device",
    );
    controller.disposeAll();
  });

  it("reports ok:false when /device/authorize fails (renderer surfaces a launch failure)", async () => {
    restoreFetch = installFetch(() => new Response(null, { status: 500 }));

    const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
    const outcome = await controller.start({ onResult: () => undefined });

    expect(outcome.ok).toBe(false);
  });

  describe("when /device/authorize fails, the desktop log names the cause", () => {
    const AUTHORIZE_FAILED = "[device-flow] authorize failed";

    beforeEach(() => {
      vi.mocked(log.warn).mockClear();
    });

    it("logs request-failed when the request itself throws", async () => {
      const original: unknown = (globalThis as { fetch?: unknown }).fetch;
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (): Promise<Response> =>
          Promise.reject(new TypeError("fetch failed")),
      });
      restoreFetch = () =>
        Object.defineProperty(globalThis, "fetch", {
          configurable: true,
          writable: true,
          value: original,
        });

      const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
      const outcome = await controller.start({ onResult: () => undefined });

      expect(outcome).toEqual({ ok: false });
      expect(log.warn).toHaveBeenCalledWith(
        `${AUTHORIZE_FAILED} cause=request-failed`,
      );
    });

    it("logs http-status with the numeric status for a non-200", async () => {
      restoreFetch = installFetch(
        () => new Response("<html>blocked</html>", { status: 503 }),
      );

      const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
      const outcome = await controller.start({ onResult: () => undefined });

      expect(outcome).toEqual({ ok: false });
      expect(log.warn).toHaveBeenCalledWith(
        `${AUTHORIZE_FAILED} cause=http-status status=503`,
      );
    });

    it("logs bad-body when a 200 body is not a device authorization", async () => {
      restoreFetch = installFetch(
        () => new Response("not json at all", { status: 200 }),
      );

      const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
      const outcome = await controller.start({ onResult: () => undefined });

      expect(outcome).toEqual({ ok: false });
      expect(log.warn).toHaveBeenCalledWith(
        `${AUTHORIZE_FAILED} cause=bad-body`,
      );
    });

    it("never puts the url, the body or a header into the line", async () => {
      restoreFetch = installFetch(
        () =>
          new Response("secret-body-token", {
            status: 500,
            headers: { "X-Secret": "secret-header-token" },
          }),
      );

      const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
      await controller.start({ onResult: () => undefined });

      const lines = JSON.stringify(vi.mocked(log.warn).mock.calls);
      expect(lines).not.toContain("secret-body-token");
      expect(lines).not.toContain("secret-header-token");
      expect(lines).not.toContain("authn.test");
    });
  });

  it("delivers a denied result terminally", async () => {
    restoreFetch = installFetch((url) => {
      if (url.endsWith("/device/authorize")) {
        return authorizeOk();
      }
      return new Response(JSON.stringify({ error: "access_denied" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    });

    const results: DeviceFlowResultPayload[] = [];
    const controller = new DeviceFlowController(AUTHN, RETURN_SCHEME);
    const outcome = await controller.start({
      onResult: (_attemptId, result) => results.push(result),
    });
    expect(outcome.ok).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(results).toEqual([{ kind: "denied" }]);
  });
});
