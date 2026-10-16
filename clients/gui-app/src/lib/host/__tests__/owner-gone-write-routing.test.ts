import { describe, expect, it } from "vitest";
import type { HostLeaseSnapshot } from "@traycer-clients/shared/host-selection/selection-authority-contract";
import {
  pickLiveHostId,
  routeOwnerGoneWrite,
} from "@/lib/host/owner-gone-write-routing";
import type { SurfacePinFleetView } from "@/stores/host/surface-host-selection-store";

function ready(hostId: string): HostLeaseSnapshot {
  return { hostId, status: "ready", dead: null };
}
function degraded(hostId: string): HostLeaseSnapshot {
  return { hostId, status: "degraded", dead: null };
}
function connecting(hostId: string): HostLeaseSnapshot {
  return { hostId, status: "connecting", dead: null };
}
function restarting(hostId: string): HostLeaseSnapshot {
  return { hostId, status: "restarting-expected", dead: null };
}
function dead(hostId: string): HostLeaseSnapshot {
  return { hostId, status: "dead", dead: { reason: "offline" } };
}

function fleet(...leases: HostLeaseSnapshot[]): SurfacePinFleetView {
  return { authorityAttached: true, leases };
}

const preferNothing = (): readonly (string | null)[] => [];

describe("routeOwnerGoneWrite", () => {
  it("keeps the owner while its lease can serve", () => {
    expect(
      routeOwnerGoneWrite({
        ownerHostId: "owner",
        fleet: fleet(ready("owner"), ready("session")),
        preferredHostIds: () => ["session"],
      }),
    ).toEqual({ hostId: "owner", fellBack: false });
  });

  it("keeps the owner while its lease is only connecting or restarting - no evidence is not death", () => {
    for (const ownerLease of [connecting("owner"), restarting("owner")]) {
      expect(
        routeOwnerGoneWrite({
          ownerHostId: "owner",
          fleet: fleet(ownerLease, ready("session")),
          preferredHostIds: () => ["session"],
        }),
      ).toEqual({ hostId: "owner", fellBack: false });
    }
  });

  it("does not read the preferred hosts unless the owner is down", () => {
    let read = false;
    routeOwnerGoneWrite({
      ownerHostId: "owner",
      fleet: fleet(ready("owner")),
      preferredHostIds: () => {
        read = true;
        return [];
      },
    });
    expect(read).toBe(false);
  });

  it("sends to the session host first when the owner's lease is dead", () => {
    expect(
      routeOwnerGoneWrite({
        ownerHostId: "owner",
        fleet: fleet(dead("owner"), ready("other"), ready("session")),
        preferredHostIds: () => ["session", "local"],
      }),
    ).toEqual({ hostId: "session", fellBack: true });
  });

  it("falls to this machine's host when the session host is down too", () => {
    expect(
      routeOwnerGoneWrite({
        ownerHostId: "owner",
        fleet: fleet(
          dead("owner"),
          dead("session"),
          ready("other"),
          degraded("local"),
        ),
        preferredHostIds: () => ["session", "local"],
      }),
    ).toEqual({ hostId: "local", fellBack: true });
  });

  it("falls to any other live host of the fleet, in the authority's order", () => {
    expect(
      routeOwnerGoneWrite({
        ownerHostId: "owner",
        fleet: fleet(
          dead("owner"),
          connecting("first"),
          restarting("second"),
          ready("third"),
          ready("fourth"),
        ),
        preferredHostIds: () => [null, null],
      }),
    ).toEqual({ hostId: "third", fellBack: true });
  });

  it("treats an owner missing from a known fleet as gone", () => {
    expect(
      routeOwnerGoneWrite({
        ownerHostId: "deregistered",
        fleet: fleet(ready("session")),
        preferredHostIds: () => ["session"],
      }),
    ).toEqual({ hostId: "session", fellBack: true });
  });

  it("keeps the owner when no other host is live - today's behaviour", () => {
    expect(
      routeOwnerGoneWrite({
        ownerHostId: "owner",
        fleet: fleet(dead("owner"), connecting("session"), dead("other")),
        preferredHostIds: () => ["session"],
      }),
    ).toEqual({ hostId: "owner", fellBack: false });
  });

  it("keeps the owner before the authority attaches, and while it has published no fleet", () => {
    expect(
      routeOwnerGoneWrite({
        ownerHostId: "owner",
        fleet: { authorityAttached: false, leases: [ready("session")] },
        preferredHostIds: () => ["session"],
      }),
    ).toEqual({ hostId: "owner", fellBack: false });
    expect(
      routeOwnerGoneWrite({
        ownerHostId: "owner",
        fleet: { authorityAttached: true, leases: [] },
        preferredHostIds: preferNothing,
      }),
    ).toEqual({ hostId: "owner", fellBack: false });
  });
});

describe("pickLiveHostId", () => {
  it("never answers the excluded host, even when it is preferred and ready", () => {
    expect(
      pickLiveHostId(["owner"], fleet(ready("owner"), ready("b")), "owner"),
    ).toBe("b");
  });

  it("answers null with no live host", () => {
    expect(
      pickLiveHostId(["a"], fleet(connecting("a"), dead("b")), "owner"),
    ).toBeNull();
  });
});
