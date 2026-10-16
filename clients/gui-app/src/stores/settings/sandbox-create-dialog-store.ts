import { create } from "zustand";
import type { SandboxCreateBelongsTo } from "@/components/hosts/sandbox-create-model";

/** "New sandbox…": one store, one mounted dialog, like the add-host dialog. */
interface SandboxCreateDialogState {
  readonly open: boolean;
  /** The entry's preselection (a team group's New sandbox, "like this"). */
  readonly preselect: SandboxCreateBelongsTo | null;
  /** The team owning the host the person is working from, when it has one. */
  readonly workingHostTeamId: string | null;
  readonly openDialog: (
    preselect: SandboxCreateBelongsTo | null,
    workingHostTeamId: string | null,
  ) => void;
  readonly closeDialog: () => void;
}

export const useSandboxCreateDialogStore = create<SandboxCreateDialogState>(
  (set) => ({
    open: false,
    preselect: null,
    workingHostTeamId: null,
    openDialog: (preselect, workingHostTeamId) =>
      set({ open: true, preselect, workingHostTeamId }),
    closeDialog: () => set({ open: false }),
  }),
);
