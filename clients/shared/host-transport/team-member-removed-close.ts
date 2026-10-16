/**
 * Where a team host's `TEAM_MEMBER_REMOVED` fatal reaches the app (ticket E17
 * checkpoint 7, "removal close"). A removed member's every session on that
 * host ends with it, so a stream client reports the host it dialed here, once
 * per fatal frame, and the app's removal close turns the first report for a
 * team into its one toast and one close of the team's tiles. Main-thread
 * module state: the stream sessions behind the epic worker's proxy are real
 * sessions on this thread too.
 */
type TeamMemberRemovedCloseListener = (hostId: string) => void;

const listeners = new Set<TeamMemberRemovedCloseListener>();

/** A session on `hostId` was closed because this person left its team. */
export function reportTeamMemberRemovedClose(hostId: string): void {
  for (const listener of listeners) listener(hostId);
}

export function subscribeTeamMemberRemovedClose(
  listener: TeamMemberRemovedCloseListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
