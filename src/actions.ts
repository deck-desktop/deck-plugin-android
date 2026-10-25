// What the toolbar does on the phone: screenshots, screen recordings and installing an app. Files
// land in Pictures\Android and Videos\Android, said in a notification with a button to open them.
import { fsCreateDir, fsHomeDir, fsOpen, fsWriteBytes, pickFile, procStream, procStreamBytes } from "deck-plugin-sdk/bridge";
import { notify } from "deck-plugin-sdk/ui";
import { adb, run, shell } from "./adb";

const source = "Android";
let seq = 0;

// Local time, as a file name can hold it: 2026-10-25 13.15.20.
const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`; };

/** `~\<kind>\Android`, made when it is not there yet. */
async function folder(kind: "Pictures" | "Videos"): Promise<string> {
  const parent = `${await fsHomeDir()}\\${kind}`;
  await fsCreateDir(parent, "Android").catch(() => { /* already there */ });
  return `${parent}\\Android`;
}

const saved = (title: string, path: string) =>
  notify({ kind: "activity", source, title, body: path, actions: [{ label: "Open", primary: true, run: () => void fsOpen(path) }] });
const failed = (title: string, e: unknown) => {
  console.warn(`[android] ${title}`, e);
  notify({ kind: "error", source, title, body: String(e).replace(/^Error: /, "") });
};

/** The screen as a PNG, read straight from screencap's output. */
export async function screenshot(serial: string) {
  try {
    const parts: Uint8Array[] = [];
    const r = await procStreamBytes(`android:shot:${++seq}`, await adb(), ["-s", serial, "exec-out", "screencap", "-p"], (c) => parts.push(c));
    const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { png.set(p, at); at += p.length; }
    if (r.code !== 0 || png.length < 8) throw new Error("the phone sent no picture");
    const path = `${await folder("Pictures")}\\Screenshot ${stamp()}.png`;
    await fsWriteBytes(path, png);
    saved("Screenshot saved", path);
  } catch (e) { failed("The screenshot failed", e); }
}

/** The recording running, by device: stopped from the same button that started it. */
const recording = new Map<string, Promise<unknown>>();
const ON_PHONE = "/sdcard/deck-recording.mp4";
export const isRecording = (serial: string) => recording.has(serial);

/** Start recording the screen to a file on the phone (screenrecord's own limit is three minutes). */
export async function startRecording(serial: string, changed: () => void) {
  const done = adb().then((exe) => procStream(`android:record:${++seq}`, exe, ["-s", serial, "shell", "screenrecord", ON_PHONE]));
  recording.set(serial, done);
  changed();
  // Ended on its own (the three minutes, or the phone unplugged): saved all the same.
  void done.then(() => { if (recording.get(serial) === done) void finish(serial, done, changed); }, (e) => { recording.delete(serial); changed(); failed("The recording failed", e); });
}

/** Stop the recording and bring the video over. */
export async function stopRecording(serial: string, changed: () => void) {
  const done = recording.get(serial);
  if (!done) return;
  // SIGINT, as Ctrl+C would: screenrecord then finishes the MP4 properly. Killing adb here would
  // leave it running on the phone and the file unreadable.
  await shell(serial, "pkill -2 -f deck-recording.mp4").catch(() => { /* already ended */ });
  await finish(serial, done, changed);
}

async function finish(serial: string, done: Promise<unknown>, changed: () => void) {
  if (recording.get(serial) !== done) return;
  recording.delete(serial);
  changed();
  try {
    await done;
    const path = `${await folder("Videos")}\\Screen recording ${stamp()}.mp4`;
    await run(["-s", serial, "pull", ON_PHONE, path]);
    saved("Screen recording saved", path);
  } catch (e) { failed("The recording could not be saved", e); }
  finally { await shell(serial, `rm -f ${ON_PHONE}`).catch(() => { /* phone gone */ }); }
}

/** Pick an APK and install it, replacing the app if it is there already. */
export async function installApk(serial: string) {
  const path = await pickFile("apk").catch(() => "");
  if (!path) return;
  const name = path.split(/[\\/]/).pop() ?? path;
  notify({ kind: "activity", source, key: `install:${path}`, transient: true, title: `Installing ${name}…` });
  try {
    await run(["-s", serial, "install", "-r", path]);
    notify({ kind: "activity", source, key: `install:${path}`, title: `Installed ${name}` });
  } catch (e) {
    console.warn("[android] install failed", e);
    notify({ kind: "error", source, key: `install:${path}`, title: `${name} was not installed`, body: String(e).replace(/^Error: /, "") });
  }
}
