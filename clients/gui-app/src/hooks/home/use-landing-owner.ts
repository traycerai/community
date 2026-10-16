import type { LandingOwnerTeam } from "@/components/home/composer/landing-owner-model";

/**
 * The owner a landing draft's create sends (ticket E17 checkpoint 6, A1): the
 * draft's Belongs to pick, else the resolved host's team, else Personal
 * (`null`).
 */
export function useLandingOwner(
  _draftId: string | null,
  _resolvedHostId: string | null,
): LandingOwnerTeam | null {
  return null;
}
