import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import type {
  ProviderRateLimits,
  RateLimitUnavailableReason,
} from "@traycer/protocol/host";
import type {
  ProviderCliState,
  ProviderProfile,
} from "@traycer/protocol/host/provider-schemas";
import type { ResponseOfMethod } from "@traycer-clients/shared/host-transport/host-messenger";
import { rateLimitProviderState } from "@/hooks/rate-limits/__tests__/profile-usage-fixtures";
import {
  buildProviderRateLimitEnvelope,
  envelopeDegradedReason,
  isTransientUnavailableReason,
  mapResponseToProviderRateLimitEnvelope,
  resolveRetainedProviderRateLimits,
  type ProviderRateLimitEnvelope,
  type RateLimitUsageResponse,
} from "@/lib/rate-limits/rate-limit-envelope";
import { DEFAULT_ACCOUNT_CONTEXT } from "@traycer/protocol/common/schemas";
import type { HostRpcRegistry } from "@/lib/host";
import { queryKeys } from "@/lib/query-keys";
import { hostQueryKeys } from "@/lib/query-keys/host-query-keys";
import { providersListQueryKey } from "@/lib/query-keys/providers-query-keys";

const GOOD: ProviderRateLimits = {
  provider: "claude-code",
  available: true,
  subscriptionType: "max",
  fiveHour: { usedPercent: 10, resetsAt: null, durationMinutes: 300 },
  sevenDay: null,
  sevenDayOpus: null,
  sevenDaySonnet: null,
  modelScoped: [],
  extraUsage: null,
};

const OTHER_GOOD: ProviderRateLimits = {
  ...GOOD,
  fiveHour: { usedPercent: 40, resetsAt: null, durationMinutes: 300 },
};

const CODEX_WITH_RESET_DETAILS: ProviderRateLimits = {
  provider: "codex",
  available: true,
  planType: "plus",
  limitId: "codex",
  limitName: "Codex",
  primary: null,
  secondary: null,
  extraWindows: [],
  credits: null,
  individualLimit: null,
  resetCredits: {
    availableCount: 2,
    credits: [
      {
        id: "reset-1",
        resetType: "codexRateLimits",
        status: "available",
        grantedAt: 500,
        expiresAt: 10_000,
        title: "Full reset",
        description: null,
      },
      {
        id: "reset-2",
        resetType: "codexRateLimits",
        status: "available",
        grantedAt: 750,
        expiresAt: 20_000,
        title: "Full reset",
        description: null,
      },
    ],
  },
  rateLimitReachedType: null,
};

const GROK_GOOD: ProviderRateLimits = {
  provider: "grok",
  available: true,
  subscriptionTier: "SuperGrok",
  periodType: "USAGE_PERIOD_TYPE_WEEKLY",
  periodStart: 1_784_678_400_000,
  periodEnd: 1_785_283_200_000,
  period: {
    usedPercent: 12,
    resetsAt: 1_785_283_200_000,
    durationMinutes: 10_080,
  },
  monthlyLimit: null,
  onDemandCap: null,
  onDemandUsed: null,
  prepaidBalance: null,
};

function response(
  providerRateLimits: ProviderRateLimits | null,
): RateLimitUsageResponse {
  return {
    totalTokens: 0,
    remainingTokens: 0,
    providerRateLimits,
    usageUpdatedAt: null,
  };
}

function unavailable(reason: RateLimitUnavailableReason): ProviderRateLimits {
  return { provider: "claude-code", available: false, reason };
}

describe("isTransientUnavailableReason", () => {
  it("treats usage_fetch_failed, timeout, and connection_failed as transient", () => {
    expect(isTransientUnavailableReason("usage_fetch_failed")).toBe(true);
    expect(isTransientUnavailableReason("timeout")).toBe(true);
    expect(isTransientUnavailableReason("connection_failed")).toBe(true);
  });

  it("treats every other reason as authoritative", () => {
    expect(isTransientUnavailableReason("rate_limits_not_available")).toBe(
      false,
    );
    expect(isTransientUnavailableReason("cli_not_found")).toBe(false);
    expect(isTransientUnavailableReason("insufficient_permissions")).toBe(
      false,
    );
    expect(isTransientUnavailableReason("sdk_incompatible")).toBe(false);
    expect(isTransientUnavailableReason("unsupported_provider")).toBe(false);
    expect(isTransientUnavailableReason("invalid_response")).toBe(false);
  });
});

