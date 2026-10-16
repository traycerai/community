import type { ReactNode } from "react";

/**
 * A1: the Belongs to chip on a new-task landing draft, listing Personal and
 * each of the person's teams by slug. Hidden for someone in no team.
 */
export function LandingOwnerChip(_props: {
  readonly draftId: string | null;
  readonly resolvedHostId: string | null;
}): ReactNode {
  return null;
}

/** A3: the first-chat line under a team pick. */
export function LandingTeamChatLine(_props: {
  readonly draftId: string | null;
  readonly resolvedHostId: string | null;
}): ReactNode {
  return null;
}
