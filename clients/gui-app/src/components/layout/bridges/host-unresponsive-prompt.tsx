import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { LocalHostUnresponsive } from "@traycer-clients/shared/platform/runner-host";
import { ActionToastContent } from "@/components/layout/bridges/action-toast-content";
import { useRunnerRequestHostRespawn } from "@/hooks/runner/use-runner-request-host-respawn-mutation";
import { useRunnerHost } from "@/providers/use-runner-host";

const HOST_UNRESPONSIVE_TOAST_ID = "host-unresponsive";
const HOST_UNRESPONSIVE_TITLE = "Host is not responding. Force restart?";

function hostUnresponsiveDescription(state: LocalHostUnresponsive): string {
  const minutes = Math.floor(state.unreachableForMs / 60_000);
  return `It has not answered for ${minutes} min. A force restart ends any work in progress on it.`;
}

/**
 * Offers the person a force restart once the shell reports this machine's
 * host alive but not answering past its busy window, and withdraws the offer
 * when the host answers again or goes away.
 *
 * The shell kills nothing on that verdict - a host that is merely busy must
 * not be restarted from under its work - so this offer is the only way the
 * verdict turns into a restart, and it goes through the same forced respawn as
 * every other "Restart Host" surface.
 */
export function HostUnresponsivePrompt() {
  const runnerHost = useRunnerHost();
  // `mutate` is stable across renders, so the subscription below is not torn
  // down (dismissing an open offer) each time the mutation's state changes.
  const { mutate: respawnHost } = useRunnerRequestHostRespawn();
  const forceRestart = useCallback(() => {
    respawnHost();
  }, [respawnHost]);

  useEffect(() => {
    const subscription = runnerHost.onLocalHostUnresponsive((state) => {
      if (state === null) {
        toast.dismiss(HOST_UNRESPONSIVE_TOAST_ID);
        return;
      }
      toast(
        <ActionToastContent
          toastId={HOST_UNRESPONSIVE_TOAST_ID}
          eyebrow={null}
          title={HOST_UNRESPONSIVE_TITLE}
          description={hostUnresponsiveDescription(state)}
          actionLabel="Force restart"
          onAction={forceRestart}
          onLater={null}
        />,
        {
          id: HOST_UNRESPONSIVE_TOAST_ID,
          description: null,
          duration: Infinity,
          cancel: null,
        },
      );
    });
    return () => {
      subscription.dispose();
      toast.dismiss(HOST_UNRESPONSIVE_TOAST_ID);
    };
  }, [forceRestart, runnerHost]);

  return null;
}
