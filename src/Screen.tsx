// The phone's screen, live: screenrecord's H.264 from the phone, decoded by WebCodecs (the GPU's
// decoder, through WebView2) and drawn on a canvas. A click on it is a tap, a drag a swipe, a long
// press a long press, the wheel a scroll, and typing with it focused types on the phone.
import { useEffect, useRef, useState } from "react";
import { procKill, procStreamBytes } from "deck-plugin-sdk/bridge";
import { adb, shell } from "./adb";
import { codecOf, Splitter, type Picture } from "./h264";
import { forInputText } from "./parse";

let seq = 0;

/** Keys sent as Android key events rather than typed. */
const KEYS: Record<string, number> = {
  Enter: 66, Backspace: 67, Delete: 112, Tab: 61, Escape: 4,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22, Home: 122, End: 123,
};

export function Screen({ serial, onStatus, onShape }: { serial: string; onStatus: (s: string) => void; onShape?: (widthOverHeight: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const [ended, setEnded] = useState("");
  const [attempt, setAttempt] = useState(0);

  // The largest box of the phone's shape that fits the pane: the canvas is drawn at exactly that,
  // so a point on it maps straight to the phone's pixels.
  useEffect(() => {
    const el = box.current;
    if (!el || !size) return;
    const measure = () => {
      const s = Math.min(el.clientWidth / size.w, el.clientHeight / size.h);
      setFit((p) => (p && Math.abs(p.w - size.w * s) < 0.5 && Math.abs(p.h - size.h * s) < 0.5 ? p : { w: size.w * s, h: size.h * s }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const id = `android:screen:${++seq}`;
    // Each stream's bit rate a few bits apart, so stopping one on the phone (below) can name it:
    // a view started again before the old one's stop arrives would otherwise be stopped with it.
    const rate = 32_000_000 + (seq % 1000);
    const split = new Splitter();
    let decoder: VideoDecoder | null = null;
    let started = false, stopped = false;
    let frames = 0, last = performance.now();
    setEnded("");

    const show = (f: VideoFrame) => {
      if (c.width !== f.displayWidth || c.height !== f.displayHeight) {
        c.width = f.displayWidth; c.height = f.displayHeight;
        setSize({ w: f.displayWidth, h: f.displayHeight });
        onShape?.(f.displayWidth / f.displayHeight);
      }
      ctx?.drawImage(f, 0, 0);
      f.close();
      frames++;
      const now = performance.now();
      if (now - last > 1000) { onStatus(`${Math.round((frames * 1000) / (now - last))} fps`); frames = 0; last = now; }
    };
    const decode = (pics: Picture[]) => {
      for (const p of pics) {
        if (!decoder && p.key && split.sps) {
          decoder = new VideoDecoder({ output: show, error: (e) => { console.warn("[android] the screen could not be decoded", e); setEnded(String(e.message ?? e)); } });
          // No `description`: the decoder then takes Annex B, start codes and all, as screenrecord writes it.
          decoder.configure({ codec: codecOf(split.sps), optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" });
        }
        // A picture before the first key frame has nothing to be decoded from.
        if (!decoder || decoder.state !== "configured") continue;
        decoder.decode(new EncodedVideoChunk({ type: p.key ? "key" : "delta", timestamp: performance.now() * 1000, data: p.data }));
      }
    };

    void (async () => {
      const exe = await adb();
      if (stopped) return;
      started = true;
      // No time limit (Android 11 and later take 0). 32 Mbit/s keeps a moving picture clean at full
      // resolution and is well within USB 2.
      const r = await procStreamBytes(id, exe, ["-s", serial, "exec-out", "screenrecord", "--output-format=h264", "--time-limit", "0", "--bit-rate", String(rate), "-"], (chunk) => {
        // An empty chunk is Deck saying the phone has gone quiet, so the picture held back is whole.
        // A timer here decoded pictures before their last chunk had arrived, and the picture stayed
        // corrupted until the next key frame.
        decode(chunk.length ? split.push(chunk) : split.flush());
      }).catch((e: unknown) => { console.warn("[android] the screen stream failed", e); return null; });
      if (!stopped) setEnded(r ? "The phone stopped sending its screen." : "The screen could not be started.");
    })();

    return () => {
      stopped = true;
      if (decoder && decoder.state !== "closed") decoder.close();
      if (!started) return;
      void procKill(id).catch(() => { /* already ended */ });
      // Killing adb on this PC leaves screenrecord running on the phone, so it is stopped there too.
      void shell(serial, `pkill -2 -f 'bit-rate ${rate} -'`).catch(() => { /* phone gone */ });
    };
  }, [serial, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- input ----
  const send = (command: string) => void shell(serial, command).catch((e: unknown) => console.warn("[android] input failed", command, e));
  const at = (ev: { clientX: number; clientY: number }) => {
    const c = canvas.current!, r = c.getBoundingClientRect();
    return { x: Math.round(((ev.clientX - r.left) / r.width) * c.width), y: Math.round(((ev.clientY - r.top) / r.height) * c.height) };
  };
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const typed = useRef({ text: "", timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const wheel = useRef({ dy: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined, x: 0, y: 0 });

  const onDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    press.current = { ...at(ev), t: performance.now() };
  };
  const onUp = (ev: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    const q = at(ev), held = performance.now() - p.t;
    const moved = Math.hypot(q.x - p.x, q.y - p.y) > 12;
    if (!moved && held < 450) send(`input tap ${p.x} ${p.y}`);
    // A press held in place is a long press: a swipe that goes nowhere, for as long as it was held.
    else send(`input swipe ${p.x} ${p.y} ${q.x} ${q.y} ${Math.round(Math.min(Math.max(held, 80), 3000))}`);
  };
  const onWheel = (ev: React.WheelEvent) => {
    // A burst of wheel steps becomes one swipe, from the point the wheel was turned over.
    const w = wheel.current, p = at(ev);
    if (!w.timer) { w.x = p.x; w.y = p.y; }
    w.dy += ev.deltaY;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      const c = canvas.current!;
      const dy = Math.max(-c.height * 0.6, Math.min(c.height * 0.6, -w.dy * 1.5));
      w.timer = undefined; w.dy = 0;
      send(`input swipe ${w.x} ${w.y} ${w.x} ${Math.round(Math.max(1, Math.min(c.height - 1, w.y + dy)))} 120`);
    }, 80);
  };
  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const t = typed.current;
    if (KEYS[ev.key] !== undefined) {
      ev.preventDefault();
      if (t.text) { clearTimeout(t.timer); send(`input text ${forInputText(t.text)}`); t.text = ""; }
      send(`input keyevent ${KEYS[ev.key]}`);
    } else if (ev.key.length === 1) {
      // Typed text is sent a word at a time rather than a key at a time: each send is an adb run.
      ev.preventDefault();
      t.text += ev.key;
      clearTimeout(t.timer);
      t.timer = setTimeout(() => { const s = t.text; t.text = ""; if (s) send(`input text ${forInputText(s)}`); }, 150);
    }
  };

  return (
    <div ref={box} className="relative grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden">
      <canvas ref={canvas} tabIndex={0} title="Click to tap, drag to swipe; with it focused, typing types on the phone"
        onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { press.current = null; }} onWheel={onWheel} onKeyDown={onKey}
        className="cursor-pointer bg-black outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        style={fit ? { width: fit.w, height: fit.h, touchAction: "none" } : { height: "100%", aspectRatio: "9 / 19.5" }} />
      {ended && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2 rounded-lg bg-elev px-4 py-3 text-[12.5px] text-text-secondary">
            <span>{ended}</span>
            <button className="text-[var(--accent)] hover:underline" onClick={() => setAttempt((n) => n + 1)}>Start again</button>
          </div>
        </div>
      )}
    </div>
  );
}
