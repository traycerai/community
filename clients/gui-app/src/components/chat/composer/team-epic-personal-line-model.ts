import type { EpicShareableTeam } from "@/stores/auth/auth-store";

/** B1, verbatim: a chat on a host no team owns, in a team's task. */
export const TEAM_EPIC_PERSONAL_LINE = "Running on your Personal settings.";

/**
 * The team a chat could continue on (ticket E17 checkpoint 6, B1): the team
 * that owns the task, when the person is in it and the chat's host is not a
 * team's. `null` hides the line.
 */
export function teamEpicPersonalNotice(_input: {
  readonly epicTeamId: string | null;
  readonly tabHostTeamId: string | null;
  readonly teams: ReadonlyArray<EpicShareableTeam>;
}): { readonly teamId: string; readonly slug: string } | null {
  return null;
}

/** B1, verbatim: the action under the line. */
export function teamEpicContinueLabel(_slug: string): string {
  return "";
}

/** B1, verbatim: what first use per person per team asks. */
export function teamEpicContinueCaution(_slug: string): string {
  return "";
}
