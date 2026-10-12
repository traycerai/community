/**
 * Product-policy contract: the installed mobile app offers no dictation.
 *
 * Dictation is host-executed - the mic audio is streamed to the app-wide host,
 * which transcribes it. Desktop's app-wide host is the local machine, so
 * "audio never leaves your machine" holds; the mobile app has no local host, so
 * it cannot hold. The gate therefore keys on the BUILD, and this file asserts
 * both sides of it: nothing about dictation reaches the mobile UI (mic button,
 * preparing indicator, hotkey, or even the host RPC), and the desktop build is
 * untouched.
 *
 * Everything below the composer hook runs real - the availability hook, the
 * hotkey singleton and the keybinding store included. Only the recorder (mic +
 * host stream) and the host RPC transport are faked.
 */
import type { RefObject } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setMobileApp } from "@/lib/mobile-app";
import { useComposerDictation } from "@/hooks/composer/use-composer-dictation";
import { resetDictationWarmScheduleForTests } from "@/hooks/composer/use-dictation-availability";
import { useSettingsStore } from "@/stores/settings/settings-store";
import type { ComposerPromptEditorHandle } from "@/components/chat/composer/composer-prompt-editor";

const recorder = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  toggle: vi.fn(),
  cancel: vi.fn(),
}));

interface RecordedEnsureModelOptions {
  readonly onError: (
    error: Error,
    variables: { readonly modelId: string | null },
    context: { readonly hostId: string | null } | undefined,
  ) => void;
}

const host = vi.hoisted(() => ({
  ensureModel: vi.fn(),
  // The options the last `speech.ensureModel` mutation was built with, so a
  // test can drive its `onError` the way a failed RPC would.
  lastMutationOptions: undefined as RecordedEnsureModelOptions | undefined,
  // Every observed `enabled` the status query was asked for, so a test can
  // assert the speech RPC is never even armed on mobile.
  statusQueryEnabled: [] as boolean[],
  // What `speech.getModelStatus` answers while enabled.
  status: {
    engineAvailable: true,
    downloadState: "ready",
    downloadProgress: null as number | null,
  },
}));

vi.mock("@/hooks/composer/use-voice-dictation", () => ({
  useVoiceDictation: () => ({
    state: "idle" as const,
    errorMessage: null,
    failureClass: null,
    permissionDenied: false,
    start: recorder.start,
    stop: recorder.stop,
    toggle: recorder.toggle,
    cancel: recorder.cancel,
    getStream: () => null,
  }),
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => ({ openMicrophoneSettings: () => Promise.resolve() }),
}));

vi.mock("@/lib/host", () => ({
  useHostClient: () => ({ getActiveHostId: () => "host-1" }),
}));

vi.mock("@/hooks/host/use-host-query", () => ({
  useHostQuery: (args: {
    readonly options: { readonly enabled: boolean };
  }): { readonly data: unknown } => {
    host.statusQueryEnabled.push(args.options.enabled);
    // A host that is fully ready to dictate - so anything the mobile build
    // still shows would be a real leak, not an artifact of an idle host.
    return args.options.enabled ? { data: host.status } : { data: undefined };
  },
  useHostMutation: (args: {
    readonly options: RecordedEnsureModelOptions;
  }): {
    readonly mutate: typeof host.ensureModel;
    readonly isPending: false;
  } => {
    host.lastMutationOptions = args.options;
    return { mutate: host.ensureModel, isPending: false };
  },
}));

