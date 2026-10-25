// The phone's screen, live: scrcpy's server sends the phone's H.264 (scrcpy.ts), WebCodecs
// decodes it on the GPU, and a canvas shows it. Pointer, wheel and keys go back over scrcpy's
// control socket as real touch, scroll, key and text events: a drag is a finger moving, not a
// swipe sent afterwards.
import { useEffect, useRef, useState } from "react";
import { codecOf, Splitter, type Picture } from "./h264";
import { Action, keyMsg, scrollMsg, textMsg, touchMsg } from "./scrcpy-msg";
import { startSession, type Session } from "./scrcpy";

/** Keys sent as Android key events rather than typed. */
const KEYS: Record<string, number> = {
  Enter: 66, Backspace: 67, Delete: 112, Tab: 61, Escape: 4,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22, Home: 122, End: 123, PageUp: 92, PageDown: 93,
};

export function Screen({ serial, onStatus, onShape }: { serial: string; onStatus: (s: string) => void; onShape?: (widthOverHeight: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<Session | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const [ended, setEnded] = useState("");
  const [starting, setStarting] = useState(true);
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
    const split = new Splitter();
    let decoder: VideoDecoder | null = null, configured = "";
    let stopped = false;
    let frames = 0, last = performance.now();
    setEnded("");
    setStarting(true);

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
        // A new sequence parameter set (the phone turned, so the picture's size changed) starts
        // the decoder again from that key frame.
        const sps = split.sps ? [...split.sps].join(",") : "";
        if (p.key && split.sps && sps !== configured) {
          if (decoder && decoder.state !== "closed") decoder.close();
          decoder = new VideoDecoder({ output: show, error: (e) => { console.warn("[android] the screen could not be decoded", e); setEnded(String(e.message ?? e)); } });
          // No `description`: the decoder then takes Annex B, start codes and all, as the server sends it.
          decoder.configure({ codec: codecOf(split.sps), optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" });
          configured = sps;
        }
        // A picture before the first key frame has nothing to be decoded from.
        if (!decoder || decoder.state !== "configured") continue;
        decoder.decode(new EncodedVideoChunk({ type: p.key ? "key" : "delta", timestamp: performance.now() * 1000, data: p.data }));
      }
    };

    startSession(serial, (chunk) => {
      // An empty chunk is Deck saying the phone has gone quiet, so the picture held back is whole.
      decode(chunk.length ? split.push(chunk) : split.flush());
    }, (line) => console.warn("[android]", line)).then((s) => {
      if (stopped) { s.stop(); return; }
      session.current = s;
      setStarting(false);
      void s.ended.then(() => { if (!stopped) setEnded("The phone stopped sending its screen."); });
    }, (e: unknown) => {
      console.warn("[android] the screen could not be started", e);
      if (!stopped) { setStarting(false); setEnded(String(e).replace(/^Error: /, "")); }
    });

    return () => {
      stopped = true;
      session.current?.stop();
      session.current = null;
      if (decoder && decoder.state !== "closed") decoder.close();
    };
  }, [serial, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- input, over scrcpy's control socket ----
  const send = (msg: Uint8Array) => session.current?.send(msg);
  const at = (ev: { clientX: number; clientY: number }) => {
    const c = canvas.current!, r = c.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(c.width - 1, ((ev.clientX - r.left) / r.width) * c.width)),
      y: Math.max(0, Math.min(c.height - 1, ((ev.clientY - r.top) / r.height) * c.height)),
      w: c.width, h: c.height,
    };
  };
  const down = useRef(false);
  const moveQueued = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const onDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    down.current = true;
    const p = at(ev);
    send(touchMsg(Action.Down, p.x, p.y, p.w, p.h));
  };
  const onMove = (ev: React.PointerEvent) => {
    if (!down.current) return;
    // At most one move a frame: the pointer reports far more often than the phone needs.
    const pending = moveQueued.current;
    moveQueued.current = at(ev);
    if (pending) return;
    requestAnimationFrame(() => {
      const p = moveQueued.current;
      moveQueued.current = null;
      if (p && down.current) send(touchMsg(Action.Move, p.x, p.y, p.w, p.h));
    });
  };
  const onUp = (ev: React.PointerEvent) => {
    if (!down.current) return;
    down.current = false;
    moveQueued.current = null;
    const p = at(ev);
    send(touchMsg(Action.Up, p.x, p.y, p.w, p.h));
  };
  const onWheel = (ev: React.WheelEvent) => {
    const p = at(ev);
    // A mouse wheel's notch is 100 here, and one step for the phone.
    send(scrollMsg(p.x, p.y, p.w, p.h, -ev.deltaX / 100, -ev.deltaY / 100));
  };
  const onKey = (ev: React.KeyboardEvent, action: 0 | 1) => {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (KEYS[ev.key] !== undefined) {
      ev.preventDefault();
      send(keyMsg(action, KEYS[ev.key]));
    } else if (ev.key.length === 1 && action === Action.Down) {
      ev.preventDefault();
      send(textMsg(ev.key));
    }
  };

  return (
    <div ref={box} className="relative grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden">
      <canvas ref={canvas} tabIndex={0} title="Touch it with the mouse; with it focused, typing types on the phone"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
        onKeyDown={(e) => onKey(e, Action.Down)} onKeyUp={(e) => onKey(e, Action.Up)}
        className="cursor-pointer bg-black outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        style={fit ? { width: fit.w, height: fit.h, touchAction: "none" } : { height: "100%", aspectRatio: "9 / 19.5" }} />
      {(ended || starting) && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2 rounded-lg bg-elev px-4 py-3 text-[12.5px] text-text-secondary">
            <span>{ended || "Starting the screen…"}</span>
            {ended && <button className="text-[var(--accent)] hover:underline" onClick={() => setAttempt((n) => n + 1)}>Start again</button>}
          </div>
        </div>
      )}
    </div>
  );
}