describe("buildProviderRateLimitEnvelope", () => {
  it("cold start (no previous envelope): a good reading becomes latest and lastGood", () => {
    const envelope = buildProviderRateLimitEnvelope(
      undefined,
      response(GOOD),
      1_000,
    );
    expect(envelope).toEqual({
      latest: GOOD,
      lastGood: GOOD,
      lastGoodAt: 1_000,
      lastFailureAt: null,
    });
  });

  it.each(["usage_fetch_failed", "timeout", "connection_failed"] as const)(
    "retains a prior lastGood across a transient failure (%s), advancing lastFailureAt only",
    (reason) => {
      const previous: ProviderRateLimitEnvelope = {
        latest: GOOD,
        lastGood: GOOD,
        lastGoodAt: 1_000,
        lastFailureAt: null,
      };
      const envelope = buildProviderRateLimitEnvelope(
        previous,
        response(unavailable(reason)),
        2_000,
      );
      expect(envelope).toEqual({
        latest: unavailable(reason),
        lastGood: GOOD,
        lastGoodAt: 1_000,
        lastFailureAt: 2_000,
      });
    },
  );

  it("cold-after-reload: a transient failure with no previous envelope has nothing to retain", () => {
    const envelope = buildProviderRateLimitEnvelope(
      undefined,
      response(unavailable("usage_fetch_failed")),
      1_000,
    );
    expect(envelope).toEqual({
      latest: unavailable("usage_fetch_failed"),
      lastGood: null,
      lastGoodAt: null,
      lastFailureAt: 1_000,
    });
  });

  it("retains OpenCode last-good only when a transient carries the same generation", () => {
    const openCodeGood: ProviderRateLimits = {
      provider: "opencode",
      available: true,
      credentialGeneration: "gen-a",
      fiveHour: {
        status: "ok",
        usedPercent: 10,
        resetsAt: 2_000,
        durationMinutes: 300,
      },
      weekly: {
        status: "ok",
        usedPercent: 20,
        resetsAt: 2_000,
        durationMinutes: 10_080,
      },
      monthly: {
        status: "ok",
        usedPercent: 30,
        resetsAt: 2_000,
        durationMinutes: null,
      },
    };
    const previous: ProviderRateLimitEnvelope = {
      latest: openCodeGood,
      lastGood: openCodeGood,
      lastGoodAt: 1_000,
      lastFailureAt: null,
    };
    const sameGeneration: ProviderRateLimits = {
      provider: "opencode",
      available: false,
      reason: "usage_fetch_failed",
      credentialGeneration: "gen-a",
    };
    expect(
      buildProviderRateLimitEnvelope(previous, response(sameGeneration), 2_000),
    ).toEqual({
      latest: sameGeneration,
      lastGood: openCodeGood,
      lastGoodAt: 1_000,
      lastFailureAt: 2_000,
    });
  });

  it("clears OpenCode last-good when the transient generation differs or is missing", () => {
    const openCodeGood: ProviderRateLimits = {
      provider: "opencode",
      available: true,
      credentialGeneration: "gen-a",
      fiveHour: {
        status: "ok",
        usedPercent: 10,
        resetsAt: 2_000,
        durationMinutes: 300,
      },
      weekly: {
        status: "ok",
        usedPercent: 20,
        resetsAt: 2_000,
        durationMinutes: 10_080,
      },
      monthly: {
        status: "ok",
        usedPercent: 30,
        resetsAt: 2_000,
        durationMinutes: null,
      },
    };
    const previous: ProviderRateLimitEnvelope = {
      latest: openCodeGood,
      lastGood: openCodeGood,
      lastGoodAt: 1_000,
      lastFailureAt: null,
    };
    const differentGeneration: ProviderRateLimits = {
      provider: "opencode",
      available: false,
      reason: "timeout",
      credentialGeneration: "gen-b",
    };
    expect(
      buildProviderRateLimitEnvelope(
        previous,
        response(differentGeneration),
        2_000,
      ),
    ).toEqual({
      latest: differentGeneration,
      lastGood: null,
      lastGoodAt: null,
      lastFailureAt: 2_000,
    });

    const missingGeneration: ProviderRateLimits = {
      provider: "opencode",
      available: false,
      reason: "connection_failed",
    };
    expect(
      buildProviderRateLimitEnvelope(
        previous,
        response(missingGeneration),
        3_000,
      ),
    ).toEqual({
      latest: missingGeneration,
      lastGood: null,
      lastGoodAt: null,
      lastFailureAt: 3_000,
    });
  });

  it("an authoritative reason (rate_limits_not_available) replaces the picture entirely, clearing any retained lastGood", () => {
    const previous: ProviderRateLimitEnvelope = {
      latest: GOOD,
      lastGood: GOOD,
      lastGoodAt: 1_000,
      lastFailureAt: 500,
    };
    const envelope = buildProviderRateLimitEnvelope(
      previous,
      response(unavailable("rate_limits_not_available")),
      2_000,
    );
    expect(envelope).toEqual({
      latest: unavailable("rate_limits_not_available"),
      lastGood: null,
      lastGoodAt: null,
      lastFailureAt: null,
    });
  });

  it("a fresh good reading replaces an older lastGood and clears lastFailureAt tracking forward, keeping only the new lastGoodAt", () => {
    const previous: ProviderRateLimitEnvelope = {
      latest: unavailable("usage_fetch_failed"),
      lastGood: GOOD,
      lastGoodAt: 1_000,
      lastFailureAt: 1_500,
    };
    const envelope = buildProviderRateLimitEnvelope(
      previous,
      response(OTHER_GOOD),
      2_000,
    );
    expect(envelope).toEqual({
      latest: OTHER_GOOD,
      lastGood: OTHER_GOOD,
      lastGoodAt: 2_000,
      // lastFailureAt is preserved (still true that a failure happened at
      // some point) until either another failure or an authoritative
      // unavailable reason updates it again.
      lastFailureAt: 1_500,
    });
  });

  it("retains Codex reset-credit details when a refresh only reports the unchanged count", () => {
    const previous: ProviderRateLimitEnvelope = {
      latest: CODEX_WITH_RESET_DETAILS,
      lastGood: CODEX_WITH_RESET_DETAILS,
      lastGoodAt: 1_000,
      lastFailureAt: null,
    };
    const countOnlyRefresh: ProviderRateLimits = {
      ...CODEX_WITH_RESET_DETAILS,
      primary: { usedPercent: 42, resetsAt: 30_000, durationMinutes: 300 },
      resetCredits: { availableCount: 2, credits: null },
    };
    const envelope = buildProviderRateLimitEnvelope(
      previous,
      response(countOnlyRefresh),
      2_000,
    );

    expect(envelope.latest).toEqual({
      ...countOnlyRefresh,
      resetCredits: CODEX_WITH_RESET_DETAILS.resetCredits,
    });
    expect(envelope.lastGood).toEqual(envelope.latest);
    expect(envelope.lastGoodAt).toBe(2_000);
  });

  it("does not retain Codex reset-credit details when the count changes", () => {
    const previous: ProviderRateLimitEnvelope = {
      latest: CODEX_WITH_RESET_DETAILS,
      lastGood: CODEX_WITH_RESET_DETAILS,
      lastGoodAt: 1_000,
      lastFailureAt: null,
    };
    const countOnlyRefresh: ProviderRateLimits = {
      ...CODEX_WITH_RESET_DETAILS,
      resetCredits: { availableCount: 1, credits: null },
    };

    expect(
      buildProviderRateLimitEnvelope(
        previous,
        response(countOnlyRefresh),
        2_000,
      ).latest,
    ).toEqual(countOnlyRefresh);
  });

  it("does not replace an explicit empty Codex credit list with cached details", () => {
    const previous: ProviderRateLimitEnvelope = {
      latest: CODEX_WITH_RESET_DETAILS,
      lastGood: CODEX_WITH_RESET_DETAILS,
      lastGoodAt: 1_000,
      lastFailureAt: null,
    };
    const emptyDetailRefresh: ProviderRateLimits = {
      ...CODEX_WITH_RESET_DETAILS,
      resetCredits: { availableCount: 2, credits: [] },
    };

    expect(
      buildProviderRateLimitEnvelope(
        previous,
        response(emptyDetailRefresh),
        2_000,
      ).latest,
    ).toEqual(emptyDetailRefresh);
  });

  it("treats a null provider snapshot (aperture-only response) like an authoritative reset", () => {
    const previous: ProviderRateLimitEnvelope = {
      latest: GOOD,
      lastGood: GOOD,
      lastGoodAt: 1_000,
      lastFailureAt: null,
    };
    const envelope = buildProviderRateLimitEnvelope(
      previous,
      response(null),
      2_000,
    );
    expect(envelope).toEqual({
      latest: null,
      lastGood: null,
      lastGoodAt: null,
      lastFailureAt: null,
    });
  });
});

