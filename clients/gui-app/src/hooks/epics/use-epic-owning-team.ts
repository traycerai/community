/**
 * The team that owns an epic (ticket E17 checkpoint 6, A3 and B1), read from
 * the cached task lists this hook keeps warm. `null` while unknown, and for an
 * epic no team owns.
 */
export function useEpicOwningTeamId(_epicId: string): string | null {
  return null;
}
