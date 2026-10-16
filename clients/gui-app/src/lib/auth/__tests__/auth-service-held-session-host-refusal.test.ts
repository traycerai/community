import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockRunnerHost } from "@traycer-clients/shared/host-client/mock/mock-runner-host";
import type { OpenFrameBearerSource } from "@traycer-clients/shared/auth/bearer-source";
import {
  AUTH_FETCH_MAX_ATTEMPTS,
  authRetryDelayMs,
} from "@traycer-clients/shared/auth/auth-validation";
import {
  AuthService,
  AUTH_ERROR_SESSION_EXPIRED,
} from "@/lib/auth/auth-service";
import { useAuthStore } from "@/stores/auth/auth-store";

/**
 * A session authn has REFUSED, held open as `unverified` for its local plane,
 * and what a host refusing its bearer does afterwards.
 *
 * The stored access token is rejected by `/api/v3/user` and the refresh token
 * by `/api/v3/auth/refresh` (a 401: `refresh-rejected-credential`), so the
 * session is `unverified` with `cloudVerdictLoss: "session-rejected"` and a
 * "Session expired" error raised once. The bearer it retains is the one the
 * host serves the local plane on, and the host verifies it like any other:
 * once it has expired, every host request fails UNAUTHORIZED and the transport
 * asks `revalidateExpectedBearer` (unary) or `revalidateCurrentContext`
 * (stream) what to do.
 *
 * Before the fix each of those asks re-ran `/api/v3/user` AND re-spent the
 * refresh token authn had already refused, then re-raised "session expired",
 * so the toast came back on every host request (a refresh roughly every three
 * seconds). Now the terminal-rejection latch answers `rejected` without
 * asking authn anything, and a refusal reported by a HOST marks the held
 * bearer as refused (`hostRefusedHeldBearer`) so the shell shows the sign-in
 * page. The status stays `unverified` throughout: the identity is kept and
 * nothing account-scoped is purged.
 *
 * Fixtures follow `auth-service-session-recovery-wake.test.ts`: a
 * `MockRunnerHost`, a `fetch` double keyed on the two authn routes (counted,
 * so "asks authn nothing" is a number rather than an absence), fake timers
 * driven with `vi.advanceTimersByTimeAsync`, never a `vi.waitFor` on a spy
 * count.
 */

// The identity route `validateAuthTokenIdentity*` calls FIRST (see
// `auth-validation.ts`); every fixture in this file answers this one.
const VALIDATION_URL = "http://localhost:5005/api/v3/user/negotiated";
const REFRESH_URL = "http://localhost:5005/api/v3/auth/refresh";

/** How many host refusals the "it used to come back every time" tests replay. */
const HOST_REFUSALS = 10;

type FetchHandler = (
  input: unknown,
  init:
    | {
        readonly method?: string;
        readonly headers?: Record<string, string>;
        readonly body?: BodyInit | null;
      }
    | undefined,
) => Promise<Response>;

type AuthnAnswer = () => Promise<Response>;

/**
 * A `fetch` double for the two authn routes this suite cares about. Every
 * call is counted and answered by the CURRENT `answerValidation` /
 * `answerRefresh`, which a test swaps to move authn from "accepts" to
 * "refuses" mid-scenario. Anything else answers 500.
 */
interface AuthnDouble {
  validationCalls: number;
  refreshCalls: number;
  answerValidation: AuthnAnswer;
  answerRefresh: AuthnAnswer;
  readonly handler: FetchHandler;
}

function status(code: number): Promise<Response> {
  return Promise.resolve(new Response(null, { status: code }));
}

function unreachable(): Promise<Response> {
  return Promise.reject(new TypeError("Failed to fetch"));
}

function createAuthnDouble(): AuthnDouble {
  const double: AuthnDouble = {
    validationCalls: 0,
    refreshCalls: 0,
    answerValidation: () => status(500),
    answerRefresh: () => status(500),
    handler: (input) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === VALIDATION_URL) {
        double.validationCalls += 1;
        return double.answerValidation();
      }
      if (url === REFRESH_URL) {
        double.refreshCalls += 1;
        return double.answerRefresh();
      }
      return status(500);
    },
  };
  return double;
}

function installFetch(handler: FetchHandler): () => void {
  const originalFetch: unknown = (globalThis as { fetch?: unknown }).fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: handler,
  });
  return () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  };
}

const DEFAULT_IDENTITY = {
  id: "user-1",
  email: "test@example.com",
  name: "Test User",
} as const;

