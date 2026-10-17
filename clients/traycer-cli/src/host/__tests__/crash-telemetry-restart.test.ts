import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostCrashTelemetry } from "../crash-telemetry";

// A crash-looping host under a service manager: the supervisor relaunches the
// host MAX_CONSECUTIVE_RELAUNCHES times, exits with the child's code, and
// systemd / launchd starts a NEW supervisor process that does it again. Each
// "supervisor life" below is a fresh module instance (a fresh process in
// effect) over the same home directory, which is all the throttle has to
// remember a previous life by.

interface SentryExtras {
  readonly suppressedCount?: number;
}

interface SentryMessage {
  readonly message: string;
  readonly level: string;
  readonly extras: SentryExtras | undefined;
}

const osHome = vi.hoisted(() => ({ current: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => osHome.current || actual.tmpdir() };
});

const sentryMocks = vi.hoisted(() => ({
  messages: [] as SentryMessage[],
  pendingExtras: undefined as SentryExtras | undefined,
}));

vi.mock("@sentry/node", () => ({
  withScope: (
    fn: (scope: {
      setLevel(level: string): void;
      setFingerprint(fingerprint: readonly string[]): void;
      setTags(tags: Record<string, string>): void;
      setExtras(extras: Record<string, string | number | boolean>): void;
      setUser(user: { id: string }): void;
    }) => void,
  ) => {
    fn({
      setLevel: () => undefined,
      setFingerprint: () => undefined,
      setTags: () => undefined,
      setExtras: (extras) => {
        const { suppressedCount } = extras;
        sentryMocks.pendingExtras =
          typeof suppressedCount === "number" ? { suppressedCount } : {};
      },
      setUser: () => undefined,
    });
  },
  captureMessage: (message: string, level: string) => {
    sentryMocks.messages.push({
      message,
      level,
      extras: sentryMocks.pendingExtras,
    });
    sentryMocks.pendingExtras = undefined;
  },
  flush: () => Promise.resolve(true),
}));

vi.mock("../../sentry-transport", () => ({
  destroySentryTransportRequests: () => 0,
}));

vi.mock("../pid-metadata", () => ({
  readHostPidMetadata: () => Promise.resolve(null),
}));

const RELAUNCHES_PER_SUPERVISOR_LIFE = 5;
const HOUR_MS = 60 * 60 * 1000;

function crash(attemptId: string, exitCode: number): HostCrashTelemetry {
  return {
    environment: "production",
    attemptId,
    supervisorPid: 4242,
    childPid: 4243,
    hostVersion: "1.5.1",
    exitCode,
    signal: null,
    exitMeaning: null,
    hasDiagnosticReport: false,
    uptimeMs: 800,
    stopRequested: false,
    stderrEmpty: true,
    reportMemory: { heapLimitBytes: null, heapUsedBytes: null, rssBytes: null },
  };
}

function fullReports(): number {
  return sentryMocks.messages.filter(
    (entry) => !entry.message.endsWith("(repeated)"),
  ).length;
}

function summaries(): { suppressedCount: number }[] {
  const out: { suppressedCount: number }[] = [];
  for (const entry of sentryMocks.messages) {
    const count = entry.extras?.suppressedCount;
    if (entry.message.endsWith("(repeated)") && count !== undefined) {
      out.push({ suppressedCount: count });
    }
  }
  return out;
}

let home: string;
let nowMs: number;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "traycer-crash-restart-test-"));
  osHome.current = home;
  sentryMocks.messages.length = 0;
  nowMs = Date.UTC(2026, 9, 17, 0, 0, 0);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(nowMs);
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
  osHome.current = "";
});

/** One supervisor life: a fresh module instance, then `crashes` host crashes. */
async function superviseLife(
  crashes: number,
  exitCode: number,
): Promise<void> {
  vi.resetModules();
  const mod = await import("../crash-telemetry");
  for (let index = 0; index < crashes; index += 1) {
    await mod.reportHostCrashToSentry(crash(`attempt-${index}`, exitCode));
    vi.advanceTimersByTime(30_000);
  }
  // The supervisor process ends: its timers go with it.
  vi.clearAllTimers();
}

