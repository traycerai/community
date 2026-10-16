import type { EpicShareableTeam } from "@/stores/auth/auth-store";

/** B1, verbatim: a chat on a host no team owns, in a team's task. */
export const TEAM_EPIC_PERSONAL_LINE = "Running on your Personal settings.";

/**
 * The team a chat could continue on (ticket E17 checkpoint 6, B1): the team
 * that owns the task, when the person is in it and the chat's host is not a
 * team's. `null` hides the line.
 */
export function teamEpicPersonalNotice(input: {
  readonly epicTeamId: string | null;
  readonly tabHostTeamId: string | null;
  readonly teams: ReadonlyArray<EpicShareableTeam>;
}): { readonly teamId: string; readonly slug: string } | null {
  if (input.epicTeamId === null || input.tabHostTeamId !== null) return null;
  const team = input.teams.find(
    (candidate) => candidate.teamId === input.epicTeamId,
  );
  return team === undefined ? null : { teamId: team.teamId, slug: team.slug };
}

/** B1, verbatim: the action under the line. */
export function teamEpicContinueLabel(slug: string): string {
  return `Continue on a ${slug} host`;
}

/** B1, verbatim: what first use per person per team asks. */
export function teamEpicContinueCaution(slug: string): string {
  return `Everything in this chat, including what people outside ${slug} wrote, becomes the working context of an agent that holds ${slug}'s secrets.`;
}
