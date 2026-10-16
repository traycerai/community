import type {
  TaskHostPrincipal,
  TaskHostRow,
} from "@traycer/protocol/host/task-host-summary";
import { TASK_HOST_UNNAMED_LABEL } from "@/components/epic-canvas/sidebar/task-host-groups-model";

/** The mirror line (core flows, flow 5), verbatim. */
export function composerMirrorLineText(otherHostLabel: string): string {
  return `Agents here cannot work with the agents on ${otherHostLabel}; the task still shares its files and chats.`;
}

function samePrincipal(a: TaskHostPrincipal, b: TaskHostPrincipal): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** The Hosts section's group order: the viewer's own, teams, then others. */
function principalRank(
  principal: TaskHostPrincipal,
  viewerUserId: string,
): number {
  if (principal.kind === "team") return 1;
  return principal.id === viewerUserId ? 0 : 2;
}

/**
 * The host the mirror line names: the first host already in the task whose
 * owner differs from the start host's, in the Hosts section's order, or `null`
 * when every host there shares the start host's owner. The start host's owner
 * is its own task row's when it already serves the task, else the caller's
 * fallback (its registry owner, or the viewer).
 */
export function mirrorLineOtherHostLabel(input: {
  readonly hosts: readonly TaskHostRow[];
  readonly startHostId: string;
  readonly startPrincipalFallback: TaskHostPrincipal;
  readonly viewerUserId: string;
}): string | null {
  const startRow = input.hosts.find((row) => row.hostId === input.startHostId);
  const startPrincipal = startRow?.principal ?? input.startPrincipalFallback;
  const differing = input.hosts
    .filter(
      (row) =>
        row.hostId !== input.startHostId &&
        !samePrincipal(row.principal, startPrincipal),
    )
    // A stable sort: wire order within a rank.
    .toSorted(
      (a, b) =>
        principalRank(a.principal, input.viewerUserId) -
        principalRank(b.principal, input.viewerUserId),
    );
  const first = differing.at(0);
  if (first === undefined) return null;
  return first.label ?? TASK_HOST_UNNAMED_LABEL;
}