describe("host crash reports across supervisor restarts", () => {
  it("sends 3 full reports and then a count across two supervisor lives, not 3 per life", async () => {
    await superviseLife(RELAUNCHES_PER_SUPERVISOR_LIFE + 1, 1);
    expect(fullReports()).toBe(3);
    // The service manager restarts the supervisor 30 seconds later.
    await superviseLife(RELAUNCHES_PER_SUPERVISOR_LIFE + 1, 1);
    expect(fullReports()).toBe(3);
  });

  it("keeps the bound over many supervisor lives inside one window", async () => {
    for (let life = 0; life < 6; life += 1) {
      await superviseLife(RELAUNCHES_PER_SUPERVISOR_LIFE + 1, 1);
    }
    expect(fullReports()).toBe(3);
  });

  it("sends the count a supervisor left open when its window ends, even if the next life never crashes", async () => {
    await superviseLife(RELAUNCHES_PER_SUPERVISOR_LIFE + 1, 1);
    expect(summaries()).toEqual([]);
    // A later supervisor starts and resumes the open window; the host stays up.
    vi.resetModules();
    const mod = await import("../crash-telemetry");
    await mod.resumeHostCrashReports("production");
    vi.advanceTimersByTime(HOUR_MS);
    expect(summaries()).toEqual([{ suppressedCount: 3 }]);
    // Resuming again does not send it twice.
    await mod.resumeHostCrashReports("production");
    vi.advanceTimersByTime(HOUR_MS);
    expect(summaries()).toHaveLength(1);
  });

  it("sends an overdue count on resume and does not repeat it from the next life", async () => {
    await superviseLife(RELAUNCHES_PER_SUPERVISOR_LIFE + 1, 1);
    vi.advanceTimersByTime(3 * HOUR_MS);
    vi.resetModules();
    const mod = await import("../crash-telemetry");
    await mod.resumeHostCrashReports("production");
    vi.advanceTimersByTime(1);
    expect(summaries()).toEqual([{ suppressedCount: 3 }]);
    await superviseLife(1, 1);
    vi.advanceTimersByTime(2 * HOUR_MS);
    // 3 hours quiet: the new life's crash is reported in full again.
    expect(fullReports()).toBe(4);
    expect(summaries()).toHaveLength(1);
  });

  it("reports in full again once a kind has stayed quiet for a whole window", async () => {
    await superviseLife(RELAUNCHES_PER_SUPERVISOR_LIFE + 1, 1);
    expect(fullReports()).toBe(3);
    vi.advanceTimersByTime(2 * HOUR_MS);
    await superviseLife(1, 1);
    expect(fullReports()).toBe(4);
  });

  it("budgets a different kind of crash separately across lives", async () => {
    await superviseLife(RELAUNCHES_PER_SUPERVISOR_LIFE + 1, 1);
    await superviseLife(RELAUNCHES_PER_SUPERVISOR_LIFE + 1, 2);
    expect(fullReports()).toBe(6);
  });

  it("reports in full, without throwing, when the state file is torn or unreadable", async () => {
    await superviseLife(RELAUNCHES_PER_SUPERVISOR_LIFE + 1, 1);
    const stateDir = join(home, ".traycer", "cli");
    const files = readdirSync(stateDir).filter((name) =>
      name.startsWith("host-crash-throttle"),
    );
    expect(files).toHaveLength(1);
    writeFileSync(join(stateDir, files[0]), '{"version":1,"kinds":{"host-cr');
    sentryMocks.messages.length = 0;
    await expect(superviseLife(1, 1)).resolves.toBeUndefined();
    expect(fullReports()).toBe(1);
    // Foreign shapes are not state either.
    writeFileSync(join(stateDir, files[0]), '{"version":1,"kinds":[1,2]}');
    await expect(superviseLife(1, 1)).resolves.toBeUndefined();
  });

  it("writes no account identifier, path or stderr into the state file", async () => {
    await superviseLife(2, 1);
    const stateDir = join(home, ".traycer", "cli");
    const files = readdirSync(stateDir).filter((name) =>
      name.startsWith("host-crash-throttle"),
    );
    expect(files).toHaveLength(1);
    const text = (await import("node:fs")).readFileSync(
      join(stateDir, files[0]),
      "utf8",
    );
    expect(text).not.toContain(home);
  });
});
