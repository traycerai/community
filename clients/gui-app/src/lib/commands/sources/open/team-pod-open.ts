import type {
  SandboxAutomationOpenTarget,
  SandboxPod,
} from "@traycer/protocol/host/sandbox-control";
import type { HostPickerGroups } from "@/components/settings/host-scope/host-option-model";
import type { HostScopeOption } from "@/components/settings/host-scope/host-scope-model";

/** A team pod the new terminal picker opens before it can dial it. */
export interface TeamPodOpenRow {
  readonly hostId: string;
  readonly label: string;
  readonly target: SandboxAutomationOpenTarget;
}

function teamPods(groups: HostPickerGroups): readonly HostScopeOption[] {
  return groups.teams.flatMap((team) =>
    team.sandboxes.filter((host) => host.sandbox?.summary?.kind === "automation"),
  );
}

/**
 * The environments whose pod lists the picker reads: one per team with a
 * pod, however many pods it has (ticket E17, D and E).
 */
export function teamPodEnvironmentIds(
  groups: HostPickerGroups,
): readonly string[] {
  const ids = new Set<string>();
  for (const host of teamPods(groups)) {
    const summary = host.sandbox?.summary ?? null;
    if (summary !== null) ids.add(summary.environmentId);
  }
  return [...ids];
}

/**
 * The team pods the picker offers as an open (`POST /automation` with the
 * pod's environment and ordinal) because it cannot dial them yet. The
 * ordinal comes from the environment's pod list; a pod the list has not
 * answered for opens with `null`, and the server picks the pod.
 */
export function teamPodOpenRows(
  groups: HostPickerGroups,
  podsByEnvironment: ReadonlyMap<string, readonly SandboxPod[]>,
  dialable: (hostId: string) => boolean,
): readonly TeamPodOpenRow[] {
  const rows: TeamPodOpenRow[] = [];
  for (const host of teamPods(groups)) {
    const summary = host.sandbox?.summary ?? null;
    if (summary === null || dialable(host.hostId)) continue;
    const pod =
      podsByEnvironment
        .get(summary.environmentId)
        ?.find((p) => p.sandbox.id === summary.id) ?? null;
    rows.push({
      hostId: host.hostId,
      label: host.name,
      target: {
        environmentId: summary.environmentId,
        ordinal: pod === null ? null : pod.ordinal,
      },
    });
  }
  return rows;
}
