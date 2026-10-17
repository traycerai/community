import { describe, expect, it } from "vitest";
import { validateVersionedRpcRegistry } from "@traycer/protocol/framework/index";
import { hostRpcRegistry } from "@traycer/protocol/host/index";
import { RELEASED_FLOOR_METHOD_NAMES } from "@traycer/protocol/host/released-floor";
import { environmentListV10 } from "@traycer/protocol/host/environment/contracts";

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
