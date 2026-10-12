import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHostQuery, useHostMutation } from "@/hooks/host/use-host-query";
import { useHostClient, type HostRpcRegistry } from "@/lib/host";
import { isMobileApp } from "@/lib/mobile-app";
import { hostQueryKeys, speechMutationKeys } from "@/lib/query-keys";

// `modelId: null` selects the host's default dictation model.
const SPEECH_MODEL_PARAMS = { modelId: null };
// Cap auto-download attempts so a persistently failing download (bad network /
// disk) doesn't loop forever; resets once the model becomes ready.
const MAX_ENSURE_ATTEMPTS = 3;
// How often a focused composer re-sends `speech.ensureModel` to keep the
// host's STT worker warm. The host frees the worker five minutes after the
// last warm or session, so a warm every four keeps the models loaded for as
// long as a composer is in front of the person, and a composer that loses
// focus - or a window that goes to the background - stops sending and lets
// the host free it.
const WARM_INTERVAL_MS = 4 * 60_000;
// A warm whose RPC failed is tried again this soon, not at the next
// interval: the previous good warm may already be four minutes old, and the
// host frees the worker at five. Bounded, so a host that is down is asked
// twice a minute at most, not in a loop.
const WARM_RETRY_DELAY_MS = 30_000;
// When each host was last warmed, shared by every composer in this window:
// a focus moving between composers, or coming back to one, sends nothing
// while the last warm is recent, and the next warm is always due exactly one
// interval after the last - never re-based by a focus edge, which would let
// the host's five-minute idle expire between two warms.
const lastWarmAtByHost = new Map<string, number>();
// Every mounted hook, told when the schedule above changed under it (a warm
// failed) so the FOCUSED composer re-arms its timer - the composer whose RPC
// failed may have lost focus since it sent.
const warmScheduleListeners = new Set<() => void>();

function notifyWarmScheduleChanged(): void {
  for (const listener of warmScheduleListeners) listener();
}

/** Forgets every host's last warm, so a test starts from a cold host. */
export function resetDictationWarmScheduleForTests(): void {
  lastWarmAtByHost.clear();
}

/**
 * Whether this window is the one in front of the person (`document.hasFocus`,
 * kept current by the window's own `focus` / `blur` events). Not
 * `visibilitychange`: the desktop shell never fires it (every window runs
 * with `backgroundThrottling: false`), and no browser fires it when focus
 * moves between two visible windows.
 */
function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const onFocus = (): void => {
      setFocused(true);
    };
    const onBlur = (): void => {
      setFocused(false);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return focused;
}

interface EnsureModelMutationContext {
  readonly hostId: string | null;
}

/**
 * The on-device model is being readied (engine present but not yet usable): the
 * composer shows a "preparing" indicator instead of silently nothing.
 */
export interface DictationPreparingStatus {
  readonly downloadState: "absent" | "downloading" | "ready" | "error";
  // 0..1 while downloading, else null.
  readonly progress: number | null;
}

export interface DictationAvailability {
  // Engine present AND model installed - dictation is usable now.
  readonly ready: boolean;
  // Non-null while the engine is present but the model is still downloading /
  // absent / errored, so the UI can show a status indicator. Null when ready, or
  // when dictation is off/unsupported (no engine) and nothing should show.
  readonly preparing: DictationPreparingStatus | null;
}

/**
 * Dictation readiness: polls `speech.getModelStatus`, silently kicks off
 * `speech.ensureModel` when the model is absent, and reports a usable/preparing
 * status. Composers gate the mic button + shortcut on `ready` (so dictation is
 * never offered, and the OS mic prompt never fires, before the on-device model
 * exists) and surface `preparing` as a status indicator while it downloads.
 *
 * `focused` is the composer the person is at: while it is true and the model
 * is ready, `speech.ensureModel` is re-sent every few minutes. The host
 * answers an ensure for an installed model by loading it into its STT worker,
 * so the first dictation after a pause does not pay the model load after the
 * mic stops (oss #1836).
 *
 * DELIBERATELY the app-wide host (`useHostClient()`), not the composer's target
 * host - the documented exception to the composer host-scope rule in
 * `AGENTS.md`. Dictation describes the person at the keyboard, not the run:
 * `speech.dictate` streams live microphone audio and `speech.ensureModel`
 * downloads an on-device model, so following a remote run target would ship a
 * user's audio to a machine they only picked to execute a turn on, and drop a
 * model download there. The accepted cost is that a composer pinned to another
 * host gates its mic on the app-wide host's model rather than that host's. Do
 * not "fix" this by threading a target client through - it is a change to where
 * a user's voice goes, and wants that conversation first.
 */