function renderComposerDictationFocused(isActive: boolean) {
  const queryClient = new QueryClient();
  const editorRef: RefObject<ComposerPromptEditorHandle | null> = {
    current: null,
  };
  return renderHook(
    (props: { readonly isActive: boolean }) =>
      useComposerDictation({ editorRef, isActive: props.isActive }),
    {
      initialProps: { isActive },
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
}

function renderComposerDictation() {
  return renderComposerDictationFocused(true);
}

// The bound default for `composer.dictation.toggle`.
function pressDictationChord(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code: "KeyM",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
}

beforeEach(() => {
  resetDictationWarmScheduleForTests();
  // jsdom's document never has focus; the warm gate reads it once at mount
  // and follows the window's focus / blur events from then on.
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  host.statusQueryEnabled.length = 0;
  host.lastMutationOptions = undefined;
  host.status = {
    engineAvailable: true,
    downloadState: "ready",
    downloadProgress: null,
  };
  useSettingsStore.setState({ voiceInputEnabled: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  setMobileApp(false);
  useSettingsStore.setState({ voiceInputEnabled: true });
});

describe("dictation on the installed mobile app", () => {
  it("offers no mic control and no preparing indicator", () => {
    setMobileApp(true);
    const { result } = renderComposerDictation();
    // Both composers render the mic from `dictationControl` and the preparing
    // placeholder from `dictationPreparing`; null in both slots is the button
    // being absent from the desktop toolbar and the mobile one alike.
    expect(result.current.dictationControl).toBeNull();
    expect(result.current.dictationPreparing).toBeNull();
  });

  it("leaves the dictation hotkey inert", () => {
    setMobileApp(true);
    renderComposerDictation();
    pressDictationChord();
    expect(recorder.start).not.toHaveBeenCalled();
  });

  it("never asks the host about the speech model", () => {
    setMobileApp(true);
    renderComposerDictation();
    expect(host.statusQueryEnabled).not.toContain(true);
    expect(host.ensureModel).not.toHaveBeenCalled();
  });
});

describe("dictation on other builds", () => {
  it("offers no mic, no hotkey, and no model check when voice input is off", () => {
    useSettingsStore.setState({ voiceInputEnabled: false });
    const { result } = renderComposerDictation();
    expect(result.current.dictationControl).toBeNull();
    expect(result.current.dictationPreparing).toBeNull();
    pressDictationChord();
    expect(recorder.start).not.toHaveBeenCalled();
    expect(host.statusQueryEnabled).not.toContain(true);
    expect(host.ensureModel).not.toHaveBeenCalled();
  });

  it("still offers the mic and the hotkey", () => {
    setMobileApp(false);
    const { result } = renderComposerDictation();
    expect(result.current.dictationControl).not.toBeNull();
    pressDictationChord();
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });
});

// The host answers `speech.ensureModel` for an installed model by loading it
// into its STT worker, and frees the worker five minutes after the last
// session. The active composer therefore re-sends it: once at focus and then
// every four minutes, so the first dictation after a pause does not wait on a
// model load. `isActive` is the composer's focus.
describe("keeping the host's recogniser warm while a composer is focused", () => {
  const WARM_INTERVAL_MS = 4 * 60_000;

  function advance(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("asks the host for the model at once on focus, then once per four minutes", () => {
    vi.useFakeTimers();
    renderComposerDictationFocused(true);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
    expect(host.ensureModel).toHaveBeenCalledWith({ modelId: null });

    advance(WARM_INTERVAL_MS - 1);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
    advance(1);
    expect(host.ensureModel).toHaveBeenCalledTimes(2);

    advance(WARM_INTERVAL_MS);
    expect(host.ensureModel).toHaveBeenCalledTimes(3);
  });

  it("never asks the host while the composer is not focused", () => {
    vi.useFakeTimers();
    renderComposerDictationFocused(false);
    advance(WARM_INTERVAL_MS * 3);
    expect(host.ensureModel).not.toHaveBeenCalled();
  });

  it("starts when focus arrives and stops when it leaves", () => {
    vi.useFakeTimers();
    const { rerender } = renderComposerDictationFocused(false);
    expect(host.ensureModel).not.toHaveBeenCalled();

    rerender({ isActive: true });
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    rerender({ isActive: false });
    advance(WARM_INTERVAL_MS * 3);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
  });

  it("does not re-send for a focus that comes back while the last warm is recent, and keeps the next warm due one interval after the last", () => {
    vi.useFakeTimers();
    const { rerender } = renderComposerDictationFocused(true);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    // Focus leaves and comes back two minutes later: the worker is still
    // warm from the first send, so nothing is sent...
    rerender({ isActive: false });
    advance(2 * 60_000);
    rerender({ isActive: true });
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    // ...and the next warm is still due four minutes after the FIRST one,
    // not four minutes after the return - a re-based interval would leave a
    // six-minute gap, longer than the host's five-minute idle.
    advance(2 * 60_000 - 1);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
    advance(1);
    expect(host.ensureModel).toHaveBeenCalledTimes(2);

    // A focus that returns after a whole interval away warms at once.
    rerender({ isActive: false });
    advance(WARM_INTERVAL_MS);
    rerender({ isActive: true });
    expect(host.ensureModel).toHaveBeenCalledTimes(3);
  });

  it("shares the warm across composers: a second composer focused right after the first sends nothing", () => {
    vi.useFakeTimers();
    renderComposerDictationFocused(true);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    renderComposerDictationFocused(true);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
  });

  it("two focused composers send one warm per interval, not one each", () => {
    vi.useFakeTimers();
    renderComposerDictationFocused(true);
    renderComposerDictationFocused(true);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    // Both timers fire at the same instant: the first sends, the second
    // re-reads the shared timestamp and waits for the next interval.
    advance(WARM_INTERVAL_MS);
    expect(host.ensureModel).toHaveBeenCalledTimes(2);
    advance(WARM_INTERVAL_MS);
    expect(host.ensureModel).toHaveBeenCalledTimes(3);
  });

  it("forgets a warm whose ensure failed, so the next focus sends again", () => {
    vi.useFakeTimers();
    const { rerender } = renderComposerDictationFocused(true);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
    const options = host.lastMutationOptions;
    if (options === undefined) throw new Error("mutation options not seen");

    act(() => {
      options.onError(
        new Error("host unreachable"),
        { modelId: null },
        { hostId: "host-1" },
      );
    });
    // The retry is scheduled for thirty seconds later with no focus change
    // at all (the previous good warm may already be four minutes old, and
    // the host frees the worker at five); the control is "does not re-send
    // for a focus that comes back while the last warm is recent" above.
    advance(30_000 - 1);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
    advance(1);
    expect(host.ensureModel).toHaveBeenCalledTimes(2);

    // A retry that succeeds falls back to the normal cadence.
    advance(WARM_INTERVAL_MS - 1);
    expect(host.ensureModel).toHaveBeenCalledTimes(2);
    advance(1);
    expect(host.ensureModel).toHaveBeenCalledTimes(3);
    rerender({ isActive: true });
  });

  it("stops while the window is in the background and warms again when it returns", () => {
    vi.useFakeTimers();
    renderComposerDictationFocused(true);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    advance(WARM_INTERVAL_MS * 3);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(host.ensureModel).toHaveBeenCalledTimes(2);
  });

  it("sends nothing while the model is still downloading", () => {
    vi.useFakeTimers();
    host.status = {
      engineAvailable: true,
      downloadState: "downloading",
      downloadProgress: 0.4,
    };
    renderComposerDictationFocused(true);
    advance(WARM_INTERVAL_MS * 2);
    expect(host.ensureModel).not.toHaveBeenCalled();
  });

  it("sends nothing where the engine is unavailable", () => {
    vi.useFakeTimers();
    host.status = {
      engineAvailable: false,
      downloadState: "ready",
      downloadProgress: null,
    };
    renderComposerDictationFocused(true);
    advance(WARM_INTERVAL_MS * 2);
    expect(host.ensureModel).not.toHaveBeenCalled();
  });

  it("sends nothing when voice input is off, however focused the composer is", () => {
    vi.useFakeTimers();
    useSettingsStore.setState({ voiceInputEnabled: false });
    renderComposerDictationFocused(true);
    advance(WARM_INTERVAL_MS * 2);
    expect(host.ensureModel).not.toHaveBeenCalled();
  });

  it("stops warming when the composer unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = renderComposerDictationFocused(true);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    unmount();
    advance(WARM_INTERVAL_MS * 3);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
  });
});
