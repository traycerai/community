import { describe, expect, it } from "vitest";
import { validateVersionedRpcRegistry } from "@traycer/protocol/framework/index";
import { hostRpcRegistry } from "@traycer/protocol/host/index";
import { RELEASED_FLOOR_METHOD_NAMES } from "@traycer/protocol/host/released-floor";
import {
  environmentHostBindV10,
  environmentHostReadV10,
  environmentListV10,
} from "@traycer/protocol/host/environment/contracts";

const PERSONAL = {
  environmentId: "env_01J0000000000000000000001",
  ownerKind: "user",
  ownerId: "user-1",
  roomId: "b".repeat(64),
  label: "Personal",
};

const TEAM = {
  environmentId: "env_01J0000000000000000000002",
  ownerKind: "organization",
  ownerId: "team-1",
  roomId: "a".repeat(64),
  label: "acme",
};

describe("environment.list protocol contract", () => {
  it("parses an empty request and a list of personal and team environments", () => {
    expect(environmentListV10.requestSchema.parse({})).toEqual({});
    const response = { environments: [PERSONAL, TEAM] };
    expect(environmentListV10.responseSchema.parse(response)).toEqual(response);
  });

  it("rejects an unknown owner kind, a missing room, or a bare array root", () => {
    const { roomId: _roomId, ...noRoom } = TEAM;
    for (const bad of [
      { environments: [{ ...TEAM, ownerKind: "bot" }] },
      { environments: [noRoom] },
      [PERSONAL],
    ]) {
      expect(environmentListV10.responseSchema.safeParse(bad).success).toBe(
        false,
      );
    }
  });

  it("registers off the released floor with unsupported degrade", () => {
    expect(() => validateVersionedRpcRegistry(hostRpcRegistry)).not.toThrow();
    expect(RELEASED_FLOOR_METHOD_NAMES).not.toContain("environment.list");
    const entry = hostRpcRegistry["environment.list"];
    expect(entry.degrade).toEqual({ kind: "unsupported" });
    expect(entry[1].latestMinor).toBe(0);
    expect(entry[1].versions[0].contract).toBe(environmentListV10);
  });
});

describe("environment.host.read / environment.host.bind protocol contracts", () => {
  it("answer the host id, its environment and whether the binding is explicit", () => {
    const unbound = {
      hostId: "host-1",
      environment: PERSONAL,
      explicit: false,
    };
    const bound = { hostId: "host-1", environment: TEAM, explicit: true };
    expect(environmentHostReadV10.requestSchema.parse({})).toEqual({});
    expect(environmentHostReadV10.responseSchema.parse(unbound)).toEqual(
      unbound,
    );
    expect(
      environmentHostBindV10.requestSchema.parse({
        environmentId: TEAM.environmentId,
      }),
    ).toEqual({ environmentId: TEAM.environmentId });
    expect(environmentHostBindV10.responseSchema.parse(bound)).toEqual(bound);
  });

  it("rejects a bind without an environment and a binding without explicit", () => {
    expect(environmentHostBindV10.requestSchema.safeParse({}).success).toBe(
      false,
    );
    expect(
      environmentHostBindV10.requestSchema.safeParse({ environmentId: "" })
        .success,
    ).toBe(false);
    expect(
      environmentHostReadV10.responseSchema.safeParse({
        hostId: "host-1",
        environment: PERSONAL,
      }).success,
    ).toBe(false);
  });

  it("register off the released floor with unsupported degrade", () => {
    for (const [method, contract] of [
      ["environment.host.read", environmentHostReadV10],
      ["environment.host.bind", environmentHostBindV10],
    ] as const) {
      expect(RELEASED_FLOOR_METHOD_NAMES).not.toContain(method);
      const entry = hostRpcRegistry[method];
      expect(entry.degrade).toEqual({ kind: "unsupported" });
      expect(entry[1].latestMinor).toBe(0);
      expect(entry[1].versions[0].contract).toBe(contract);
    }
  });
});
