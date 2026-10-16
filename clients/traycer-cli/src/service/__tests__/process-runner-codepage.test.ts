import { afterEach, describe, expect, it, vi } from "vitest";

// The probe is the only part that needs a Windows console; everything else in
// the decode path is real. `vi.hoisted` because the factory runs before the
// imports below.
const probe = vi.hoisted(() => ({
  codePage: null as number | null,
  rejects: false,
}));
vi.mock("../console-codepage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../console-codepage")>();
  return {
    ...actual,
    consoleOutputCodePage: () =>
      probe.rejects
        ? Promise.reject(new Error("probe failed"))
        : Promise.resolve(probe.codePage),
  };
});

import {
  cachedCodePageProbe,
  DECODER_LABEL_BY_CODEPAGE,
  decodeChildOutput,
  parseChcpOutput,
  type ChcpExec,
} from "../console-codepage";
import {
  ProcessRunError,
  runCommand,
  runCommandForBytes,
} from "../process-runner";

// What a Russian Windows `schtasks` prints for a missing task, written from
// the Cyrillic text and the decoder's own table rather than pasted as bytes.
const LOCALIZED_NOT_FOUND = "ОШИБКА: Не удается найти указанный файл.";

// There is no cp866 TextEncoder: a single-byte encoding is a 256-entry table,
// so build the encoder by inverting the decoder.
function encodeIbm866(text: string): Buffer {
  const decoder = new TextDecoder("ibm866");
  const byChar = new Map<string, number>();
  for (let byte = 0; byte < 256; byte += 1) {
    byChar.set(decoder.decode(Uint8Array.of(byte)), byte);
  }
  const out: number[] = [];
  for (const char of text) {
    const byte = byChar.get(char);
    if (byte === undefined) throw new Error(`not in cp866: ${char}`);
    out.push(byte);
  }
  return Buffer.from(out);
}

const ORIGINAL_PLATFORM = Object.getOwnPropertyDescriptor(process, "platform");

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

afterEach(() => {
  if (ORIGINAL_PLATFORM !== undefined) {
    Object.defineProperty(process, "platform", ORIGINAL_PLATFORM);
  }
  probe.codePage = null;
  probe.rejects = false;
});

const options = {
  env: undefined,
  cwd: undefined,
  timeoutMs: 30_000,
  tolerateNonZeroExit: false,
};

function childWriting(stream: "stdout" | "stderr", bytes: Buffer): string[] {
  return [
    "-e",
    `process.${stream}.write(Buffer.from(${JSON.stringify(bytes.toString("base64"))}, "base64")); process.exit(1)`,
  ];
}

describe("the fixture", () => {
  it("is not valid UTF-8, so only the codepage can read it", () => {
    const bytes = encodeIbm866(LOCALIZED_NOT_FOUND);
    expect(() =>
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ).toThrow();
    expect(new TextDecoder("ibm866").decode(bytes)).toBe(LOCALIZED_NOT_FOUND);
  });
});