export function useDictationAvailability(
  enabled: boolean,
  focused: boolean,
): DictationAvailability {
  // The installed mobile app never offers dictation, whatever the setting says.
  // Dictation is HOST-executed: `speech.dictate` streams live microphone audio
  // to the app-wide host (see above) and that host's on-device engine
  // transcribes it. On desktop the app-wide host is the same machine, which is
  // what Settings' "audio never leaves your machine" promise rests on. The
  // mobile app has no local host - every host it can reach is a remote machine
  // - so offering the mic there would stream phone microphone audio off the
  // device and break that promise. Hence the gate is on the BUILD
  // (`isMobileApp()`) and not on viewport width: a phone-width desktop browser
  // can still be talking to an honest localhost host, and keeps its mic.
  const available = enabled && !isMobileApp();
  const client = useHostClient();
  const queryClient = useQueryClient();

  const statusQuery = useHostQuery<HostRpcRegistry, "speech.getModelStatus">({
    cacheKeyIdentity: undefined,
    client,
    method: "speech.getModelStatus",
    params: SPEECH_MODEL_PARAMS,
    options: {
      enabled: available,
    },
  });

  // Bumped when the shared schedule changed (a warm failed, in this composer
  // or another) so the warm effect re-arms its timer.
  const [scheduleVersion, setScheduleVersion] = useState(0);
  useEffect(() => {
    const listener = (): void => {
      setScheduleVersion((version) => version + 1);
    };
    warmScheduleListeners.add(listener);
    return () => {
      warmScheduleListeners.delete(listener);
    };
  }, []);
  const ensureMutation = useHostMutation<
    HostRpcRegistry,
    "speech.ensureModel",
    EnsureModelMutationContext
  >({
    client,
    method: "speech.ensureModel",
    mapVariables: (variables) => variables,
    options: {
      mutationKey: speechMutationKeys.ensureModel(),
      onMutate: () => ({ hostId: client.getActiveHostId() }),
      onError: (_error, _variables, context) => {
        // A warm that did not reach the host (restarting, disconnected) is
        // no warm: make the next one due in a short while, and wake the
        // effect so its timer is re-armed for that rather than for the next
        // interval, which the worker's idle could expire inside.
        if (context !== undefined && context.hostId !== null) {
          lastWarmAtByHost.set(
            context.hostId,
            Date.now() - WARM_INTERVAL_MS + WARM_RETRY_DELAY_MS,
          );
          notifyWarmScheduleChanged();
        }
      },
      onSuccess: (_result, _variables, context) => {
        if (context.hostId !== null) {
          void queryClient.invalidateQueries({
            queryKey: hostQueryKeys.method<
              HostRpcRegistry,
              "speech.getModelStatus"
            >(context.hostId, "speech.getModelStatus", SPEECH_MODEL_PARAMS),
          });
        }
      },
    },
  });

  // Self-heal: if the engine can run but the model isn't present (or a prior
  // download errored), download it - no UI, the mic simply appears once ready.
  // Don't download where the engine is unavailable (e.g. a build without the
  // sherpa addon). Capped retries so a persistent failure can't loop.
  const engineAvailable = statusQuery.data?.engineAvailable ?? false;
  const downloadState = statusQuery.data?.downloadState ?? null;
  const downloadProgress = statusQuery.data?.downloadProgress ?? null;
  const ensure = ensureMutation.mutate;
  const ensurePending = ensureMutation.isPending;
  const activeHostId = client.getActiveHostId();
  // The attempt budget is per-host: a different host has its own model on
  // disk, so switching hosts must reset it (otherwise host A exhausting the
  // budget would permanently disable auto-ensure for host B).
  const attemptsRef = useRef(0);
  const budgetHostRef = useRef(activeHostId);
  useEffect(() => {
    if (budgetHostRef.current !== activeHostId) {
      budgetHostRef.current = activeHostId;
      attemptsRef.current = 0;
    }
    if (!available || !engineAvailable) return;
    if (downloadState === "ready") {
      attemptsRef.current = 0;
      return;
    }
    if (downloadState === "downloading" || ensurePending) return;
    if (
      (downloadState === "absent" || downloadState === "error") &&
      attemptsRef.current < MAX_ENSURE_ATTEMPTS
    ) {
      attemptsRef.current += 1;
      ensure(SPEECH_MODEL_PARAMS);
    }
  }, [
    available,
    engineAvailable,
    downloadState,
    ensurePending,
    ensure,
    activeHostId,
  ]);

  // Keep the host's STT worker warm while this composer has the person's
  // attention and the window is in front of them. A warm is sent when one
  // is due - at once if this host was never warmed or its last warm is older
  // than the interval, otherwise when the interval since that warm elapses -
  // and then every interval. The worker is ~2 GB resident, so a window in
  // the background sends nothing and the host frees it; the next return
  // warms it again before the mic is pressed. Per host, like the budget
  // above: a warm on host A says nothing about host B's worker.
  const ready = available && engineAvailable && downloadState === "ready";
  const windowFocused = useWindowFocused();
  useEffect(() => {
    if (!focused || !windowFocused || !ready || activeHostId === null) return;
    const hostId = activeHostId;
    let timer: number | null = null;
    // Sends when a warm is due, otherwise waits for it: re-read at every
    // tick, since another composer's timer may have sent in the meantime.
    const warm = (): void => {
      const now = Date.now();
      const last = lastWarmAtByHost.get(hostId);
      if (last !== undefined && last + WARM_INTERVAL_MS > now) {
        timer = window.setTimeout(warm, last + WARM_INTERVAL_MS - now);
        return;
      }
      lastWarmAtByHost.set(hostId, now);
      ensure(SPEECH_MODEL_PARAMS);
      timer = window.setTimeout(warm, WARM_INTERVAL_MS);
    };
    warm();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [focused, windowFocused, ready, ensure, activeHostId, scheduleVersion]);

  if (!available || !engineAvailable) return { ready: false, preparing: null };
  if (downloadState === "ready") return { ready: true, preparing: null };
  // Engine present, model not ready yet → surface a preparing indicator.
  return {
    ready: false,
    preparing: {
      downloadState: downloadState ?? "absent",
      progress: downloadProgress,
    },
  };
}
