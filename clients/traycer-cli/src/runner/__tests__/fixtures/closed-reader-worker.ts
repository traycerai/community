import { flushStdio, writeStderr, writeStdout } from "../../std-write";

// Worker for `std-write-closed-reader.test.ts`. Keeps writing through the
// REAL `std-write` seam after the parent has closed its end of the pipe, so
// the kernel answers every later write with EPIPE.
//
// `WORKER_STREAM` picks which descriptor is written. `WORKER_INJECT_ERROR_CODE`
// additionally makes the stream's own write path fail with that code after the
// first write, for the case where the error is NOT a closed reader.
// `WORKER_OWN_ERROR_LISTENER=1` installs a no-op `error` listener BEFORE the
// first write, the way `acknowledgeRelocationEntry` does for a relocated
// host-stopping command, so another listener already owns stream errors.
const stream = process.env.WORKER_STREAM;
if (stream !== "stdout" && stream !== "stderr") {
  throw new Error(
    `WORKER_STREAM must be "stdout" or "stderr", got ${String(stream)}`,
  );
}
const write = stream === "stdout" ? writeStdout : writeStderr;
const target = stream === "stdout" ? process.stdout : process.stderr;

if (process.env.WORKER_OWN_ERROR_LISTENER === "1") {
  target.on("error", () => undefined);
}

// One kernel pipe buffer per chunk, so each write is a real syscall against
// the closed reader rather than something the stream buffers away.
const CHUNK = `${"x".repeat(65_536)}\n`;
const ROUNDS = 40;
const ROUND_DELAY_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The parent closes its end when it sees this first line.
write("ready\n");

const injectedCode = process.env.WORKER_INJECT_ERROR_CODE;
if (injectedCode !== undefined && injectedCode.length > 0) {
  // Fail the stream's own write path, so the error reaches `error` listeners
  // the way a real failing write does (Writable destroys the stream and emits
  // `error`) rather than by hand-emitting the event.
  Object.defineProperty(target, "_write", {
    configurable: true,
    value: (
      _chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ): void => {
      callback(
        Object.assign(new Error("injected stream error"), {
          code: injectedCode,
        }),
      );
    },
  });
  write("after-injection\n");
}

for (let round = 0; round < ROUNDS; round += 1) {
  await sleep(ROUND_DELAY_MS);
  write(CHUNK);
}

await flushStdio();
process.exit(0);
