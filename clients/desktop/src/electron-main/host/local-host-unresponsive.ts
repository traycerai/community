import type { LocalHostUnresponsive } from "../../ipc-contracts/host-types";

/**
 * The health monitor's latest verdict on whether the local host has stopped
 * responding, held for the IPC bridge to push and to answer pulls with.
 *
 * Process-wide, like `appliedLocalHostCapability`: the monitor that writes it
 * starts after bootstrap, while the bridge that reads it is installed before,
 * and neither owns the other.
 */
let current: LocalHostUnresponsive | null = null;
const listeners = new Set<(state: LocalHostUnresponsive | null) => void>();

export function publishLocalHostUnresponsive(
  state: LocalHostUnresponsive | null,
): void {
  if (current === null && state === null) return;
  current = state;
  for (const listener of listeners) listener(state);
}

export function readLocalHostUnresponsive(): LocalHostUnresponsive | null {
  return current;
}

export function onLocalHostUnresponsiveChange(
  listener: (state: LocalHostUnresponsive | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