describe("resolveRetainedProviderRateLimits", () => {
  it("is null for a null envelope (cold, no fetch has ever landed)", () => {
    expect(resolveRetainedProviderRateLimits(null)).toBeNull();
  });

  it("is null when the envelope carries no provider snapshot", () => {
    expect(
      resolveRetainedProviderRateLimits({
        latest: null,
        lastGood: null,
        lastGoodAt: null,
        lastFailureAt: null,
      }),
    ).toBeNull();
  });

  it("returns the fresh reading when latest is available", () => {
    expect(
      resolveRetainedProviderRateLimits({
        latest: GOOD,
        lastGood: GOOD,
        lastGoodAt: 1_000,
        lastFailureAt: null,
      }),
    ).toEqual(GOOD);
  });

  it("returns the retained lastGood for a transient failure with one present", () => {
    expect(
      resolveRetainedProviderRateLimits({
        latest: unavailable("timeout"),
        lastGood: GOOD,
        lastGoodAt: 1_000,
        lastFailureAt: 2_000,
      }),
    ).toEqual(GOOD);
  });

  it("returns the raw unavailable arm for a transient failure with no lastGood (cold-after-reload)", () => {
    const latest = unavailable("connection_failed");
    expect(
      resolveRetainedProviderRateLimits({
        latest,
        lastGood: null,
        lastGoodAt: null,
        lastFailureAt: 1_000,
      }),
    ).toEqual(latest);
  });

  it("returns the raw unavailable arm for an authoritative reason, never the retained lastGood", () => {
    const latest = unavailable("rate_limits_not_available");
    expect(
      resolveRetainedProviderRateLimits({
        latest,
        // Shouldn't normally coexist (an authoritative reason clears
        // lastGood per buildProviderRateLimitEnvelope), but proves the
        // resolver itself never substitutes lastGood for a non-transient
        // reason even if one were somehow present.
        lastGood: GOOD,
        lastGoodAt: 1_000,
        lastFailureAt: null,
      }),
    ).toEqual(latest);
  });
});

