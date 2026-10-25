// adb, as Deck's exec runs it: every call here is the adb client on this PC, so nothing is native.
//
// Found on PATH, in this plugin's own copy (installed from the tab when there is no other), or in
// Android Studio's SDK, in that order. Without one, the tab offers to install Google's platform
// tools into the plugin's data folder: nothing system-wide.
import { dataDir, exec, fsDelete, fsHomeDir, fsWriteBytes, httpSend } from "deck-plugin-sdk/bridge";
import { parseDevices, type Device } from "./parse";

export type { Device };

/** Google's platform tools for Windows, always its newest release. */
const PLATFORM_TOOLS = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";

const runs = (program: string) =>
  exec(program, ["version"]).then((r: { code: number }) => r.code === 0, () => false);

let exe: Promise<string | null> | null = null;
/** The adb to run, or null when there is none on this PC. */
export function findAdb(): Promise<string | null> {
  exe ??= (async () => {
    if (await runs("adb")) return "adb";
    const own = `${await dataDir()}\\platform-tools\\adb.exe`;
    if (await runs(own)) return own;
    const studio = `${await fsHomeDir()}\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe`;
    if (await runs(studio)) return studio;
    return null;
  })();
  // Not found is asked again next time: an install, or a PATH change, may have put one there.
  void exe.then((e) => { if (!e) exe = null; });
  return exe;
}

/** The adb to run; an error, said plainly, when there is none. */
export async function adb(): Promise<string> {
  const e = await findAdb();
  if (!e) throw new Error("adb is not installed");
  return e;
}

/** Download Google's platform tools and unpack them into this plugin's data folder. */
export async function installAdb(): Promise<string> {
  const dir = await dataDir();
  const zip = `${dir}\\platform-tools.zip`;
  const r = await httpSend({ method: "GET", url: PLATFORM_TOOLS });
  if (r.status !== 200 || !r.body_b64) throw new Error(`the platform tools could not be downloaded (${r.status} ${r.status_text})`);
  if (r.truncated) throw new Error("the platform tools are larger than Deck downloads in one go");
  await fsWriteBytes(zip, Uint8Array.from(atob(r.body_b64), (c) => c.charCodeAt(0)));
  try {
    // Windows' own tar reads a zip.
    const x = (await exec("tar", ["-xf", zip, "-C", dir])) as { code: number; stderr: string };
    if (x.code !== 0) throw new Error(`the platform tools could not be unpacked: ${x.stderr.trim()}`);
  } finally {
    await fsDelete(zip).catch(() => { /* unpacked or not, the zip is not needed */ });
  }
  exe = null;
  const found = await findAdb();
  if (!found) throw new Error("adb was unpacked but does not run");
  return found;
}

/** adb's output for `args`, when it worked. */
export async function run(args: string[]): Promise<string> {
  const r = (await exec(await adb(), args)) as { stdout: string; stderr: string; code: number };
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `adb exited with ${r.code}`);
  return r.stdout;
}

/** A command in the device's shell. */
export const shell = (serial: string, command: string) => run(["-s", serial, "shell", command]);

export const devices = () => run(["devices", "-l"]).then(parseDevices);
