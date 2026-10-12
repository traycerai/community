import {
  hostOffersPersistentUnary,
  installPersistentUnaryHostStore,
  recordPersistentUnarySupport,
  resetPersistentUnaryHosts,
} from "@traycer-clients/shared/host-transport/persistent-unary-hosts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionPersistentUnaryHostStore } from "../persistent-unary-host-store";

// The literal is the contract: a renamed key silently drops every reload's
// seed, so the string is pinned here and nowhere else in this file.
const STORAGE_KEY = "traycer-gui-app:persistent-unary-hosts";

describe("sessionPersistentUnaryHostStore", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    resetPersistentUnaryHosts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    resetPersistentUnaryHosts();
  });

  it("round-trips the ids through the persist key", () => {
    sessionPersistentUnaryHostStore.write(["h1", "h2"]);

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe('["h1","h2"]');
    expect(sessionPersistentUnaryHostStore.read()).toEqual(["h1", "h2"]);
  });

  it("reads an empty list when nothing was stored", () => {
    expect(sessionPersistentUnaryHostStore.read()).toEqual([]);
  });

  it("reads an empty list for JSON that is not an array", () => {
    window.sessionStorage.setItem(STORAGE_KEY, '{"h1":true}');

    expect(sessionPersistentUnaryHostStore.read()).toEqual([]);
  });

  it("keeps only the strings of a mixed array", () => {
    window.sessionStorage.setItem(STORAGE_KEY, '["h1",7,null,"h2",{"a":1}]');

    expect(sessionPersistentUnaryHostStore.read()).toEqual(["h1", "h2"]);
  });

  describe("through the real installer", () => {
    it("makes a stored host known at install", () => {
      window.sessionStorage.setItem(STORAGE_KEY, '["h1"]');

      installPersistentUnaryHostStore(sessionPersistentUnaryHostStore);

      expect(hostOffersPersistentUnary("h1")).toBe(true);
      expect(hostOffersPersistentUnary("h2")).toBe(false);
    });

    it("persists a recorded host for the next load", () => {
      installPersistentUnaryHostStore(sessionPersistentUnaryHostStore);

      recordPersistentUnarySupport("h1", true);

      expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe('["h1"]');
    });

    it("leaves every host unknown, without throwing, when the stored value is not JSON", () => {
      window.sessionStorage.setItem(STORAGE_KEY, "{not json");

      expect(() =>
        installPersistentUnaryHostStore(sessionPersistentUnaryHostStore),
      ).not.toThrow();
      expect(hostOffersPersistentUnary("h1")).toBe(false);
    });

    it("keeps the in-memory answer when storage refuses the write", () => {
      installPersistentUnaryHostStore(sessionPersistentUnaryHostStore);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });

      expect(() => recordPersistentUnarySupport("h1", true)).not.toThrow();
      expect(hostOffersPersistentUnary("h1")).toBe(true);
    });
  });
});
