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

/** A team pod with an environment to address it by. */
interface TeamPod {
  readonly host: HostScopeOption;
  readonly sandboxId: string;
  readonly environmentId: string;
}

/**
 * The teams' pods. A pod row without an environment (a server from before
 * environments) has nothing to open it by and is left out: opening it with
 * no environment would address the person's own Automations host.
 */
function teamPods(groups: HostPickerGroups): readonly TeamPod[] {
  const pods: TeamPod[] = [];
  for (const team of groups.teams) {
    for (const host of team.sandboxes) {
      const summary = host.sandbox?.summary ?? null;
      if (summary === null || summary.kind !== "automation") continue;
      if (summary.environmentId === null) continue;
      pods.push({
        host,
        sandboxId: summary.id,
        environmentId: summary.environmentId,
      });
    }
  }
  return pods;
}

/**
 * The environments whose pod lists the picker reads: one per team with a
 * pod, however many pods it has (ticket E17, D and E).
 */
export function teamPodEnvironmentIds(
  groups: HostPickerGroups,
): readonly string[] {
  return [...new Set(teamPods(groups).map((pod) => pod.environmentId))];
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
  for (const { host, sandboxId, environmentId } of teamPods(groups)) {
    if (dialable(host.hostId)) continue;
    const pod =
      podsByEnvironment
        .get(environmentId)
        ?.find((p) => p.sandbox.id === sandboxId) ?? null;
    rows.push({
      hostId: host.hostId,
      label: host.name,
      target: {
        environmentId,
        ordinal: pod === null ? null : pod.ordinal,
      },
    });
  }
  return rows;
}
