import type {
  ListTaskLight,
  PermissionDto,
} from "@traycer/protocol/host/epic/unary-schemas";
import type { EpicShareableTeam } from "@/stores/auth/auth-store";

/** A3, verbatim: a team the person cannot name. */
export const UNKNOWN_TEAM_LABEL = "A team";

/**
 * The team that owns a task (ticket E17 checkpoint 6, A3), from the viewer's
 * permission row: `accessType: "organization"` with its `organizationId`.
 * `null` for any other row, or none.
 */
export function taskOwningTeamId(
  _permission: PermissionDto | null | undefined,
): string | null {
  return null;
}

/** The team's slug among the person's teams, else "A team". */
export function teamTaskLabel(
  _teamId: string,
  _teams: ReadonlyArray<EpicShareableTeam>,
): string {
  return "";
}

/** Whether any listed task is owned by `teamId` (A4). */
export function tasksIncludeTeamTask(
  _tasks: ReadonlyArray<ListTaskLight>,
  _teamId: string,
): boolean {
  return false;
}
