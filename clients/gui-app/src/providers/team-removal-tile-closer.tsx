import { useCloseTilesOnTeamRemoval } from "@/hooks/teams/use-close-tiles-on-team-removal";

/** Mounts the removed-member tile close (ticket E17 checkpoint 6) app-wide. */
export function TeamRemovalTileCloser(): null {
  useCloseTilesOnTeamRemoval();
  return null;
}