describe("envelopeDegradedReason", () => {
  it("is null for a null envelope", () => {
    expect(envelopeDegradedReason(null)).toBeNull();
  });

  it("is null when latest is a fresh good reading", () => {
    expect(
      envelopeDegradedReason({
        latest: GOOD,
        lastGood: GOOD,
        lastGoodAt: 1_000,
        lastFailureAt: null,
      }),
    ).toBeNull();
  });

  it("is the transient reason when a lastGood is being shown in its place", () => {
    expect(
      envelopeDegradedReason({
        latest: unavailable("usage_fetch_failed"),
        lastGood: GOOD,
        lastGoodAt: 1_000,
        lastFailureAt: 2_000,
      }),
    ).toBe("usage_fetch_failed");
  });

  it("is null for an authoritative reason (that replaces, never dims)", () => {
    expect(
      envelopeDegradedReason({
        latest: unavailable("rate_limits_not_available"),
        lastGood: null,
        lastGoodAt: null,
        lastFailureAt: null,
      }),
    ).toBeNull();
  });

  it("is null for a transient reason with no lastGood to dim", () => {
    expect(
      envelopeDegradedReason({
        latest: unavailable("timeout"),
        lastGood: null,
        lastGoodAt: null,
        lastFailureAt: 1_000,
      }),
    ).toBeNull();
  });
});

const CODEX_GOOD: ProviderRateLimits = {
  provider: "codex",
  available: true,
  planType: null,
  limitId: null,
  limitName: null,
  primary: { usedPercent: 10, resetsAt: null, durationMinutes: 300 },
  secondary: null,
  extraWindows: [],
  credits: null,
  individualLimit: null,
  resetCredits: null,
  rateLimitReachedType: null,
};

const OPENROUTER_GOOD: ProviderRateLimits = {
  provider: "openrouter",
  available: true,
  limit: null,
  limitRemaining: null,
  dailySpend: null,
  weeklySpend: null,
  monthlySpend: null,
  totalCredits: null,
  totalUsage: null,
  balance: null,
};

