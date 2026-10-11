import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hostOffersPersistentUnary,
  installPersistentUnaryHostStore,
  recordPersistentUnarySupport,
  resetPersistentUnaryHosts,
  type PersistentUnaryHostStore,
} from "../persistent-unary-hosts";

/**
 * The module-level memo of hosts known to offer `unary.persistentSession`:
 * what an ack records, what a reload-surviving store seeds, and what a broken
 * store may never break.
 */

function recordingStore(seed: readonly string[]): {
  readonly store: PersistentUnaryHostStore;
  readonly written: string[][];
} {
  const written: string[][] = [];
  return {
    written,
    store: {
      read: () => seed,
      write: (hostIds) => {
        written.push([...hostIds]);
      },
    },
  };
}

describe("persistent unary host memo", () => {
  afterEach(() => {
    resetPersistentUnaryHosts();
  });

  it("knows a host only after a capable ack and forgets it on a legacy one, without touching other hosts", () => {
    expect(hostOffersPersistentUnary("h1")).toBe(false);

    recordPersistentUnarySupport("h1", true);
    expect(hostOffersPersistentUnary("h1")).toBe(true);
    expect(hostOffersPersistentUnary("h2")).toBe(false);

    recordPersistentUnarySupport("h2", true);
    recordPersistentUnarySupport("h1", false);
    expect(hostOffersPersistentUnary("h1")).toBe(false);
    expect(hostOffersPersistentUnary("h2")).toBe(true);
  });

  it("seeds every host the installed store reads", () => {
    installPersistentUnaryHostStore(recordingStore(["h1", "h2"]).store);

    expect(hostOffersPersistentUnary("h1")).toBe(true);
    expect(hostOffersPersistentUnary("h2")).toBe(true);
    expect(hostOffersPersistentUnary("h3")).toBe(false);
  });

  it("writes the whole set on every change and nothing on a record that changes nothing", () => {
    const { store, written } = recordingStore(["h1"]);
    installPersistentUnaryHostStore(store);
    expect(written).toEqual([]);

    recordPersistentUnarySupport("h2", true);
    expect(written).toEqual([["h1", "h2"]]);

    recordPersistentUnarySupport("h1", false);
    expect(written).toEqual([["h1", "h2"], ["h2"]]);

    // Already known, already unknown: no change, so no write.
    recordPersistentUnarySupport("h2", true);
    recordPersistentUnarySupport("h1", false);
    recordPersistentUnarySupport("never-seen", false);
    expect(written).toEqual([["h1", "h2"], ["h2"]]);
  });

  it("treats a store that cannot be read as an empty seed", () => {
    expect(() =>
      installPersistentUnaryHostStore({
        read: () => {
          throw new Error("storage denied");
        },
        write: () => undefined,
      }),
    ).not.toThrow();

    expect(hostOffersPersistentUnary("h1")).toBe(false);
  });

  it("keeps the answer in memory when the store cannot be written", () => {
    const write = vi.fn((_hostIds: readonly string[]): void => {
      throw new Error("quota exceeded");
    });
    installPersistentUnaryHostStore({ read: () => [], write });

    expect(() => recordPersistentUnarySupport("h1", true)).not.toThrow();
    expect(write).toHaveBeenCalledTimes(1);
    expect(hostOffersPersistentUnary("h1")).toBe(true);

    expect(() => recordPersistentUnarySupport("h1", false)).not.toThrow();
    expect(hostOffersPersistentUnary("h1")).toBe(false);
  });

  it("forgets every host and drops the store on reset", () => {
    const { store, written } = recordingStore(["h1"]);
    installPersistentUnaryHostStore(store);
    recordPersistentUnarySupport("h2", true);
    expect(written).toHaveLength(1);

    resetPersistentUnaryHosts();
    expect(hostOffersPersistentUnary("h1")).toBe(false);
    expect(hostOffersPersistentUnary("h2")).toBe(false);

    recordPersistentUnarySupport("h3", true);
    expect(hostOffersPersistentUnary("h3")).toBe(true);
    expect(written).toHaveLength(1);
  });
});
