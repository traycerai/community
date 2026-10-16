import { useId, useState, type ReactNode } from "react";
import { useIsMutating } from "@tanstack/react-query";
import type { AuthenticatedUser } from "@traycer/protocol/auth";
import {
  SANDBOX_REFUSAL_CODE_ENVIRONMENT_NOT_FOUND,
  SANDBOX_REFUSAL_CODE_INSUFFICIENT_CREDIT,
  type SandboxCatalogue,
  type SandboxCatalogueProvider,
  type SandboxCatalogueRegion,
  type SandboxOs,
} from "@traycer/protocol/host/sandbox-control";
import {
  defaultBelongsTo,
  SANDBOX_CREATE_ASK_ADMIN_LABEL,
  SANDBOX_CREATE_ENVIRONMENT_UNAVAILABLE_LINE,
  sandboxCreateTeams,
  sandboxNoProvidersLine,
  sandboxNotAMemberLine,
  sandboxTeamCreateLines,
  teamCannotCoverAnHour,
  teamHasNoProviders,
  teamSandboxBalanceMc,
  type SandboxCreateBelongsTo,
  type SandboxCreateTeam,
} from "@/components/hosts/sandbox-create-model";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthUser } from "@/hooks/auth/use-auth-user-query";
import { useEnvironmentProviders } from "@/hooks/sandboxes/use-environment-providers-query";
import { useSandboxCatalogue } from "@/hooks/sandboxes/use-sandbox-catalogue-query";
import {
  SandboxCreateError,
  useSandboxCreate,
  type SandboxCreateSubmit,
} from "@/hooks/sandboxes/use-sandbox-create-mutation";
import { useTeamEnvironment } from "@/hooks/sandboxes/use-team-environment-query";
import type { TeamEnvironmentFetchResult } from "@traycer-clients/shared/host-client/sandbox-secrets";
import {
  formatCredits,
  formatMemory,
  roundSandboxShape,
  sandboxShapeProblem,
  type SandboxShape,
} from "@/lib/sandboxes/sandbox-pricing";
import { sandboxMutationKeys } from "@/lib/query-keys";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useSandboxCreateDialogStore } from "@/stores/settings/sandbox-create-dialog-store";

const MB_PER_GIB = 1024;
const NAME_MAX_LENGTH = 191;

/**
 * Idle periods the form offers, in minutes. The server takes 2 minutes to one
 * week; these are the core flows' choices inside that range. The server has
 * no "never" yet (`null` means its 30-minute default), so neither does the
 * form.
 */
