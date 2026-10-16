import type { EpicCreateOwner } from "@traycer/protocol/host/epic/unary-schemas";
import type { NegotiatedMethodVersion } from "@/lib/host/read-negotiated-method-version";
import type { EpicShareableTeam } from "@/stores/auth/auth-store";

/**
 * Who a new task belongs to, as the person picked it on the landing draft's
 * Belongs to chip (ticket E17 checkpoint 6, A1). No pick yet is `null` in the
 * store, and the owner then follows the resolved host.
 */
export type LandingOwnerChoice =
  | { readonly kind: "personal" }
  | { readonly kind: "team"; readonly teamId: string };

/** A team a task can belong to, named by its slug. */
export interface LandingOwnerTeam {
  readonly teamId: string;
  readonly slug: string;
}

/**
 * The owner a create sends. An explicit pick wins; with none, the team that
 * owns the resolved host when it is one of the person's teams, else Personal.
 * A team the person is no longer in is Personal.
 */
export function resolveLandingOwner(_input: {
  readonly choice: LandingOwnerChoice | null;
  readonly resolvedHostTeamId: string | null;
  readonly teams: ReadonlyArray<EpicShareableTeam>;
}): LandingOwnerTeam | null {
  return null;
}

/**
 * A2: why a team create cannot be sent, decided before any frame, or `null`.
 * The host first (a known version below `1.3`, or the method absent), then
 * the cloud authorization. An unknown version is not refused here: the
 * transport's `epic.create@1.3` floor refuses it before the frame.
 */
export function landingOwnerRefusal(_input: {
  readonly owner: LandingOwnerTeam;
  readonly hostEpicCreateVersion: NegotiatedMethodVersion;
  readonly cloudAuthorized: boolean;
}): string | null {
  return null;
}

/** A2, verbatim: the person is signed out of the cloud. */
export function teamCreateSignInLine(_slug: string): string {
  return "";
}

/** A3, verbatim: the first-chat line under a team pick. */
export function teamFirstChatLine(_slug: string): string {
  return "";
}

/** The `epic.create@1.3` `owner` for a pick: `null` is the person. */
export function epicCreateOwnerFor(
  _owner: LandingOwnerTeam | null,
): EpicCreateOwner | null {
  return null;
}