describe("mapResponseToProviderRateLimitEnvelope providers.list convergence", () => {
  const RATE_LIMIT_KEY = ["host", "host-a", "host.getRateLimitUsage", {}];
  const CLASSIC_KEY = providersListQueryKey("host-a");
  const observers: Array<() => void> = [];

  afterEach(() => {
    for (const unsubscribe of observers.splice(0)) unsubscribe();
  });

  /** An observed query whose reads stay pending until settled; the first is settled here. */
  async function watchSettled(
    queryClient: QueryClient,
    key: QueryKey,
  ): Promise<Array<() => void>> {
    const reads: Array<() => void> = [];
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () =>
        new Promise<object>((resolve) => {
          reads.push(() => {
            resolve({});
          });
        }),
      staleTime: Infinity,
      retry: false,
    });
    observers.push(observer.subscribe(() => undefined));
    reads[0]();
    await flush();
    return reads;
  }

  async function flush(): Promise<void> {
    for (let hop = 0; hop < 20; hop += 1) await Promise.resolve();
  }

  /**
   * A `host.getRateLimitUsage` read on the serving host, folded through the
   * mapper inside its queryFn the way `fetchProviderRateLimits` does. The
   * convergence read is owed when the host's last such read settles, so it is
   * driven by real fetches rather than a bare mapper call.
   */
  async function fetchResolved(
    queryClient: QueryClient,
    provider: ProviderRateLimits | null,
  ): Promise<void> {
    const queryKey = queryKeys.hostMethod<
      HostRpcRegistry,
      "host.getRateLimitUsage"
    >("host-a", "host.getRateLimitUsage", {
      accountContext: DEFAULT_ACCOUNT_CONTEXT,
      providerId: "codex",
      profileId: provider?.provider ?? "aperture-only",
    });
    await queryClient.fetchQuery({
      queryKey,
      queryFn: () =>
        Promise.resolve(
          mapResponseToProviderRateLimitEnvelope({
            response: response(provider),
            queryClient,
            queryKey,
          }),
        ),
      staleTime: 0,
      retry: false,
    });
  }

  it.each([
    { provider: "claude-code", snapshot: GOOD, converges: true },
    { provider: "codex", snapshot: CODEX_GOOD, converges: true },
    { provider: "grok", snapshot: GROK_GOOD, converges: true },
    // Never carry managed profiles, or nothing new to converge on.
    { provider: "openrouter", snapshot: OPENROUTER_GOOD, converges: false },
    {
      provider: "a failed probe",
      snapshot: unavailable("timeout"),
      converges: false,
    },
    {
      provider: "a missing CLI",
      snapshot: {
        provider: "codex",
        available: false,
        reason: "cli_not_found",
      } satisfies ProviderRateLimits,
      converges: false,
    },
    { provider: "an aperture-only response", snapshot: null, converges: false },
  ])(
    "refreshes the serving host's provider list for $provider only when it can converge",
    async ({ snapshot, converges }) => {
      const queryClient = new QueryClient();
      const classic = await watchSettled(queryClient, CLASSIC_KEY);

      await fetchResolved(queryClient, snapshot);
      await flush();

      expect(classic).toHaveLength(converges ? 2 : 1);
    },
  );

  it("touches only the serving host's classic list, leaving other hosts, native inventories and unrelated queries alone", async () => {
    const queryClient = new QueryClient();
    const classic = await watchSettled(queryClient, CLASSIC_KEY);
    const untouched = [
      ["host", "host-b", "providers.list", { native: null }],
      [
        "host",
        "host-a",
        "providers.list",
        {
          native: {
            kind: "skills",
            providerId: "codex",
            scope: "global",
            workspaceRoot: null,
          },
        },
        "providers",
        "native",
        "skills",
      ],
      RATE_LIMIT_KEY,
    ];
    const others = await Promise.all(
      untouched.map((key) => watchSettled(queryClient, key)),
    );

    await fetchResolved(queryClient, GOOD);
    await flush();

    expect(classic).toHaveLength(2);
    for (const reads of others) expect(reads).toHaveLength(1);
    for (const key of untouched) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }
  });

  it("answers responses landing in the same tick with one read", async () => {
    const queryClient = new QueryClient();
    const classic = await watchSettled(queryClient, CLASSIC_KEY);

    await Promise.all([
      fetchResolved(queryClient, GOOD),
      fetchResolved(queryClient, CODEX_GOOD),
      fetchResolved(queryClient, GROK_GOOD),
    ]);
    await flush();

    expect(classic).toHaveLength(2);
  });

  it("holds its query-cache listener only while a convergence is owed, and arms it again for a later burst", async () => {
    const queryClient = new QueryClient();
    const cache = queryClient.getQueryCache();
    const classic = await watchSettled(queryClient, CLASSIC_KEY);
    expect(cache.hasListeners()).toBe(false);

    await fetchResolved(queryClient, GOOD);
    await flush();
    // The host's last read settled and the list converged: nothing is owed,
    // so nothing may keep listening to every query event for the page's life.
    expect(classic).toHaveLength(2);
    expect(cache.hasListeners()).toBe(false);

    // The refresh that convergence started answers; a later, settled burst
    // then owes a convergence again and gets one.
    classic[1]();
    await flush();
    await fetchResolved(queryClient, CODEX_GOOD);
    await flush();
    expect(classic).toHaveLength(3);
    expect(cache.hasListeners()).toBe(false);
  });

  /**
   * A host that stamps its captures (`host.getRateLimitUsage@5.1`): the list is
   * re-read only when a capture is newer than, or missing from, the list's row
   * for that provider and profile. `list.reads.length` is the list reads started
   * in total, so a held capture is 1 and a behind one is 2.
   */
  describe("with a host that stamps its captures", () => {
    type ProvidersListResponse = ResponseOfMethod<
      HostRpcRegistry,
      "providers.list"
    >;

    function profileRow(input: {
      readonly profileId: string;
      readonly kind: ProviderProfile["kind"];
      readonly usageUpdatedAt: number | null;
    }): ProviderProfile {
      return {
        profileId: input.profileId,
        enabled: true,
        kind: input.kind,
        authType: "oauth",
        label: input.profileId,
        auth: {
          status: "authenticated",
          badgeText: null,
          label: null,
          detail: null,
        },
        identity: {
          email: `${input.profileId}@example.com`,
          tier: "Pro",
          accountUuid: `${input.profileId}-uuid`,
        },
        usageUpdatedAt: input.usageUpdatedAt,
        rateLimitStatus: "unknown",
        rateLimitLimitedScopes: null,
        duplicateOfProfileId: null,
        accentColor: null,
        ambientDriftNotice: null,
      };
    }

    function providerRow(
      providerId: ProviderCliState["providerId"],
      profiles: ReadonlyArray<ProviderProfile>,
    ): ProviderCliState {
      return {
        ...rateLimitProviderState("claude-code", "authenticated"),
        providerId,
        profiles: [...profiles],
      };
    }

    function listOf(
      ...providers: ReadonlyArray<ProviderCliState>
    ): ProvidersListResponse {
      return { providers: [...providers], native: null };
    }

    /** The ambient row of `providerId`, stamped at `usageUpdatedAt`. */
    function ambientOf(
      providerId: ProviderCliState["providerId"],
      usageUpdatedAt: number | null,
    ): ProviderCliState {
      return providerRow(providerId, [
        profileRow({ profileId: "ambient", kind: "ambient", usageUpdatedAt }),
      ]);
    }

    /** The classic list, observed; every read stays pending until answered. */
    function watchList(queryClient: QueryClient): {
      readonly reads: Array<(list: ProvidersListResponse) => void>;
    } {
      const reads: Array<(list: ProvidersListResponse) => void> = [];
      const observer = new QueryObserver(queryClient, {
        queryKey: CLASSIC_KEY,
        queryFn: () =>
          new Promise<ProvidersListResponse>((resolve) => {
            reads.push(resolve);
          }),
        staleTime: Infinity,
        retry: false,
      });
      observers.push(observer.subscribe(() => undefined));
      return { reads };
    }

    function rateLimitKey(
      snapshot: ProviderRateLimits,
      profileId: string | null,
    ): QueryKey {
      return queryKeys.hostMethod<HostRpcRegistry, "host.getRateLimitUsage">(
        "host-a",
        "host.getRateLimitUsage",
        {
          accountContext: DEFAULT_ACCOUNT_CONTEXT,
          providerId: snapshot.provider,
          profileId,
        },
      );
    }

    /** One read answered with a snapshot captured at `usageUpdatedAt`. */
    async function fetchStamped(
      queryClient: QueryClient,
      read: {
        readonly snapshot: ProviderRateLimits;
        readonly profileId: string | null;
        readonly usageUpdatedAt: number | null;
      },
    ): Promise<void> {
      const queryKey = rateLimitKey(read.snapshot, read.profileId);
      await queryClient.fetchQuery({
        queryKey,
        queryFn: () =>
          Promise.resolve(
            mapResponseToProviderRateLimitEnvelope({
              response: {
                ...response(read.snapshot),
                usageUpdatedAt: read.usageUpdatedAt,
              },
              queryClient,
              queryKey,
            }),
          ),
        staleTime: 0,
        retry: false,
      });
    }

    /** A stamped read that stays in flight until `settle` is called. */
    function startPendingRead(queryClient: QueryClient): {
      readonly settle: () => void;
    } {
      let settle: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const queryKey = rateLimitKey(CODEX_GOOD, "pending-profile");
      void queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          await gate;
          return mapResponseToProviderRateLimitEnvelope({
            response: { ...response(CODEX_GOOD), usageUpdatedAt: 1000 },
            queryClient,
            queryKey,
          });
        },
        staleTime: 0,
        retry: false,
      });
      return { settle };
    }

    it("does not re-read a list whose row already holds the capture", async () => {
      const queryClient = new QueryClient();
      const list = watchList(queryClient);
      list.reads[0](listOf(ambientOf("codex", 1000)));
      await flush();

      await fetchStamped(queryClient, {
        snapshot: CODEX_GOOD,
        profileId: null,
        usageUpdatedAt: 1000,
      });
      await flush();

      expect(list.reads).toHaveLength(1);
    });

    it("re-reads a list whose row is older than the capture, once", async () => {
      const queryClient = new QueryClient();
      const list = watchList(queryClient);
      list.reads[0](listOf(ambientOf("codex", 1000)));
      await flush();

      await fetchStamped(queryClient, {
        snapshot: CODEX_GOOD,
        profileId: null,
        usageUpdatedAt: 2000,
      });
      await flush();

      expect(list.reads).toHaveLength(2);
    });

    it.each([
      { name: "a row older than the capture", list: ambientOf("codex", 500) },
      { name: "a row with no capture time", list: ambientOf("codex", null) },
      {
        name: "no row for the provider",
        list: ambientOf("grok", 5000),
      },
      {
        name: "no row for the ambient profile",
        list: providerRow("codex", [
          profileRow({
            profileId: "p-2",
            kind: "managed",
            usageUpdatedAt: 5000,
          }),
        ]),
      },
    ])("re-reads the list for $name", async ({ list: row }) => {
      const queryClient = new QueryClient();
      const list = watchList(queryClient);
      list.reads[0](listOf(row));
      await flush();

      await fetchStamped(queryClient, {
        snapshot: CODEX_GOOD,
        profileId: null,
        usageUpdatedAt: 1000,
      });
      await flush();

      expect(list.reads).toHaveLength(2);
    });

    it("compares a managed profile's capture with that profile's own row", async () => {
      const held = new QueryClient();
      const heldList = watchList(held);
      heldList.reads[0](
        listOf(
          providerRow("codex", [
            profileRow({
              profileId: "ambient",
              kind: "ambient",
              usageUpdatedAt: 1,
            }),
            profileRow({
              profileId: "p-1",
              kind: "managed",
              usageUpdatedAt: 1000,
            }),
          ]),
        ),
      );
      await flush();
      await fetchStamped(held, {
        snapshot: CODEX_GOOD,
        profileId: "p-1",
        usageUpdatedAt: 1000,
      });
      await flush();
      expect(heldList.reads).toHaveLength(1);

      // The same capture against a list that only has the ambient row at 1000.
      const missing = new QueryClient();
      const missingList = watchList(missing);
      missingList.reads[0](listOf(ambientOf("codex", 1000)));
      await flush();
      await fetchStamped(missing, {
        snapshot: CODEX_GOOD,
        profileId: "p-1",
        usageUpdatedAt: 1000,
      });
      await flush();
      expect(missingList.reads).toHaveLength(2);
    });

    it("waits for a list read in flight instead of cancelling it, and keeps it when it holds the capture", async () => {
      const queryClient = new QueryClient();
      const list = watchList(queryClient);
      expect(list.reads).toHaveLength(1);

      await fetchStamped(queryClient, {
        snapshot: CODEX_GOOD,
        profileId: null,
        usageUpdatedAt: 1000,
      });
      await flush();

      // The read was neither cancelled nor followed by a second one.
      expect(queryClient.getQueryState(CLASSIC_KEY)?.fetchStatus).toBe(
        "fetching",
      );
      expect(list.reads).toHaveLength(1);

      list.reads[0](listOf(ambientOf("codex", 1000)));
      await flush();

      expect(list.reads).toHaveLength(1);
    });

    it("re-reads once when the list read it waited for is behind the capture", async () => {
      const queryClient = new QueryClient();
      const list = watchList(queryClient);

      await fetchStamped(queryClient, {
        snapshot: CODEX_GOOD,
        profileId: null,
        usageUpdatedAt: 1000,
      });
      await flush();
      expect(list.reads).toHaveLength(1);

      list.reads[0](listOf(ambientOf("codex", 500)));
      await flush();

      expect(list.reads).toHaveLength(2);
    });

    it("answers a burst of stamped reads with one comparison", async () => {
      const rows = listOf(
        ambientOf("codex", 1000),
        ambientOf("claude-code", 1000),
        ambientOf("grok", 1000),
      );
      const held = new QueryClient();
      const heldList = watchList(held);
      heldList.reads[0](rows);
      await flush();
      await Promise.all(
        [CODEX_GOOD, GOOD, GROK_GOOD].map((snapshot) =>
          fetchStamped(held, {
            snapshot,
            profileId: null,
            usageUpdatedAt: 1000,
          }),
        ),
      );
      await flush();
      expect(heldList.reads).toHaveLength(1);

      const behind = new QueryClient();
      const behindList = watchList(behind);
      behindList.reads[0](rows);
      await flush();
      await Promise.all(
        [
          { snapshot: CODEX_GOOD, usageUpdatedAt: 1000 },
          { snapshot: GOOD, usageUpdatedAt: 2000 },
          { snapshot: GROK_GOOD, usageUpdatedAt: 1000 },
        ].map((read) => fetchStamped(behind, { ...read, profileId: null })),
      );
      await flush();
      expect(behindList.reads).toHaveLength(2);
    });

    it("does not wait for a list read in flight when one capture in the burst is unstamped", async () => {
      const queryClient = new QueryClient();
      const list = watchList(queryClient);
      expect(list.reads).toHaveLength(1);

      await Promise.all([
        fetchStamped(queryClient, {
          snapshot: CODEX_GOOD,
          profileId: null,
          usageUpdatedAt: 1000,
        }),
        fetchStamped(queryClient, {
          snapshot: GOOD,
          profileId: null,
          usageUpdatedAt: null,
        }),
      ]);
      await flush();

      // An older host says nothing about the list read in flight, so the
      // convergence is the old one: cancel it and read again.
      expect(list.reads).toHaveLength(2);
    });

    it("looks at no query event but the host's own reads and list while a convergence is owed", async () => {
      const queryClient = new QueryClient();
      const cache = queryClient.getQueryCache();
      // One read in flight, so nothing settles the host's convergence, and one
      // stamped read settling beside it, so the host owes a comparison.
      const pending = startPendingRead(queryClient);
      await fetchStamped(queryClient, {
        snapshot: GOOD,
        profileId: null,
        usageUpdatedAt: 1000,
      });
      await flush();
      expect(cache.hasListeners()).toBe(true);
      const isFetching = vi.spyOn(queryClient, "isFetching");

      for (let i = 0; i < 10; i += 1) {
        // Another method on this host, and this method on another host.
        queryClient.setQueryData(
          hostQueryKeys.resolveArtifactByPath("host-a", {
            epicId: `epic-${String(i)}`,
            filePath: "notes.md",
          }),
          {},
        );
        queryClient.setQueryData(
          hostQueryKeys.method<HostRpcRegistry, "host.getRateLimitUsage">(
            "host-b",
            "host.getRateLimitUsage",
            {
              accountContext: DEFAULT_ACCOUNT_CONTEXT,
              providerId: "codex",
              profileId: `profile-${String(i)}`,
            },
          ),
          {},
        );
      }

      expect(isFetching).not.toHaveBeenCalled();

      pending.settle();
      await flush();

      expect(cache.hasListeners()).toBe(false);
    });
  });
});
