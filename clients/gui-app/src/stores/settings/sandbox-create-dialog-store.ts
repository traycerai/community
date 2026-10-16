import { create } from "zustand";
import type { SandboxOs } from "@traycer/protocol/host/sandbox-control";
import type { SandboxCreateBelongsTo } from "@/components/hosts/sandbox-create-model";

/**
 * What the person has entered, kept here rather than in the form: the form
 * remounts while the dialog stays open (two dialog copies share this store's
 * `open`, and the body's loading gates), and a remount must not bring the
 * defaults back over what was typed (F46).
 */
export interface SandboxCreateDraft {
  readonly name: string;
  readonly os: SandboxOs;
  readonly cpus: string;
  readonly memoryGb: string;
  readonly region: string;
  readonly idleMinutes: number;
  readonly belongsTo: SandboxCreateBelongsTo;
}

/** The last create's failure, said in the form while the dialog is open. */
export interface SandboxCreateFailureLine {
  /** The copy for the server's refusal code; never the provider's own text. */
  readonly message: string;
  readonly code: string | null;
}

/** "New sandbox…": one store, one mounted dialog, like the add-host dialog. */
interface SandboxCreateDialogState {
  readonly open: boolean;
  /** The entry's preselection (a team group's New sandbox, "like this"). */
  readonly preselect: SandboxCreateBelongsTo | null;
  /** The team owning the host the person is working from, when it has one. */
  readonly workingHostTeamId: string | null;
  /** `null` until the form first renders after an open. */
  readonly draft: SandboxCreateDraft | null;
  readonly failure: SandboxCreateFailureLine | null;
  readonly openDialog: (
    preselect: SandboxCreateBelongsTo | null,
    workingHostTeamId: string | null,
  ) => void;
  readonly closeDialog: () => void;
  readonly setDraft: (draft: SandboxCreateDraft) => void;
  readonly setFailure: (failure: SandboxCreateFailureLine | null) => void;
}

export const useSandboxCreateDialogStore = create<SandboxCreateDialogState>(
  (set) => ({
    open: false,
    preselect: null,
    workingHostTeamId: null,
    draft: null,
    failure: null,
    // A new open is a new sandbox: nothing from the last one carries over.
    openDialog: (preselect, workingHostTeamId) =>
      set({
        open: true,
        preselect,
        workingHostTeamId,
        draft: null,
        failure: null,
      }),
    closeDialog: () => set({ open: false }),
    setDraft: (draft) => set({ draft }),
    setFailure: (failure) => set({ failure }),
  }),
);
