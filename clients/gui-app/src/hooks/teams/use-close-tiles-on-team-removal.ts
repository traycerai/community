import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { HostListResponse } from "@traycer/protocol/host/host-status";
import { useRegisteredHosts } from "@/hooks/auth/use-registered-hosts-query";
import { useAuthStore, type EpicShareableTeam } from "@/stores/auth/auth-store";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import { removedTeamIds } from "./team-removal-model";

interface RememberedTeam {
  readonly name: string;
  readonly hostIds: ReadonlySet<string>;
}

/**
 * A removed team member's tiles on the team's hosts close (ticket E17
 * checkpoint 6), with "You are no longer a member of <team>." The trigger is
 * the person's own team list (the auth projection) losing a team while the
 * same person stays signed in: the admins' `team.member.removed` never
 * reaches the member removed. The team's hosts and name are remembered while
 * the person is in it, because by the time the list changes the registry may
 * already have stopped listing them.
 */
export function useCloseTilesOnTeamRemoval(): void {
  const teams = useAuthStore((s) => s.shareableTeams);
  const status = useAuthStore((s) => s.status);
  const viewerUserId = useAuthStore((s) => s.contextMetadata?.userId ?? null);
  const registry = useRegisteredHosts().data ?? null;
  const remembered = useRef(new Map<string, RememberedTeam>());
  const previous = useRef<{
    readonly viewerUserId: string | null;
    readonly signedIn: boolean;
    readonly teamIds: readonly string[];
  } | null>(null);

  useEffect(() => {
    const signedIn = status === "signed-in";
    const teamIds = teams.map((team) => team.teamId);
    const before = previous.current;
    if (
      before !== null &&
      before.signedIn &&
      signedIn &&
      before.viewerUserId === viewerUserId
    ) {
      closeRemovedTeams(before.teamIds, teamIds, remembered.current);
    }
    if (before !== null && before.viewerUserId !== viewerUserId) {
      remembered.current = new Map();
    }
    rememberTeams(teams, registry, remembered.current);
    previous.current = { viewerUserId, signedIn, teamIds };
  }, [registry, status, teams, viewerUserId]);
}

/** Closes each removed team's tiles and says so, once per removal. */
function closeRemovedTeams(
  previousTeamIds: readonly string[],
  teamIds: readonly string[],
  remembered: Map<string, RememberedTeam>,
): void {
  for (const teamId of removedTeamIds(previousTeamIds, teamIds)) {
    const team = remembered.get(teamId);
    if (team === undefined) continue;
    useEpicCanvasStore.getState().closeTilesOnHosts(team.hostIds);
    toast.info(`You are no longer a member of ${team.name}.`);
    remembered.delete(teamId);
  }
}

/** Remembers each current team's name and hosts, keeping what was seen before. */
function rememberTeams(
  teams: ReadonlyArray<EpicShareableTeam>,
  registry: HostListResponse | null,
  remembered: Map<string, RememberedTeam>,
): void {
  for (const team of teams) {
    const known = remembered.get(team.teamId);
    const hostIds = new Set(known?.hostIds ?? []);
    let name: string | null = null;
    for (const host of registry?.hosts ?? []) {
      if (host.owner?.kind !== "team" || host.owner.id !== team.teamId) {
        continue;
      }
      hostIds.add(host.hostId);
      name = host.owner.name;
    }
    remembered.set(team.teamId, {
      name: name ?? known?.name ?? team.slug,
      hostIds,
    });
  }
}
