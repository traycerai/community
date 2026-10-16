import { create } from "zustand";
import type { LandingOwnerChoice } from "@/components/home/composer/landing-owner-model";

interface LandingOwnerState {
  /** The person's explicit Belongs to pick per landing draft. */
  readonly byDraftId: Readonly<Record<string, LandingOwnerChoice>>;
  readonly setChoice: (draftId: string, choice: LandingOwnerChoice) => void;
}

/**
 * The Belongs to pick per landing draft (ticket E17 checkpoint 6, A1). Kept in
 * memory: a draft with no pick follows its resolved host's team.
 */
export const useLandingOwnerStore = create<LandingOwnerState>()(() => ({
  byDraftId: {},
  setChoice: () => undefined,
}));
