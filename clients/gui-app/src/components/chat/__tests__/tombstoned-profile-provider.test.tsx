import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { memo, use, useState, type ReactNode } from "react";
import type { ChatSessionAnchor } from "@traycer/protocol/persistence/epic/schemas";
import type { ProviderCliState } from "@traycer/protocol/host/provider-schemas";
import {
  TombstonedProfileContext,
  type TombstonedProfileVerdict,
} from "../use-tombstoned-profile-label";
import { TombstonedProfileProvider } from "../tombstoned-profile-provider";

const HOST_A = "host-a";
const HOST_B = "host-b";

const ANCHOR: ChatSessionAnchor = {
  harnessId: "claude",
  hostId: HOST_A,
  sessionId: "session-1",
  sessionWorkspaceSnapshot: {
    workspaceKind: "session-snapshot",
    primaryWorkspace: "/repo",
    secondaryWorkspaces: [],
  },
  claudeMessageUuid: "uuid-1",
  turnTailUuid: null,
  createdAt: 100,
  coveredUntilMessageId: null,
  profileId: "work-uuid",
  labelSnapshot: "Work",
  accountUuid: null,
  accentColor: null,
};

function claudeState(profileIds: readonly string[]): ProviderCliState {
  return {
    providerId: "claude-code",
    enabled: true,
    disabledBy: null,
    selected: { kind: "bundled" },
    candidates: [],
    auth: {
      status: "authenticated",
      badgeText: null,
      label: null,
      detail: null,
    },
    authPending: false,
    checkedAt: null,
    apiKey: { supported: false, configured: false, source: null },
    terminalAgentArgs: "",
    envOverrides: [],
    loginCapability: null,
    availabilityPending: false,
    nativeCapabilities: {
      supportedTabs: ["general", "env", "usage"],
      mcp: null,
      plugins: null,
      skills: null,
      modelProviders: null,
    },
    managedInstallState: null,
    versionVisibility: null,
    advisory: null,
    profiles: profileIds.map((profileId) => ({
      profileId,
      enabled: true,
      kind:
        profileId === "ambient" ? ("ambient" as const) : ("managed" as const),
      authType: "oauth" as const,
      label: profileId,
      auth: {
        status: "authenticated" as const,
        badgeText: null,
        label: null,
        detail: null,
      },
      identity: null,
      usageUpdatedAt: null,
      rateLimitStatus: "unknown" as const,
      rateLimitLimitedScopes: null,
      duplicateOfProfileId: null,
      accentColor: null,
      ambientDriftNotice: null,
    })),
  };
}

// Stable references: the whole point of the suite is that the provider's
// inputs keep their identity across a parent re-render.
const PROVIDERS_WORK_ACTIVE: ReadonlyArray<ProviderCliState> = [
  claudeState(["ambient", "work-uuid"]),
];
const PROVIDERS_WORK_REMOVED: ReadonlyArray<ProviderCliState> = [
  claudeState(["ambient"]),
];

interface ConsumerProbe {
  renders: number;
  verdict: TombstonedProfileVerdict | null;
}

// `memo` with no props: the consumer can only render again when the context
// value changes, which is exactly what a user message in a transcript sees.
const Consumer = memo(function Consumer({
  probe,
}: {
  readonly probe: ConsumerProbe;
}) {
  const resolve = use(TombstonedProfileContext);
  probe.renders += 1;
  probe.verdict = resolve(ANCHOR);
  return null;
});

function Parent({
  providers,
  hostId,
  probe,
}: {
  readonly providers: ReadonlyArray<ProviderCliState>;
  readonly hostId: string;
  readonly probe: ConsumerProbe;
}): ReactNode {
  // Unrelated state: re-renders this component (and so the provider) without
  // touching `providers` or `hostId`.
  const [, setTick] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setTick((tick) => tick + 1)}>
        bump
      </button>
      <TombstonedProfileProvider providers={providers} hostId={hostId}>
        <Consumer probe={probe} />
      </TombstonedProfileProvider>
    </>
  );
}

function newProbe(): ConsumerProbe {
  return { renders: 0, verdict: null };
}

describe("TombstonedProfileProvider resolver identity", () => {
  afterEach(cleanup);

  it("does not re-render consumers when the provider re-renders with the same providers and hostId", () => {
    const probe = newProbe();
    render(
      <Parent
        providers={PROVIDERS_WORK_ACTIVE}
        hostId={HOST_A}
        probe={probe}
      />,
    );
    expect(probe.renders).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "bump" }));
    fireEvent.click(screen.getByRole("button", { name: "bump" }));

    expect(probe.renders).toBe(1);
  });

  it("re-renders consumers with the new verdict when providers change", () => {
    const probe = newProbe();
    const { rerender } = render(
      <Parent
        providers={PROVIDERS_WORK_ACTIVE}
        hostId={HOST_A}
        probe={probe}
      />,
    );
    expect(probe.renders).toBe(1);
    // Profile still active on the anchor's own host: nothing to say.
    expect(probe.verdict).toBeNull();

    rerender(
      <Parent
        providers={PROVIDERS_WORK_REMOVED}
        hostId={HOST_A}
        probe={probe}
      />,
    );

    expect(probe.renders).toBe(2);
    expect(probe.verdict).toEqual({ label: "Work", removedOnThisHost: true });
  });

  it("re-renders consumers with the new verdict when hostId changes", () => {
    const probe = newProbe();
    const { rerender } = render(
      <Parent
        providers={PROVIDERS_WORK_REMOVED}
        hostId={HOST_A}
        probe={probe}
      />,
    );
    expect(probe.renders).toBe(1);
    expect(probe.verdict).toEqual({ label: "Work", removedOnThisHost: true });

    // Same list judged from another host: the anchor now reads as foreign, so
    // the removal claim is withdrawn.
    rerender(
      <Parent
        providers={PROVIDERS_WORK_REMOVED}
        hostId={HOST_B}
        probe={probe}
      />,
    );

    expect(probe.renders).toBe(2);
    expect(probe.verdict).toEqual({ label: "Work", removedOnThisHost: false });
  });
});
