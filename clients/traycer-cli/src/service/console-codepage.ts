import { execFile } from "node:child_process";

/**
 * WHATWG `TextDecoder` label for each Windows codepage the decoder can read.
 * Most OEM pages (437, 850, 852, ...) have no WHATWG label, so they are absent
 * on purpose: they fall back to UTF-8, which is what every Windows child was
 * decoded as before this table existed.
 */
const DECODER_LABEL_BY_CODEPAGE: ReadonlyMap<number, string> = new Map([
  [866, "ibm866"],
  [874, "windows-874"],
  [932, "shift_jis"],
  [936, "gbk"],
  [949, "euc-kr"],
  [950, "big5"],
  [1250, "windows-1250"],
  [1251, "windows-1251"],
  [1252, "windows-1252"],
  [1253, "windows-1253"],
  [1254, "windows-1254"],
  [1255, "windows-1255"],
  [1256, "windows-1256"],
  [1257, "windows-1257"],
  [1258, "windows-1258"],
  [20866, "koi8-r"],
  [21866, "koi8-u"],
  [54936, "gb18030"],
]);

/** How long the one-time `chcp` probe may run before it is read as "unknown". */
const CHCP_PROBE_TIMEOUT_MS = 5_000;

/** The number `chcp` prints, whatever the language of the sentence around it. */
export function parseChcpOutput(output: Buffer): number | null {
  // `latin1`: the sentence is localized and in the very codepage being asked
  // about, but the digits are ASCII in every OEM page.
  const match = /(\d+)\D*$/.exec(output.toString("latin1").trim());
  if (match === null || match[1] === undefined) return null;
  const codePage = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(codePage) && codePage > 0 ? codePage : null;
}

function windowsSystemExecutable(filename: string): string {
  const root =
    process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  return `${root.replace(/[\\/]+$/, "")}\\System32\\${filename}`;
}

function probeConsoleOutputCodePage(): Promise<number | null> {
  return new Promise((resolve) => {
    // A child spawned the same way as the command whose output is being
    // decoded, so it inherits the same console (or gets the same fresh one
    // when this process has none, a GUI-launched CLI) and reports the output
    // codepage that command wrote in.
    execFile(
      windowsSystemExecutable("chcp.com"),
      [],
      {
        timeout: CHCP_PROBE_TIMEOUT_MS,
        windowsHide: true,
        encoding: "buffer",
      },
      (err, stdout) => {
        resolve(err === null ? parseChcpOutput(stdout) : null);
      },
    );
  });
}

let cachedProbe: Promise<number | null> | null = null;

/**
 * The console output codepage of this process's console, `null` when it
 * cannot be read. Probed once per process, on first use.
 */
export function consoleOutputCodePage(): Promise<number | null> {
  cachedProbe ??= probeConsoleOutputCodePage();
  return cachedProbe;
}

/** `bytes` as text, or `null` when they are not well-formed UTF-8. */
function strictUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function hasNonAscii(bytes: Buffer): boolean {
  return bytes.some((byte) => byte >= 0x80);
}

/**
 * Decode a Windows child's captured output.
 *
 * A console program writes in the console's output codepage (cp866 on a
 * Russian install), not UTF-8. The order is:
 * 1. all ASCII: every codepage agrees, so nothing is probed;
 * 2. well-formed UTF-8: a child that chose UTF-8 on purpose keeps it, which
 *    legacy-codepage text of any length almost never is;
 * 3. the console codepage, through the WHATWG decoder for it;
 * 4. lossy UTF-8 (the behaviour before this existed) when the codepage is
 *    unknown, UTF-8 itself, or has no decoder in this Node build.
 */
export async function decodeChildOutput(
  bytes: Buffer,
  codePageSource: () => Promise<number | null>,
): Promise<string> {
  if (!hasNonAscii(bytes)) return bytes.toString("utf8");
  const utf8 = strictUtf8(bytes);
  if (utf8 !== null) return utf8;
  const codePage = await codePageSource();
  const label =
    codePage === null ? undefined : DECODER_LABEL_BY_CODEPAGE.get(codePage);
  if (label === undefined) return bytes.toString("utf8");
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // A Node built without full ICU has no legacy decoders.
    return bytes.toString("utf8");
  }
}