/** The `/api/v3/user` body startup validation accepts (auth-service.test.ts's shape). */
function okUser(): Promise<Response> {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        user: {
          id: DEFAULT_IDENTITY.id,
          name: DEFAULT_IDENTITY.name,
          providerId: "gh-1",
          providerHandle: "test-user",
          providerType: "GITHUB",
          email: DEFAULT_IDENTITY.email,
          avatarUrl: null,
          activatedAt: null,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          lastSeenAt: null,
          privacyMode: false,
          isLearningEnabled: true,
        },
        userSubscription: {
          id: "sub-1",
          userID: DEFAULT_IDENTITY.id,
          orgID: null,
          teamID: null,
          customerId: "cus-1",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          subscriptionExpiry: null,
          trialEndsAt: null,
          subscriptionStatus: "FREE",
          hasPaymentMethod: false,
          isInTrial: false,
          rechargeRateSeconds: 0,
        },
        teamSubscriptions: [],
        payAsYouGoUsage: { allowPayAsYouGo: false },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-traycer-user-record-version": "2.0",
        },
      },
    ),
  );
}

const trackedServices: AuthService[] = [];

function makeService(): { service: AuthService; host: MockRunnerHost } {
  const host = new MockRunnerHost({
    signInUrl:
      "https://auth.traycer.ai/sign-in?redirect_uri=traycer%3A%2F%2Fauth",
    authnBaseUrl: "http://localhost:5005",
    localHost: null,
    hosts: [],
    workspaceFolderPickerPaths: undefined,
    hasLocalHost: undefined,
    traycerCli: undefined,
  });
  const service = new AuthService({ runnerHost: host });
  trackedServices.push(service);
  return { service, host };
}

/** Advances past one probe's full internal retry sequence. */
async function advancePastAuthRetries(): Promise<void> {
  for (let retry = 1; retry < AUTH_FETCH_MAX_ATTEMPTS; retry += 1) {
    await vi.advanceTimersByTimeAsync(authRetryDelayMs(retry));
  }
}

/**
 * Counts how many times the "session expired" error is DELIVERED, the way
 * `AuthSessionExpiredToastBridge` consumes it: it toasts the expiry and then
 * clears the durable error so an inline surface never renders stale copy.
 *
 * The acknowledgement is the point. `setLastError` de-duplicates, so without
 * it a second "session expired" would be swallowed as "no change" and the
 * count could not tell a service that re-raised it from one that did not. With
 * it, every re-raise is a fresh delivery - which is the toast the person saw
 * come back.
 */
interface ExpiryDeliveries {
  count(): number;
}

function watchExpiryDeliveries(service: AuthService): ExpiryDeliveries {
  let delivered = 0;
  service.onErrorChange((error) => {
    if (error !== AUTH_ERROR_SESSION_EXPIRED) {
      return;
    }
    delivered += 1;
    service.clearLastError();
  });
  return { count: () => delivered };
}

/** The credentials object a host transport would hand back as `expected`. */
function liveCredentials(service: AuthService): OpenFrameBearerSource {
  const context = service.getRequestContextProvider().current();
  if (context === null) {
    throw new Error("expected a live request context");
  }
  return context.credentials;
}

/**
 * Boots a stored session whose access token AND refresh token authn refuses
 * (401 on both routes). Startup validates, rotates, and lands the session
 * `unverified` on a `session-rejected` verdict, raising "session expired"
 * once.
 */
async function startRefusedSession(authn: AuthnDouble): Promise<{
  service: AuthService;
  host: MockRunnerHost;
  expiry: ExpiryDeliveries;
}> {
  authn.answerValidation = () => status(401);
  authn.answerRefresh = () => status(401);
  const { service, host } = makeService();
  const expiry = watchExpiryDeliveries(service);
  await host.tokenStore.signIn(
    { token: "dead-token", refreshToken: "dead-refresh" },
    { ...DEFAULT_IDENTITY },
  );
  await service.start();
  return { service, host, expiry };
}

