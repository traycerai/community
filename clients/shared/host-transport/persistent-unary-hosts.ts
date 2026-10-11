/**
 * The hosts known to offer `unary.persistentSession`, keyed by host id.
 *
 * `WsRpcClient` reads this to decide what a COLD burst does - several calls
 * with no negotiated session to share. Against a host in this set, the calls
 * after the first wait for the one handshake in flight and then ride its
 * session. Against any other host each call dials for itself, as it always
 * has, because nothing has shown that host can share a socket.
 *
 * The reason this is worth remembering at all: a Chromium renderer connects
 * ONE WebSocket per address at a time and holds that lock for 10 ms after each
 * handshake (`WebSocketEndpointLockManager`), so N cold dials to the local
 * host finish N * ~12 ms apart however many the client starts at once.
 *
 * POSITIVE EVIDENCE ONLY, with the same asymmetry as
 * `stream-method-support-registry.ts`. An entry is written by a capable
 * `openAck` and removed by any `openAck` that does not yield a persistent
 * session, so a stale entry costs exactly one handshake: the waiting calls see
 * the legacy ack, dial for themselves, and the entry is gone. A missing entry
 * costs nothing new - it is the behaviour before this module existed.
 *
 * Keyed by host id, not by address: the capability belongs to the host build,
 * and a host that restarts on a new port is still the same build.
 *
 * Module-level for the reason `negotiated-manifest-registry.ts` is: the fact
 * describes the host process, not whichever messenger happened to dial it.
 */

/**
 * Where the set survives a page reload, so the first burst of a page - the
 * largest one - is not always a first contact. `null` (nothing installed)
 * keeps the set in memory only, which is right for the CLI and for tests.
 */
export interface PersistentUnaryHostStore {
  /** The host ids an earlier page recorded. */
  read(): readonly string[];
  /** Replaces the recorded host ids. */
  write(hostIds: readonly string[]): void;
}

const knownHostIds = new Set<string>();
let store: PersistentUnaryHostStore | null = null;

/**
 * Installs the reload-surviving store and seeds the set from it. A store that
 * throws or holds nothing means "unknown": every host then starts as a first
 * contact, which is always safe.
 */
export function installPersistentUnaryHostStore(
  next: PersistentUnaryHostStore,
): void {
  store = next;
  try {
    for (const hostId of next.read()) {
      knownHostIds.add(hostId);
    }
  } catch {
    // Unreadable storage is an empty seed.
  }
}

export function hostOffersPersistentUnary(hostId: string): boolean {
  return knownHostIds.has(hostId);
}

/** Records what one `openAck` from `hostId` showed. */
export function recordPersistentUnarySupport(
  hostId: string,
  offered: boolean,
): void {
  if (knownHostIds.has(hostId) === offered) {
    return;
  }
  if (offered) {
    knownHostIds.add(hostId);
  } else {
    knownHostIds.delete(hostId);
  }
  try {
    store?.write([...knownHostIds]);
  } catch {
    // The set in memory stays correct; only the next reload loses the seed.
  }
}

/** Test-only: forget every host and drop the installed store. */
export function resetPersistentUnaryHosts(): void {
  knownHostIds.clear();
  store = null;
}