describe("runCommand on Windows with a cp866 console", () => {
  it("builds the ProcessRunError message from the decoded stderr", async () => {
    setPlatform("win32");
    probe.codePage = 866;
    let error: unknown;
    try {
      await runCommand(
        process.execPath,
        childWriting("stderr", encodeIbm866(LOCALIZED_NOT_FOUND)),
        options,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProcessRunError);
    const failure = error as ProcessRunError;
    expect(failure.message).toContain(
      `exited with code 1: ${LOCALIZED_NOT_FOUND}`,
    );
    expect(failure.stderr).toBe(LOCALIZED_NOT_FOUND);
  });

  it("decodes stdout the same way when the command exits 0 or is tolerated", async () => {
    setPlatform("win32");
    probe.codePage = 866;
    const result = await runCommand(
      process.execPath,
      childWriting("stdout", encodeIbm866(LOCALIZED_NOT_FOUND)),
      { ...options, tolerateNonZeroExit: true },
    );
    expect(result.stdout).toBe(LOCALIZED_NOT_FOUND);
  });

  it("decodes the stderr of the bytes variant, and leaves stdout as bytes", async () => {
    setPlatform("win32");
    probe.codePage = 866;
    const result = await runCommandForBytes(
      process.execPath,
      childWriting("stderr", encodeIbm866(LOCALIZED_NOT_FOUND)),
      { env: undefined, cwd: undefined, timeoutMs: 30_000 },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(LOCALIZED_NOT_FOUND);
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
  });

  it("still settles, with the UTF-8 text, when the codepage probe rejects", async () => {
    setPlatform("win32");
    probe.rejects = true;
    const bytes = encodeIbm866(LOCALIZED_NOT_FOUND);
    let error: unknown;
    try {
      await runCommand(
        process.execPath,
        childWriting("stderr", bytes),
        options,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProcessRunError);
    expect((error as ProcessRunError).message).toContain(
      `exited with code 1: ${bytes.toString("utf8").trim()}`,
    );
    const result = await runCommandForBytes(
      process.execPath,
      childWriting("stderr", bytes),
      { env: undefined, cwd: undefined, timeoutMs: 30_000 },
    );
    expect(result.stderr).toBe(bytes.toString("utf8"));
  });

  it("keeps UTF-8 a child wrote on purpose, whatever the console codepage", async () => {
    setPlatform("win32");
    probe.codePage = 866;
    const result = await runCommand(
      process.execPath,
      childWriting("stdout", Buffer.from(LOCALIZED_NOT_FOUND, "utf8")),
      { ...options, tolerateNonZeroExit: true },
    );
    expect(result.stdout).toBe(LOCALIZED_NOT_FOUND);
  });
});

describe("decodeChildOutput fallbacks", () => {
  const bytes = encodeIbm866(LOCALIZED_NOT_FOUND);
  const lossy = bytes.toString("utf8");

  it("codepage 866 decodes as cp866", async () => {
    expect(await decodeChildOutput(bytes, () => Promise.resolve(866))).toBe(
      LOCALIZED_NOT_FOUND,
    );
  });

  it.each([65001, null])(
    "codepage %s (UTF-8 console, or no console / failed probe) decodes as UTF-8",
    async (codePage) => {
      expect(
        await decodeChildOutput(bytes, () => Promise.resolve(codePage)),
      ).toBe(lossy);
    },
  );

  it("an unsupported codepage falls back to UTF-8 without throwing", async () => {
    // 437 and 850 are real OEM pages the WHATWG decoder has no label for.
    for (const codePage of [437, 850, 123456]) {
      expect(
        await decodeChildOutput(bytes, () => Promise.resolve(codePage)),
      ).toBe(lossy);
    }
  });

  it("a source that rejects or throws falls back to UTF-8", async () => {
    expect(
      await decodeChildOutput(bytes, () =>
        Promise.reject(new Error("probe failed")),
      ),
    ).toBe(lossy);
    expect(
      await decodeChildOutput(bytes, () => {
        throw new Error("probe threw");
      }),
    ).toBe(lossy);
  });

  it("reads a literal cp866 byte vector, not only the table-inverted fixture", async () => {
    // "ОШИБКА" in cp866, written as the bytes the OS emits.
    const literal = Buffer.from([0x8e, 0x98, 0x88, 0x81, 0x8a, 0x80]);
    expect(await decodeChildOutput(literal, () => Promise.resolve(866))).toBe(
      "ОШИБКА",
    );
  });

  it("every codepage in the label table has a decoder in this Node", () => {
    for (const [codePage, label] of DECODER_LABEL_BY_CODEPAGE) {
      expect(
        () => new TextDecoder(label),
        `codepage ${String(codePage)} -> ${label}`,
      ).not.toThrow();
    }
  });

  it("does not probe for ASCII or for valid UTF-8", async () => {
    const neverProbed = (): Promise<number | null> => {
      throw new Error("probed");
    };
    expect(
      await decodeChildOutput(
        Buffer.from("ERROR: Access is denied."),
        neverProbed,
      ),
    ).toBe("ERROR: Access is denied.");
    expect(
      await decodeChildOutput(
        Buffer.from(LOCALIZED_NOT_FOUND, "utf8"),
        neverProbed,
      ),
    ).toBe(LOCALIZED_NOT_FOUND);
  });
});

describe("non-Windows platforms", () => {
  it("never consult the console codepage", async () => {
    setPlatform("linux");
    probe.codePage = 866;
    const result = await runCommand(
      process.execPath,
      childWriting("stdout", encodeIbm866(LOCALIZED_NOT_FOUND)),
      { ...options, tolerateNonZeroExit: true },
    );
    expect(result.stdout).toBe(
      encodeIbm866(LOCALIZED_NOT_FOUND).toString("utf8"),
    );
  });
});

describe("parseChcpOutput", () => {
  it.each([
    ["Active code page: 437", 437],
    ["Текущая кодовая страница: 866\r\n", 866],
    ["Page de codes active : 850.", 850],
    ["Active code page: 65001\r\n", 65001],
  ])("%j -> %j", (text, expected) => {
    expect(parseChcpOutput(Buffer.from(text, "utf8"))).toBe(expected);
  });

  it("reads the number from a localized sentence in real cp866 bytes", () => {
    expect(
      parseChcpOutput(encodeIbm866("Текущая кодовая страница: 866\r\n")),
    ).toBe(866);
  });

  it("is null for output with no number", () => {
    expect(parseChcpOutput(Buffer.from("not recognized"))).toBeNull();
    expect(parseChcpOutput(Buffer.alloc(0))).toBeNull();
  });
});

describe("cachedCodePageProbe", () => {
  type Call = { file: string; windowsHide: true; timeout: number };

  function probeOf(
    behave: (callback: (err: Error | null, stdout: Buffer) => void) => void,
  ): { run: () => Promise<number | null>; calls: Call[] } {
    const calls: Call[] = [];
    const exec: ChcpExec = (file, options, callback) => {
      calls.push({
        file,
        windowsHide: options.windowsHide,
        timeout: options.timeout,
      });
      behave(callback);
    };
    return { run: cachedCodePageProbe(exec), calls };
  }

  it("runs chcp.com hidden with a timeout and parses its number", async () => {
    const { run, calls } = probeOf((callback) => {
      callback(null, Buffer.from("Active code page: 866\r\n"));
    });
    expect(await run()).toBe(866);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toMatch(/System32\\chcp\.com$/);
    expect(calls[0]?.windowsHide).toBe(true);
    expect(calls[0]?.timeout).toBeGreaterThan(0);
  });

  it("is null when chcp fails to spawn", async () => {
    const { run } = probeOf((callback) => {
      callback(new Error("spawn chcp.com ENOENT"), Buffer.alloc(0));
    });
    expect(await run()).toBeNull();
  });

  it("is null when chcp is killed by the timeout", async () => {
    const { run } = probeOf((callback) => {
      callback(
        Object.assign(new Error("Command failed"), {
          killed: true,
          signal: "SIGTERM",
        }),
        Buffer.alloc(0),
      );
    });
    expect(await run()).toBeNull();
  });

  it("is null when the exec itself throws, and never rejects", async () => {
    const { run } = probeOf(() => {
      throw new Error("spawn threw");
    });
    expect(await run()).toBeNull();
  });

  it("runs the child once per process, sharing the result", async () => {
    const { run, calls } = probeOf((callback) => {
      callback(null, Buffer.from("Active code page: 850"));
    });
    const results = await Promise.all([run(), run()]);
    expect(await run()).toBe(850);
    expect(results).toEqual([850, 850]);
    expect(calls).toHaveLength(1);
  });
});
