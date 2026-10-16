import { useCallback, useMemo } from "react";
import type { TaskHostPrincipal } from "@traycer/protocol/host/task-host-summary";
import type { ComposerHostNoticeState } from "@/components/home/composer/composer-host-notice";
import {
  composerMirrorLineText,
  mirrorLineOtherHostLabel,
} from "@/components/home/composer/composer-mirror-line-model";
import { useRegisteredHosts } from "@/hooks/auth/use-registered-hosts-query";
import { useCloudChatViewerId } from "@/hooks/chats/use-cloud-chat-queries";
import { useTaskHostsView } from "@/hooks/epic/use-task-hosts-view";
import {
  composerMirrorLineSeen,
  useComposerMirrorLineSeenStore,
} from "@/stores/epics/composer-mirror-line-seen-store";

export interface ComposerMirrorLine {
  /** The line, or `null` when no host here has another owner, or it was seen. */
  readonly notice: ComposerHostNoticeState | null;
  /** Record the line as seen in this task: on dismiss, and on start. */
  readonly markSeen: () => void;
}

/**
 * The mirror line (ticket E17 checkpoint 5; core flows, flow 5): starting an
 * agent on a host whose owner differs from a host already working in the task
 * says, once per task, that the two cannot work with each other. Owners come
 * from the task's host rows; a start host that is not one of them yet is its
 * registry owner's when that is a team, and otherwise the person's own.
 */
export function useComposerMirrorLine(
  epicId: string,
  resolvedHostId: string | null,
): ComposerMirrorLine {
  const view = useTaskHostsView(epicId);
  const viewerUserId = useCloudChatViewerId();
  const registry = useRegisteredHosts().data ?? null;
  const seen = useComposerMirrorLineSeenStore((s) => s.seen);
  const markSeenFor = useComposerMirrorLineSeenStore((s) => s.markSeen);
  const hosts = view.kind === "hosts" ? view.hosts : null;
  const label = useMemo(() => {
    if (hosts === null || resolvedHostId === null) return null;
    if (viewerUserId.length === 0) return null;
    const owner =
      registry?.hosts.find((item) => item.hostId === resolvedHostId)?.owner ??
      null;
    const fallback: TaskHostPrincipal =
      owner !== null && owner.kind === "team"
        ? { kind: "team", id: owner.id }
        : { kind: "user", id: viewerUserId };
    return mirrorLineOtherHostLabel({
      hosts,
      startHostId: resolvedHostId,
      startPrincipalFallback: fallback,
      viewerUserId,
    });
  }, [hosts, registry, resolvedHostId, viewerUserId]);
  const alreadySeen = composerMirrorLineSeen(seen, viewerUserId, epicId);
  const notice = useMemo<ComposerHostNoticeState | null>(
    () =>
      label === null || alreadySeen
        ? null
        : { kind: "mirror", message: composerMirrorLineText(label) },
    [alreadySeen, label],
  );
  const markSeen = useCallback((): void => {
    if (viewerUserId.length === 0) return;
    markSeenFor(viewerUserId, epicId);
  }, [epicId, markSeenFor, viewerUserId]);
  return { notice, markSeen };
}

/**
 * The composer's one notice slot: a refusal outranks the mirror line, and
 * dismissing the mirror line marks it seen.
 */
export function composerTopNotice(
  refused: ComposerHostNoticeState | null,
  dismissRefused: () => void,
  mirror: ComposerMirrorLine,
): {
  readonly notice: ComposerHostNoticeState | null;
  readonly dismiss: () => void;
} {
  if (refused !== null) return { notice: refused, dismiss: dismissRefused };
  return { notice: mirror.notice, dismiss: mirror.markSeen };
}
