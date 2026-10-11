import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Regression coverage for Sentry TRAYCER-CLI-25 (`Error: write EPIPE`, fatal).
//
// When the reader of the CLI's stdout/stderr closes its end of the pipe
// (`traycer ... | head -1`, a desktop that gave up on the child), the next
// write fails with EPIPE. `std-write` already settles the write's callback on
// that error, but Node ALSO emits `error` on the stream, and an `error` event
// with no listener is thrown as an uncaught exception - the CLI died with
// exit 1 over a reader that had simply gone away.
//
// Real subprocess over a real pipe, for the same reason as `std-write.test.ts`:
// the failure is the interaction between a closed pipe and the stream's error
// event, which nothing in-process reproduces.
//
// Under NODE, not bun (unlike `std-write.test.ts`): bun does not emit the
// stream `error` event on a closed reader, so the same worker exits 0 there
// with or without the fix and proves nothing. The released CLI is a Node SEA,
// which is where Sentry saw the crash. The worker is bundled with esbuild
// first because Node cannot resolve its extensionless TypeScript imports.

const WORKER_SOURCE = join(
  import.meta.dirname,
  "fixtures",
  "closed-reader-worker.ts",
);

// Bundling the fixture and spawning node can exceed vitest's default 5s
// budget on a cold cache.
const SPAWN_TIMEOUT_MS = 30_000;

type WorkerStream = "stdout" | "stderr";

interface WorkerRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
}

interface WorkerOptions {
  readonly stream: WorkerStream;
  /** Close the parent's read end of `stream` once the first line arrives. */
  readonly closeReader: boolean;
  readonly injectErrorCode: string | null;
}

let bundleDir = "";
let workerBundle = "";

beforeAll(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), "std-write-closed-reader-"));
  workerBundle = join(bundleDir, "closed-reader-worker.mjs");
  await build({
    entryPoints: [WORKER_SOURCE],
    outfile: workerBundle,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
}, SPAWN_TIMEOUT_MS);

afterAll(async () => {
  if (bundleDir.length > 0) {
    await rm(bundleDir, { recursive: true, force: true });
  }
});

function runWorker(options: WorkerOptions): Promise<WorkerRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [workerBundle], {
      env: {
        ...process.env,
        WORKER_STREAM: options.stream,
        WORKER_INJECT_ERROR_CODE: options.injectErrorCode ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      stderr += text;
    });
    // The worker's stdout is only ever drained, never read.
    child.stdout.resume();

    if (options.closeReader) {
      const reader = options.stream === "stdout" ? child.stdout : child.stderr;
      reader.once("data", () => {
        reader.destroy();
      });
    }

    child.once("close", (code, signal) => {
      resolve({ code, signal, stderr });
    });
  });
}

describe("std-write survives a reader that closed the pipe", () => {
  it.each<WorkerStream>(["stdout", "stderr"])(
    "exits 0 when the %s reader closes mid-stream",
    async (stream) => {
      const run = await runWorker({
        stream,
        closeReader: true,
        injectErrorCode: null,
      });

      // A stderr reader that is gone cannot show us the crash text, so the
      // exit status is the claim; the text check is for the stdout case,
      // where it is still readable.
      expect(run.signal).toBeNull();
      expect(run.code).toBe(0);
      expect(run.stderr).not.toContain("Unhandled 'error' event");
      expect(run.stderr).not.toContain("EPIPE");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "still crashes on a stream error that is not a closed reader",
    async () => {
      const run = await runWorker({
        stream: "stdout",
        closeReader: false,
        injectErrorCode: "EIO",
      });

      // Swallowing EIO (or any other code) would hide a genuinely broken
      // descriptor; only EPIPE means "nobody is listening any more".
      expect(run.code).not.toBe(0);
      expect(run.stderr).toContain("injected stream error");
    },
    SPAWN_TIMEOUT_MS,
  );
});