const IDLE_CHOICES: readonly {
  readonly minutes: number;
  readonly label: string;
}[] = [
  { minutes: 5, label: "5 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 120, label: "2 hours" },
  { minutes: 1440, label: "24 hours" },
];
const DEFAULT_IDLE_MINUTES = 30;

const OS_LABEL: Record<SandboxOs, string> = {
  linux: "Linux",
  windows: "Windows",
};

/**
 * Creating a sandbox from Settings: whom it belongs to (Personal or one of
 * the person's teams), OS, a free-form size within the catalogue's bounds,
 * region, idle period and name, from `GET /api/sandboxes/catalogue`. Mounted
 * once beside the add-host dialog and opened through its store, with the
 * entry's preselection.
 *
 * A team pick (ticket E17 checkpoint 3) always shows its four lines, warns
 * when the team has no provider, names the team on a refusal the server
 * leaves unnamed, and asks the person to go to a team admin when their
 * bundle under the team cannot cover an hour.
 */
export function SandboxCreateDialog(): ReactNode {
  const open = useSandboxCreateDialogStore((s) => s.open);
  const closeDialog = useSandboxCreateDialogStore((s) => s.closeDialog);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent
        className="w-[min(92vw,30rem)] sm:max-w-[min(92vw,30rem)]"
        data-testid="sandbox-create-dialog"
      >
        <DialogHeader>
          <DialogTitle>New sandbox</DialogTitle>
          <DialogDescription>
            A cloud machine your agents can run on. It is billed by the hour
            while awake and suspends when idle.
          </DialogDescription>
        </DialogHeader>
        {open ? <SandboxCreateDialogBody onDone={closeDialog} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SandboxCreateDialogBody(props: {
  readonly onDone: () => void;
}): ReactNode {
  const signedIn = useAuthStore((s) => s.status === "signed-in");
  const catalogue = useSandboxCatalogue(true);
  const userQuery = useAuthUser();
  const user = userQuery.data ?? null;
  const preselect = useSandboxCreateDialogStore((s) => s.preselect);
  const workingHostTeamId = useSandboxCreateDialogStore(
    (s) => s.workingHostTeamId,
  );
  // Signed out, the catalogue query is disabled and stays pending with no
  // fetch behind it: say why instead of spinning.
  if (!signedIn) {
    return (
      <p
        className="text-ui-sm text-muted-foreground"
        data-testid="sandbox-create-signed-out"
      >
        Sign in to create a sandbox.
      </p>
    );
  }
  // The form takes its Belongs to once, from the person's teams: wait for
  // them, or a team preselection would open on Personal.
  if (catalogue.isPending || userQuery.isPending) {
    return (
      <div className="flex items-center gap-2 text-ui-sm text-muted-foreground">
        <AgentSpinningDots
          className={undefined}
          testId="sandbox-create-loading"
          variant={undefined}
        />
        Loading sizes and regions…
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-ui-sm text-muted-foreground">
          {catalogue.error.message}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void catalogue.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  const offered = offeredOses(catalogue.data);
  if (offered.length === 0) {
    return (
      <p className="text-ui-sm text-muted-foreground">
        Sandboxes aren&apos;t offered right now.
      </p>
    );
  }
  const teams = sandboxCreateTeams(user);
  return (
    <SandboxCreateForm
      catalogue={catalogue.data}
      initialOs={offered[0]}
      user={user}
      teams={teams}
      initialBelongsTo={defaultBelongsTo(preselect, workingHostTeamId, teams)}
      onDone={props.onDone}
    />
  );
}

interface SandboxFormState {
  readonly name: string;
  readonly os: SandboxOs;
  readonly cpus: string;
  readonly memoryGb: string;
  readonly region: string;
  readonly idleMinutes: number;
}

function initialFormState(
  provider: SandboxCatalogueProvider,
  os: SandboxOs,
): SandboxFormState {
  const { shape } = provider;
  const memoryMb = Math.max(
    shape.memoryMinMb,
    shape.cpuMin * shape.memoryPerCpuMinMb,
  );
  return {
    name: "",
    os,
    cpus: String(shape.cpuMin),
    memoryGb: String(memoryMb / MB_PER_GIB),
    // The server's own default: its first priced region.
    region: provider.regions.at(0)?.id ?? "",
    idleMinutes: DEFAULT_IDLE_MINUTES,
  };
}

function SandboxCreateForm(props: {
  readonly catalogue: SandboxCatalogue;
  readonly initialOs: SandboxOs;
  readonly user: AuthenticatedUser | null;
  readonly teams: readonly SandboxCreateTeam[];
  readonly initialBelongsTo: SandboxCreateBelongsTo;
  readonly onDone: () => void;
}): ReactNode {
  const ids = useId();
  const [belongsTo, setBelongsTo] = useState<SandboxCreateBelongsTo>(
    props.initialBelongsTo,
  );
  const team = pickedTeam(belongsTo, props.teams);
  const [form, setForm] = useState<SandboxFormState>(() =>
    initialFormState(
      providerFor(props.catalogue, props.initialOs),
      props.initialOs,
    ),
  );
  const create = useSandboxCreate();
  // A create outlives this form: closing the dialog unmounts it, and a
  // reopened form's own mutation is idle. Any create in flight for this
  // account, from any mount, holds the submit, so a second one is never sent
  // meanwhile; another account's create does not.
  const userId = useAuthStore((s) => s.contextMetadata?.userId ?? null);
  const creating =
    useIsMutating({ mutationKey: sandboxMutationKeys.create(userId) }) > 0;
  const provider = providerFor(props.catalogue, form.os);
  const requested = {
    cpus: Number(form.cpus),
    memoryMb: Math.round(Number(form.memoryGb) * MB_PER_GIB),
  };
  const problem = sandboxShapeProblem(provider.shape, requested);
  const rounded = roundSandboxShape(provider.shape, requested);
  const region =
    provider.regions.find((candidate) => candidate.id === form.region) ??
    provider.regions.at(0) ??
    null;
  const name = form.name.trim();
  const target = useTeamTarget(team, props.user, create, {
    region,
    shape: rounded,
  });
  const canSubmit =
    problem === null &&
    region !== null &&
    name.length > 0 &&
    !creating &&
    target.ready;

  return (
    // `noValidate`: the number inputs carry the catalogue's min / max / step
    // for their spinners, and native validation would refuse an off-step
    // value (2.1 GB, 1.5 vCPU) before `onSubmit` ran - the very value the
    // price line says will be rounded. Range is `sandboxShapeProblem`'s to
    // refuse; the step is `roundSandboxShape`'s to apply.
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        create.mutate(
          {
            request: {
              os: form.os,
              cpus: rounded.cpus,
              memoryMb: rounded.memoryMb,
              diskMb: null,
              region: region.id,
              displayName: name,
              idleMinutes: form.idleMinutes,
              burst: false,
              createdByHostId: null,
              createdByAgentId: null,
              // Personal stays `null`, the request as it always was.
              environmentId: target.environmentId,
            },
            teamName: target.teamName,
          },
          { onSuccess: () => props.onDone() },
        );
      }}
    >
      <SandboxBelongsToField
        id={`${ids}-belongs-to`}
        teams={props.teams}
        belongsTo={belongsTo}
        team={team}
        target={target}
        onChange={setBelongsTo}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-name`}>Name</Label>
        <Input
          id={`${ids}-name`}
          value={form.name}
          maxLength={NAME_MAX_LENGTH}
          placeholder="build-box"
          data-testid="sandbox-create-name"
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SandboxCreateSelect
          id={`${ids}-os`}
          label="Operating system"
          value={form.os}
          testId={null}
          options={offeredOses(props.catalogue).map((os) => ({
            value: os,
            label: OS_LABEL[os],
          }))}
          onChange={(value) => {
            const os = offeredOses(props.catalogue).find((o) => o === value);
            if (os === undefined) return;
            setForm({
              ...initialFormState(providerFor(props.catalogue, os), os),
              name: form.name,
              idleMinutes: form.idleMinutes,
            });
          }}
        />
        <SandboxCreateSelect
          id={`${ids}-region`}
          label="Region"
          value={region?.id ?? ""}
          options={provider.regions.map((candidate) => ({
            value: candidate.id,
            label: candidate.label,
          }))}
          testId={null}
          onChange={(value) => setForm({ ...form, region: value })}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-cpus`}>vCPU</Label>
          <Input
            id={`${ids}-cpus`}
            type="number"
            inputMode="decimal"
            min={provider.shape.cpuMin}
            max={provider.shape.cpuMax}
            step={provider.shape.cpuStep}
            value={form.cpus}
            data-testid="sandbox-create-cpus"
            onChange={(event) => setForm({ ...form, cpus: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-memory`}>Memory (GB)</Label>
          <Input
            id={`${ids}-memory`}
            type="number"
            inputMode="decimal"
            min={provider.shape.memoryMinMb / MB_PER_GIB}
            max={provider.shape.memoryMaxMb / MB_PER_GIB}
            step={provider.shape.memoryStepMb / MB_PER_GIB}
            value={form.memoryGb}
            data-testid="sandbox-create-memory"
            onChange={(event) =>
              setForm({ ...form, memoryGb: event.target.value })
            }
          />
        </div>
        <SandboxCreateSelect
          id={`${ids}-idle`}
          label="Suspend when idle for"
          value={String(form.idleMinutes)}
          options={IDLE_CHOICES.map((choice) => ({
            value: String(choice.minutes),
            label: choice.label,
          }))}
          testId={null}
          onChange={(value) => setForm({ ...form, idleMinutes: Number(value) })}
        />
      </div>
      <SandboxPriceLine
        problem={problem}
        requested={requested}
        rounded={rounded}
        regionLabel={region?.label ?? null}
        fromAwakeMc={region?.fromPriceMcPerHour.awakeMc ?? null}
      />
      {creating && !create.isPending ? (
        <p
          className="text-ui-sm text-muted-foreground"
          data-testid="sandbox-create-in-flight"
        >
          A sandbox is being created…
        </p>
      ) : null}
      <SandboxCreateFooter
        askAdmin={target.askAdmin}
        canSubmit={canSubmit}
        creating={creating}
      />
    </form>
  );
}

/**
 * The form's submit, or, when the person's bundle under the team cannot pay
 * for an hour, a disabled "Ask a team admin for more capacity": nothing this
 * form can change fixes that, so the button says who can.
 */
function SandboxCreateFooter(props: {
  readonly askAdmin: boolean;
  readonly canSubmit: boolean;
  readonly creating: boolean;
}): ReactNode {
  if (props.askAdmin) {
    return (
      <DialogFooter>
        <Button type="button" disabled data-testid="sandbox-create-ask-admin">
          {SANDBOX_CREATE_ASK_ADMIN_LABEL}
        </Button>
      </DialogFooter>
    );
  }
  return (
    <DialogFooter>
      <Button
        type="submit"
        disabled={!props.canSubmit}
        data-testid="sandbox-create-submit"
      >
        {props.creating ? (
          <AgentSpinningDots
            className={undefined}
            testId="sandbox-create-spinner"
            variant={undefined}
          />
        ) : null}
        Create sandbox
      </Button>
    </DialogFooter>
  );
}

/**
 * The price line. The catalogue prices only each region's SMALLEST shape (a
 * "from" figure); the exact rate of the size chosen is the created sandbox's
 * own, shown on its card. A shape outside the catalogue replaces the line
 * with the reason, and the Create button stays disabled.
 */
function SandboxPriceLine(props: {
  readonly problem: string | null;
  readonly requested: { readonly cpus: number; readonly memoryMb: number };
  readonly rounded: { readonly cpus: number; readonly memoryMb: number };
  readonly regionLabel: string | null;
  readonly fromAwakeMc: number | null;
}): ReactNode {
  if (props.problem !== null) {
    return (
      <p
        className="text-ui-sm text-destructive"
        role="alert"
        data-testid="sandbox-create-shape-problem"
      >
        {props.problem}
      </p>
    );
  }
  const roundedNote =
    props.rounded.cpus !== props.requested.cpus ||
    props.rounded.memoryMb !== props.requested.memoryMb
      ? `Rounded to ${props.rounded.cpus} vCPU and ${formatMemory(props.rounded.memoryMb)}. `
      : "";
  return (
    <p
      className="text-ui-xs text-muted-foreground"
      data-testid="sandbox-create-price"
    >
      {props.fromAwakeMc === null || props.regionLabel === null
        ? `${roundedNote}The rate shows on the sandbox's card once it is created.`
        : `${roundedNote}From ${formatCredits(props.fromAwakeMc)} credits per hour awake in ${props.regionLabel}, for the smallest size; this size's exact rate shows on its card once it is created.`}
    </p>
  );
}

const PERSONAL_VALUE = "personal";

/** The team Belongs to names, or `null` for Personal (or a team gone). */
function pickedTeam(
  belongsTo: SandboxCreateBelongsTo,
  teams: readonly SandboxCreateTeam[],
): SandboxCreateTeam | null {
  if (belongsTo.kind === "personal") return null;
  return teams.find((t) => t.teamId === belongsTo.teamId) ?? null;
}

/** The form's last create: its error and what it was sent with. */
interface LastCreate {
  readonly error: Error | null;
  readonly variables: SandboxCreateSubmit | undefined;
}

/** The region and rounded size the form would create now. */
interface AskedShape {
  readonly region: SandboxCatalogueRegion | null;
  readonly shape: SandboxShape;
}

/** What a team pick allows: whether to submit, and what to say instead. */
interface TeamTarget {
  /** The team's environment, once read; `null` for Personal or while read. */
  readonly environmentId: string | null;
  /** The picked team's name, for a refusal the server leaves unnamed. */
  readonly teamName: string | null;
  /** Personal, or a team whose environment has been read. */
  readonly ready: boolean;
  /** The bundle under the team cannot cover an hour (lower bound or 402). */
  readonly askAdmin: boolean;
  readonly noProviders: boolean;
  /** Why the team cannot be created into, or `null`. */
  readonly refusalLine: string | null;
}

/**
 * The reads behind a team pick: its environment (only for the picked team,
 * since the route creates the environment on its first call), then that
 * environment's providers, and the person's balance under the team.
 */
function useTeamTarget(
  team: SandboxCreateTeam | null,
  user: AuthenticatedUser | null,
  last: LastCreate,
  asked: AskedShape,
): TeamTarget {
  const region = asked.region;
  const environment = useTeamEnvironment(team === null ? null : team.teamId);
  const answer = team === null ? null : (environment.data ?? null);
  const environmentId = answer?.kind === "ok" ? answer.environmentId : null;
  const providers = useEnvironmentProviders(environmentId);
  const counts = providers.data?.kind === "ok" ? providers.data.counts : null;
  // The last create's refusal, if it was sent to this team's environment.
  const refusalCode =
    last.error instanceof SandboxCreateError &&
    environmentId !== null &&
    last.variables?.request.environmentId === environmentId
      ? last.error.code
      : null;
  if (team === null) {
    return {
      environmentId: null,
      teamName: null,
      ready: true,
      askAdmin: false,
      noProviders: false,
      refusalLine: null,
    };
  }
  return {
    environmentId,
    teamName: team.name,
    // Without its environment the create would be the person's own.
    ready: environmentId !== null,
    askAdmin:
      teamCannotCoverAnHour(
        teamSandboxBalanceMc(user, team.teamId),
        region === null ? null : region.fromPriceMcPerHour.awakeMc,
      ) ||
      (refusalCode === SANDBOX_REFUSAL_CODE_INSUFFICIENT_CREDIT &&
        refusedThisShape(last, asked)),
    noProviders: teamHasNoProviders(counts),
    refusalLine: teamRefusalLine(team, answer, refusalCode),
  };
}

/**
 * Whether the last create asked for this region and size. A 402 answers the
 * shape it was sent for: a smaller one, or another region's price, may fit,
 * so changing either gives the submit back.
 */
function refusedThisShape(last: LastCreate, asked: AskedShape): boolean {
  const sent = last.variables?.request ?? null;
  return (
    sent !== null &&
    asked.region !== null &&
    sent.region === asked.region.id &&
    sent.cpus === asked.shape.cpus &&
    sent.memoryMb === asked.shape.memoryMb
  );
}

/** Why a picked team cannot be created into, named for it; else `null`. */
function teamRefusalLine(
  team: SandboxCreateTeam,
  answer: TeamEnvironmentFetchResult | null,
  refusalCode: string | null,
): string | null {
  if (refusalCode === SANDBOX_REFUSAL_CODE_ENVIRONMENT_NOT_FOUND) {
    return sandboxNotAMemberLine(team.name);
  }
  if (answer === null || answer.kind === "ok") return null;
  if (answer.kind === "not-a-member") return sandboxNotAMemberLine(team.name);
  return SANDBOX_CREATE_ENVIRONMENT_UNAVAILABLE_LINE;
}

/**
 * Belongs to: Personal or one of the person's teams, above the name, with a
 * team pick's lines under it. Absent for a person in no team.
 */
function SandboxBelongsToField(props: {
  readonly id: string;
  readonly teams: readonly SandboxCreateTeam[];
  readonly belongsTo: SandboxCreateBelongsTo;
  readonly team: SandboxCreateTeam | null;
  readonly target: TeamTarget;
  readonly onChange: (next: SandboxCreateBelongsTo) => void;
}): ReactNode {
  if (props.teams.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <SandboxCreateSelect
        id={props.id}
        label="Belongs to"
        value={
          props.belongsTo.kind === "team"
            ? props.belongsTo.teamId
            : PERSONAL_VALUE
        }
        testId="sandbox-create-belongs-to"
        options={[
          { value: PERSONAL_VALUE, label: "Personal" },
          ...props.teams.map((t) => ({ value: t.teamId, label: t.name })),
        ]}
        onChange={(value) =>
          props.onChange(
            value === PERSONAL_VALUE
              ? { kind: "personal" }
              : { kind: "team", teamId: value },
          )
        }
      />
      {props.team === null ? null : (
        <SandboxTeamLines
          team={props.team}
          noProviders={props.target.noProviders}
          refusalLine={props.target.refusalLine}
        />
      )}
    </div>
  );
}

/**
 * A team pick's lines: the four the flows always show, then the providers
 * warning and a refusal when there is one.
 */
function SandboxTeamLines(props: {
  readonly team: SandboxCreateTeam;
  readonly noProviders: boolean;
  readonly refusalLine: string | null;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex flex-col gap-1 text-ui-xs text-muted-foreground"
        data-testid="sandbox-create-team-lines"
      >
        {sandboxTeamCreateLines(props.team.name).map((line) => (
          <p key={line} data-testid="sandbox-create-team-line">
            {line}
          </p>
        ))}
      </div>
      {props.noProviders ? (
        <p
          className="text-ui-xs text-warning-foreground"
          data-testid="sandbox-create-no-providers"
        >
          {sandboxNoProvidersLine(props.team.name)}
        </p>
      ) : null}
      {props.refusalLine === null ? null : (
        <p
          className="text-ui-sm text-destructive"
          role="alert"
          data-testid="sandbox-create-team-refusal"
        >
          {props.refusalLine}
        </p>
      )}
    </div>
  );
}

function SandboxCreateSelect(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly testId: string | null;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly onChange: (value: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger
          id={props.id}
          className="w-full"
          data-testid={props.testId ?? undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Every OS some provider offers, in catalogue order. */
function offeredOses(catalogue: SandboxCatalogue): readonly SandboxOs[] {
  const seen: SandboxOs[] = [];
  for (const provider of catalogue.providers) {
    if (provider.regions.length === 0) continue;
    for (const os of provider.os) {
      if (!seen.includes(os)) seen.push(os);
    }
  }
  return seen;
}

/**
 * The provider that serves an OS: the first offering it, as the server's
 * `quoteShape` picks. Only ever called with an OS from {@link offeredOses}.
 */
function providerFor(
  catalogue: SandboxCatalogue,
  os: SandboxOs,
): SandboxCatalogueProvider {
  const provider = catalogue.providers.find(
    (candidate) => candidate.regions.length > 0 && candidate.os.includes(os),
  );
  if (provider === undefined) {
    throw new Error(`No provider offers ${os}`);
  }
  return provider;
}