describe("AuthService - a host refusing the bearer of a session authn refused", () => {
  let authn: AuthnDouble = createAuthnDouble();
  let restoreFetch: () => void = () => undefined;

  beforeEach(() => {
    useAuthStore.getState().setSignedOut();
    useAuthStore.getState().setCloudVerdictLoss("unreachable");
    authn = createAuthnDouble();
    restoreFetch = installFetch(authn.handler);
  });

  afterEach(() => {
    while (trackedServices.length > 0) {
      const service = trackedServices.pop();
      if (service !== undefined) {
        service.dispose();
      }
    }
    useAuthStore.getState().setSignedOut();
    useAuthStore.getState().setCloudVerdictLoss("unreachable");
    vi.useRealTimers();
    restoreFetch();
  });

  it("asks authn nothing more across repeated unary refusals, raises the expiry once, and marks the held bearer refused", async () => {
    vi.useFakeTimers();
    const { service, expiry } = await startRefusedSession(authn);

    // The verdict, as startup left it: held for the local plane, refused by
    // authn, and not yet reported by any host.
    expect(useAuthStore.getState().status).toBe("unverified");
    expect(useAuthStore.getState().cloudVerdictLoss).toBe("session-rejected");
    expect(useAuthStore.getState().hostRefusedHeldBearer).toBe(false);
    const validationAtVerdict = authn.validationCalls;
    const refreshAtVerdict = authn.refreshCalls;
    // Not vacuous: the verdict itself cost a round trip to each route, so
    // "unchanged" below is a count that could have moved.
    expect(validationAtVerdict).toBeGreaterThan(0);
    expect(refreshAtVerdict).toBeGreaterThan(0);
    expect(expiry.count()).toBe(1);

    const credentials = liveCredentials(service);
    const outcomes: string[] = [];
    for (let refusal = 0; refusal < HOST_REFUSALS; refusal += 1) {
      outcomes.push(await service.revalidateExpectedBearer(credentials));
    }

    // The fetch counts come first: this is where the bug showed, a validation
    // and a re-spent refresh per refusal.
    expect(authn.validationCalls).toBe(validationAtVerdict);
    expect(authn.refreshCalls).toBe(refreshAtVerdict);
    expect(expiry.count()).toBe(1);
    expect(service.getLastError()).toBeNull();
    expect(outcomes).toEqual(
      Array.from({ length: HOST_REFUSALS }, () => "rejected"),
    );
    // The host refused the held bearer AFTER authn refused the session, so the
    // shell sends the person to sign in - while the session itself is kept.
    const after = useAuthStore.getState();
    expect(after.hostRefusedHeldBearer).toBe(true);
    expect(after.status).toBe("unverified");
    expect(after.cloudVerdictLoss).toBe("session-rejected");
    expect(after.profile?.userId).toBe(DEFAULT_IDENTITY.id);

    // Nothing time-driven spends it either.
    await vi.advanceTimersByTimeAsync(60_000);
    await advancePastAuthRetries();
    expect(authn.validationCalls).toBe(validationAtVerdict);
    expect(authn.refreshCalls).toBe(refreshAtVerdict);
    expect(expiry.count()).toBe(1);
  });

  it("asks authn nothing more across repeated stream-path revalidations, and raises no new expiry", async () => {
    vi.useFakeTimers();
    const { service, expiry } = await startRefusedSession(authn);
    const validationAtVerdict = authn.validationCalls;
    const refreshAtVerdict = authn.refreshCalls;
    expect(validationAtVerdict).toBeGreaterThan(0);
    expect(refreshAtVerdict).toBeGreaterThan(0);
    expect(expiry.count()).toBe(1);

    const outcomes: Array<string | undefined> = [];
    for (let attempt = 0; attempt < HOST_REFUSALS; attempt += 1) {
      outcomes.push((await service.revalidateCurrentContext())?.kind);
    }

    expect(authn.validationCalls).toBe(validationAtVerdict);
    expect(authn.refreshCalls).toBe(refreshAtVerdict);
    expect(expiry.count()).toBe(1);
    expect(service.getLastError()).toBeNull();
    expect(outcomes).toEqual(
      Array.from({ length: HOST_REFUSALS }, () => "rejected"),
    );
    // The session is untouched. This path does not speak for a HOST: the
    // settings subscription query reaches it too (`fetchAuthenticatedUser`),
    // and only the transports that saw a host refusal report one - the stream
    // revalidator through the store, `revalidateExpectedBearer` directly.
    const after = useAuthStore.getState();
    expect(after.status).toBe("unverified");
    expect(after.hostRefusedHeldBearer).toBe(false);
  });

  it("holds the same line when the refusal follows a LIVE demotion rather than a stored-session startup", async () => {
    vi.useFakeTimers();
    const { service, host } = makeService();
    const expiry = watchExpiryDeliveries(service);
    authn.answerValidation = okUser;
    await host.tokenStore.signIn(
      { token: "live-token", refreshToken: "live-refresh" },
      { ...DEFAULT_IDENTITY },
    );
    await service.start();
    expect(useAuthStore.getState().status).toBe("signed-in");
    expect(expiry.count()).toBe(0);

    // The live session's reactive rotation: validation and refresh both
    // refuse, and the session is demoted through the terminal arm.
    authn.answerValidation = () => status(401);
    authn.answerRefresh = () => status(401);
    const verdict = await service.revalidateCurrentContext();
    expect(verdict?.kind).toBe("rejected");
    expect(useAuthStore.getState().status).toBe("unverified");
    expect(useAuthStore.getState().cloudVerdictLoss).toBe("session-rejected");
    expect(useAuthStore.getState().hostRefusedHeldBearer).toBe(false);
    expect(expiry.count()).toBe(1);
    const validationAtVerdict = authn.validationCalls;
    const refreshAtVerdict = authn.refreshCalls;
    expect(refreshAtVerdict).toBeGreaterThan(0);

    const credentials = liveCredentials(service);
    const outcomes: string[] = [];
    for (let refusal = 0; refusal < HOST_REFUSALS; refusal += 1) {
      outcomes.push(await service.revalidateExpectedBearer(credentials));
    }

    expect(authn.validationCalls).toBe(validationAtVerdict);
    expect(authn.refreshCalls).toBe(refreshAtVerdict);
    expect(expiry.count()).toBe(1);
    expect(outcomes).toEqual(
      Array.from({ length: HOST_REFUSALS }, () => "rejected"),
    );
    expect(useAuthStore.getState().hostRefusedHeldBearer).toBe(true);
    expect(useAuthStore.getState().status).toBe("unverified");
  });

  it("still asks authn, and records no host refusal, when the held session was only UNREACHABLE", async () => {
    vi.useFakeTimers();
    const { service, host } = makeService();
    authn.answerValidation = unreachable;
    authn.answerRefresh = unreachable;
    await host.tokenStore.signIn(
      { token: "stale-token", refreshToken: "stale-refresh" },
      { ...DEFAULT_IDENTITY },
    );
    const start = service.start();
    await advancePastAuthRetries();
    await start;
    // No verdict at all: unverified, but nothing here is a refusal by authn.
    expect(useAuthStore.getState().status).toBe("unverified");
    expect(useAuthStore.getState().cloudVerdictLoss).toBe("unreachable");

    const credentials = liveCredentials(service);
    const validationBefore = authn.validationCalls;
    const refreshBefore = authn.refreshCalls;
    const pending = service.revalidateExpectedBearer(credentials);
    // No timer has moved yet, so the only fetch that can have happened is this
    // call's own first attempt - the recovery loop's tick is still ahead.
    await vi.advanceTimersByTimeAsync(0);
    expect(authn.validationCalls).toBe(validationBefore + 1);
    await advancePastAuthRetries();

    expect(await pending).toBe("network-error");
    // An unreachable authn is no reason to spend the refresh token.
    expect(authn.refreshCalls).toBe(refreshBefore);
    const after = useAuthStore.getState();
    expect(after.hostRefusedHeldBearer).toBe(false);
    expect(after.status).toBe("unverified");
    expect(after.cloudVerdictLoss).toBe("unreachable");
  });

  it("clears the refusal and the latch when the person signs in again", async () => {
    vi.useFakeTimers();
    const { service, host } = await startRefusedSession(authn);
    const refusedCredentials = liveCredentials(service);
    expect(await service.revalidateExpectedBearer(refusedCredentials)).toBe(
      "rejected",
    );
    expect(useAuthStore.getState().hostRefusedHeldBearer).toBe(true);

    // The interactive sign-in succeeds: authn accepts the freshly authorized
    // token. Starting the attempt already retires the refusal - the person is
    // no longer being held on the dead bearer.
    authn.answerValidation = okUser;
    await service.signIn();
    expect(useAuthStore.getState().status).toBe("signing-in");
    expect(useAuthStore.getState().hostRefusedHeldBearer).toBe(false);
    host.deviceFlow.emitResult({
      kind: "authorized",
      token: "fresh-token",
      refreshToken: "fresh-refresh",
    });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().status).toBe("signed-in");
    });

    const after = useAuthStore.getState();
    expect(after.hostRefusedHeldBearer).toBe(false);
    expect(after.cloudVerdictLoss).toBe("unreachable");
    expect(service.getCurrentSessionSnapshot().token).toBe("fresh-token");

    // The service-side latch cleared with it: a revalidation of the NEW bearer
    // is asked of authn again rather than answered `rejected` from the latch.
    const validationBefore = authn.validationCalls;
    const outcome = await service.revalidateExpectedBearer(
      liveCredentials(service),
    );
    expect(authn.validationCalls).toBe(validationBefore + 1);
    expect(outcome).toBe("rotated");
    expect(useAuthStore.getState().hostRefusedHeldBearer).toBe(false);
  });
});
