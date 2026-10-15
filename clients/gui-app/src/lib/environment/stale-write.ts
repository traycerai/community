import type { EnvironmentStaleWrite } from "@traycer/protocol/framework/environment-stale-write";
import { HostRpcError } from "@traycer-clients/shared/host-transport/host-messenger";

/**
 * A settings save that lost to a newer change. The host refuses it with
 * `ENVIRONMENT_WRITE_STALE` and says who changed the setting first; the page
 * re-reads (`useRereadOnStaleWrite`) and the person is told where the change
 * came from, so they can make theirs again on top of it.
 */
export function staleWriteOf(error: unknown): EnvironmentStaleWrite | null {
  return error instanceof HostRpcError ? error.staleWrite : null;
}

/**
 * The sentence for a stale save. A host's label is text the person typed, so
 * it is only ever rendered as text.
 */
export function staleWriteMessage(staleWrite: EnvironmentStaleWrite): string {
  const { changedBy } = staleWrite;
  if (changedBy.kind === "dashboard") {
    return "This setting was changed in the dashboard just now. Showing the latest.";
  }
  return changedBy.hostLabel === null
    ? "This setting was changed on another host just now. Showing the latest."
    : `This setting was changed on ${changedBy.hostLabel} just now. Showing the latest.`;
}
