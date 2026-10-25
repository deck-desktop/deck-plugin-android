// A live session with scrcpy's server on the phone: its H.264 video and its control socket.
//
// The server is scrcpy's own (Genymobile/scrcpy, Apache-2.0), one file, downloaded from its
// release the first time and kept in this plugin's data folder, checked against the release's
// SHA-256. It is pushed to the phone's temp folder and run with app_process: nothing is
// installed, and it is gone on the phone's next restart. Against screenrecord it re-sends a still
// screen, so a picture sharpens instead of staying blocky after a change; its encoder is set up
// for live viewing; and taps go over a socket kept open rather than an adb run each.
//
// The protocol is scrcpy's internal one and changes between versions, so the client here is for
// exactly this server version: the server refuses any other.
import { dataDir, fsHash, fsWriteBytes, httpSend, procKill, procStream, tcpClose, tcpStreamBytes, tcpWrite } from "deck-plugin-sdk/bridge";
import { adb, run } from "./adb";

const VERSION = "5.0.1";
const URL = `https://github.com/Genymobile/scrcpy/releases/download/v${VERSION}/scrcpy-server-v${VERSION}`;
const SHA256 = "764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536";
const ON_PHONE = `/data/local/tmp/deck-scrcpy-server-${VERSION}.jar`;

let local: Promise<string> | null = null;
/** The server file on this PC, downloaded and checked the first time. */
function serverFile(): Promise<string> {
  local ??= (async () => {
    const path = `${await dataDir()}\\scrcpy-server-v${VERSION}`;
    if ((await fsHash([path]))[0] === SHA256) return path;
    const r = await httpSend({ method: "GET", url: URL });
    if (r.status !== 200 || !r.body_b64) throw new Error(`scrcpy's server could not be downloaded (${r.status} ${r.status_text})`);
    await fsWriteBytes(path, Uint8Array.from(atob(r.body_b64), (c) => c.charCodeAt(0)));
    const got = (await fsHash([path]))[0];
    if (got !== SHA256) throw new Error("scrcpy's server did not match its published checksum, so it was not used");
    return path;
  })();
  local.catch(() => { local = null; });
  return local;
}

export interface Session {
  /** Send a control message (scrcpy-msg.ts). */
  send(msg: Uint8Array): void;
  stop(): void;
  /** Resolves when the video ends, however it ends. */
  ended: Promise<void>;
}

let seq = 0;

/** Start the server on a phone and connect to it; `onVideo` gets the H.264 stream (an empty chunk when it has gone quiet). */
export async function startSession(serial: string, onVideo: (chunk: Uint8Array) => void, onLog: (line: string) => void): Promise<Session> {
  const file = await serverFile();
  // Pushed every time: the server deletes its own file from the phone as it starts.
  await run(["-s", serial, "push", file, ON_PHONE]);
  const n = ++seq;
  // A 31-bit id for this session's socket name, so two Decks (or two tabs) on one phone do not meet.
  const scid = (Math.floor(Math.random() * 0x7fffffff) | 0).toString(16).padStart(8, "0");
  const ids = { server: `android:scrcpy:${n}`, video: `android:video:${n}`, control: `android:control:${n}` };
  // The dummy byte is kept: on a forward tunnel it is what tells a real connection from adb
  // accepting one with nothing listening behind it yet. The rest of the metadata is off, so what
  // follows it is plain H.264.
  const options = [
    `scid=${scid}`, "log_level=info", "audio=false", "control=true", "tunnel_forward=true",
    "send_device_meta=false", "send_frame_meta=false", "send_stream_meta=false", "send_dummy_byte=true",
    "video_bit_rate=16000000", "max_fps=60", "clipboard_autosync=false", "cleanup=true",
  ].join(" ");
  const exe = await adb();
  const server = procStream(ids.server, exe, ["-s", serial, "shell", `CLASSPATH=${ON_PHONE} app_process / com.genymobile.scrcpy.Server ${VERSION} ${options}`]);
  void server.catch((e: unknown) => onLog(`server: ${String(e)}`));
  const port = Number((await run(["-s", serial, "forward", "tcp:0", `localabstract:scrcpy_${scid}`])).trim());
  const unforward = () => void run(["-s", serial, "forward", "--remove", `tcp:${port}`]).catch(() => { /* gone with the phone */ });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    void tcpClose(ids.video).catch(() => {});
    void tcpClose(ids.control).catch(() => {});
    void procKill(ids.server).catch(() => {});
    unforward();
  };

  // The video socket, tried until the server is listening (it takes a moment to start): until
  // then adb takes the connection and closes it at once, without the dummy byte.
  let ended!: Promise<void>;
  for (let attempt = 0; ; attempt++) {
    if (stopped) throw new Error("stopped");
    let first = true, connected = false;
    let resolveUp!: () => void;
    const up = new Promise<void>((r) => { resolveUp = r; });
    const done = tcpStreamBytes(ids.video, "127.0.0.1", port, (chunk) => {
      if (first && chunk.length) {
        first = false; connected = true; resolveUp();
        if (chunk.length > 1) onVideo(chunk.subarray(1));
        return;
      }
      if (!first) onVideo(chunk);
    });
    const outcome = await Promise.race([up.then(() => "up"), done.then(() => "closed", () => "closed")]);
    if (outcome === "up" && connected) { ended = done.then(() => {}, () => {}); break; }
    if (attempt > 40) { stop(); throw new Error("scrcpy's server did not start on the phone"); }
    await new Promise((r) => setTimeout(r, 100));
  }
  // The control socket comes second, once the video one is in.
  void tcpStreamBytes(ids.control, "127.0.0.1", port, () => { /* clipboard and the like: not used */ })
    .catch((e: unknown) => onLog(`control: ${String(e)}`));
  void ended.then(stop);

  return {
    send: (msg) => { if (!stopped) void tcpWrite(ids.control, msg).catch(() => { /* control not up yet, or closed */ }); },
    stop,
    ended,
  };
}
