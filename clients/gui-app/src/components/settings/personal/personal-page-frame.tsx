import { useContext, type ReactNode } from "react";
import {
  NO_OVERRIDES,
  PersonalPageContext,
} from "@/components/settings/personal/personal-page-context";
import { usePersonalHostScope } from "@/components/settings/host-scope/use-host-scope";
import type { LocalOverride } from "@traycer/protocol/host/environment-schemas";
import {
  personalPageItemKinds,
  personalPageStatusLine,
  type PersonalHostState,
  type PersonalPageStatusLine,
} from "@/components/settings/personal/personal-page-status";
import { useRereadOnStaleWrite } from "@/hooks/environment/use-reread-on-stale-write";
import { useHostMethodSupport } from "@/hooks/host/use-host-supports-method";
import { useHostQuery } from "@/hooks/host/use-host-query";
import type { HostRpcRegistry } from "@/lib/host";
import type { SettingsSectionId } from "@/lib/settings-sections";
import { cn } from "@/lib/utils";

/** Read through the window's own host, like every Personal page. */
function useWindowHostEnvironmentState(): {
  readonly state: PersonalHostState;
  readonly hostName: string;
  readonly localOverrides: readonly LocalOverride[];
} {
  const scope = usePersonalHostScope();
  const supported = useHostMethodSupport(scope.hostId, "environment.status");
  const query = useHostQuery<HostRpcRegistry, "environment.status">({
    cacheKeyIdentity: undefined,
    client: scope.client,
    method: "environment.status",
    params: {},
    options: {
      enabled: supported === true,
      // Re-read while open, at the cadence the method's policy declares.
      poll: true,
    },
  });
  const overridesSupported = useHostMethodSupport(
    scope.hostId,
    "environment.localOverrides",
  );
  const overridesQuery = useHostQuery<
    HostRpcRegistry,
    "environment.localOverrides"
  >({
    cacheKeyIdentity: undefined,
    client: scope.client,
    method: "environment.localOverrides",
    params: {},
    options: { enabled: overridesSupported === true },
  });
  let state: PersonalHostState = { kind: "unknown" };
  if (supported === false) state = { kind: "unsupported" };
  else if (query.data !== undefined) {
    state =
      query.data.principal === null
        ? { kind: "not-set-up" }
        : { kind: "ready", status: query.data };
  }
  return {
    state,
    hostName: scope.hostLabel,
    localOverrides: overridesQuery.data?.overrides ?? NO_OVERRIDES,
  };
}

/**
 * Wraps a Personal page: its status line (rendered by `SettingsPanelShell`
 * under the page's description) and, on a host whose version predates these
 * settings, the read-only rendering the flows give it: the page shows the
 * host's own values and takes no edits until the host is updated.
 *
 * Mounted once per page by `SettingsPanelForSection`, which both settings
 * surfaces render through, so neither can show a Personal page without it.
 */
export function PersonalPageFrame(props: {
  readonly section: SettingsSectionId;
  readonly children: ReactNode;
}): ReactNode {
  // Every settings page, not only the ones that report status: a save on any
  // of them can lose to a change made elsewhere.
  useRereadOnStaleWrite(usePersonalHostScope().hostId);
  const kinds = personalPageItemKinds(props.section);
  if (kinds === null) return props.children;
  return (
    <PersonalPageFrameForKinds kinds={kinds}>
      {props.children}
    </PersonalPageFrameForKinds>
  );
}

function PersonalPageFrameForKinds(props: {
  readonly kinds: ReadonlySet<string>;
  readonly children: ReactNode;
}): ReactNode {
  const { state, hostName, localOverrides } = useWindowHostEnvironmentState();
  const line = personalPageStatusLine(state, props.kinds, hostName);
  const readOnly = state.kind === "unsupported";
  return (
    <PersonalPageContext.Provider
      value={{ state, line, hostName, localOverrides }}
    >
      {readOnly ? (
        <div className="contents">
          <PersonalPageReadOnlyLine />
          <div inert className="opacity-60">
            {props.children}
          </div>
        </div>
      ) : (
        props.children
      )}
    </PersonalPageContext.Provider>
  );
}

/**
 * The read-only page's note, outside the inert region so it stays readable
 * by assistive technology; the shell skips its own line in that state.
 */
function PersonalPageReadOnlyLine(): ReactNode {
  const line = useContext(PersonalPageContext)?.line ?? null;
  if (line === null) return null;
  return (
    <div className="mx-auto w-full max-w-5xl px-5 pt-5">
      <PersonalPageStatusBanner line={line} />
    </div>
  );
}

const TONE_CLASSES: Readonly<Record<PersonalPageStatusLine["tone"], string>> = {
  info: "border-info/30 bg-info/10 text-info-foreground",
  warning: "border-warning/30 bg-warning/10 text-warning-foreground",
  success: "border-success/30 bg-success/10 text-success-foreground",
};

function PersonalPageStatusBanner(props: {
  readonly line: PersonalPageStatusLine;
}): ReactNode {
  return (
    <p
      data-testid="personal-page-status"
      role="status"
      className={cn(
        "max-w-[72ch] rounded-md border px-3 py-1.5 text-ui-sm",
        TONE_CLASSES[props.line.tone],
      )}
    >
      {props.line.text}
    </p>
  );
}

/**
 * The status line inside a Personal page's header, for `SettingsPanelShell`.
 * Nothing outside a Personal page, and nothing on a read-only one, whose line
 * the frame draws above the inert page instead.
 */
export function PersonalPageHeaderStatus(): ReactNode {
  const value = useContext(PersonalPageContext);
  if (value === null || value.line === null) return null;
  if (value.state.kind === "unsupported") return null;
  return <PersonalPageStatusBanner line={value.line} />;
}
