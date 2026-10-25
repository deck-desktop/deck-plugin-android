// adb, as Deck's exec runs it: every call here is the adb client on this PC, so nothing is native.
import { exec, fsHomeDir } from "deck-plugin-sdk/bridge";
import { parseDevices, type Device } from "./parse";

export type { Device };

let exe: Promise<string> | null = null;
/** adb on PATH, or Android Studio's, in the SDK's usual folder. */
export function adb(): Promise<string> {
  exe ??= exec("adb", ["version"]).then(
    (r: { code: number }) => (r.code === 0 ? "adb" : Promise.reject(new Error("adb did not run"))),
  ).catch(async () => `${await fsHomeDir()}\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe`);
  return exe;
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
