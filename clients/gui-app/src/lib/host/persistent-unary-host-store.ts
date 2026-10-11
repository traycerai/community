import type { PersistentUnaryHostStore } from "@traycer-clients/shared/host-transport/persistent-unary-hosts";
import { persistentUnaryHostsKey } from "@/lib/persist/keys";

/**
 * Keeps the unary cold-burst memo (`persistent-unary-hosts.ts`) across a page
 * reload, so the boot burst rides one handshake instead of a dial per call.
 *
 * `sessionStorage`, not `localStorage`: the entry only has to outlive a
 * reload of this window. It is positive evidence only, and a wrong entry
 * costs one handshake before the legacy ack clears it.
 *
 * Neither method guards its own storage access. The installer and the
 * recorder both treat a throw - no `window`, storage denied, a value that is
 * not JSON - as "unknown", which is the one place that rule should live.
 */
export const sessionPersistentUnaryHostStore: PersistentUnaryHostStore = {
  read(): readonly string[] {
    const parsed: unknown = JSON.parse(
      window.sessionStorage.getItem(persistentUnaryHostsKey()) ?? "[]",
    );
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  },
  write(hostIds: readonly string[]): void {
    window.sessionStorage.setItem(
      persistentUnaryHostsKey(),
      JSON.stringify(hostIds),
    );
  },
};
