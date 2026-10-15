import { createContext, useContext } from "react";
import type { LocalOverride } from "@traycer/protocol/host/environment-schemas";
import {
  pendingUploadKeys,
  type PersonalHostState,
  type PersonalPageStatusLine,
} from "@/components/settings/personal/personal-page-status";

export interface PersonalPageContextValue {
  readonly state: PersonalHostState;
  readonly line: PersonalPageStatusLine | null;
  readonly hostName: string;
  /** This host's machine facts: values that apply on it only. */
  readonly localOverrides: readonly LocalOverride[];
}

export const NO_OVERRIDES: readonly LocalOverride[] = [];

export const PersonalPageContext =
  createContext<PersonalPageContextValue | null>(null);

/**
 * The window host's state as the Personal page around this component read
 * it, or `null` outside a Personal page. Rows read it for their own marks
 * ("pending").
 */
export function usePersonalHostState(): PersonalHostState | null {
  return useContext(PersonalPageContext)?.state ?? null;
}

/** The window host's name, or `null` outside a Personal page. */
export function usePersonalHostName(): string | null {
  return useContext(PersonalPageContext)?.hostName ?? null;
}

/**
 * What a row of `kind` says beside its name, keyed by the row's key: "Pending"
 * while an edit made offline waits for its receipt, "Overridden on <host>"
 * where this host keeps a value of its own. Empty outside a Personal page.
 */
export function usePersonalRowNotes(
  kind: "variable",
): ReadonlyMap<string, string> {
  const value = useContext(PersonalPageContext);
  if (value === null) return EMPTY_NOTES;
  const notes = new Map<string, string>();
  for (const override of value.localOverrides) {
    if (override.target.kind === kind) {
      notes.set(override.target.key, `Overridden on ${value.hostName}`);
    }
  }
  // Pending wins: it is the newer fact about the row.
  for (const key of pendingUploadKeys(value.state, kind)) {
    notes.set(key, "Pending");
  }
  return notes.size === 0 ? EMPTY_NOTES : notes;
}

const EMPTY_NOTES: ReadonlyMap<string, string> = new Map();
