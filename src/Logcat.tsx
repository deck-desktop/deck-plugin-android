// The device's log, filtered: the lowest level shown, one app (by its package, followed across
// restarts by its process ids), and a search. It keeps to the bottom while new lines arrive, unless
// you have scrolled up to read.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { IconButton, Segmented, TextInput } from "deck-plugin-sdk/ui";
import { shell } from "./adb";
import { clearLog, startLog, useLog, type LogLine } from "./logstore";

const LEVELS = ["V", "D", "I", "W", "E"] as const;
const RANK: Record<LogLine["level"], number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };
const COLOR: Record<LogLine["level"], string> = {
  V: "var(--text-muted)", D: "var(--text-secondary)", I: "var(--text-primary)", W: "#e3b341", E: "#f85149", F: "#f85149",
};
/** The most lines drawn; the rest stay in the buffer and come back with a narrower filter. */
const SHOWN = 2000;

const Row = memo(function Row({ l }: { l: LogLine }) {
  return (
    <div className="flex gap-2 whitespace-pre-wrap break-all px-2 font-mono text-[11.5px] leading-[17px]" style={{ color: COLOR[l.level] }}>
      <span className="shrink-0 text-text-muted">{l.time.slice(6)}</span>
      <span className="w-3 shrink-0">{l.level}</span>
      <span className="w-40 shrink-0 truncate text-text-secondary" title={l.tag}>{l.tag}</span>
      <span className="min-w-0 flex-1">{l.msg}</span>
    </div>
  );
});

/** The process ids of `pkg`, read again every few seconds: an app restarted gets a new one. */
function usePids(serial: string, pkg: string): Set<number> | null {
  const [pids, setPids] = useState<Set<number> | null>(null);
  useEffect(() => {
    setPids(null);
    if (!pkg.trim()) return;
    let live = true;
    const read = () => {
      if (document.hidden) return;
      shell(serial, `pidof ${pkg.trim().replace(/[^\w.]/g, "")}`).then(
        (out) => { if (live) { const s = new Set(out.trim().split(/\s+/).filter(Boolean).map(Number)); setPids((p) => (p && p.size === s.size && [...s].every((x) => p.has(x)) ? p : s)); } },
        // pidof answers nothing, and exits 1, while the app is not running.
        () => { if (live) setPids((p) => (p?.size === 0 ? p : new Set())); },
      );
    };
    read();
    const t = setInterval(read, 3000);
    return () => { live = false; clearInterval(t); };
  }, [serial, pkg]);
  return pids;
}

export function Logcat({ serial }: { serial: string }) {
  useEffect(() => startLog(serial), [serial]);
  const log = useLog(serial);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("I");
  const [pkg, setPkg] = useState("");
  const [query, setQuery] = useState("");
  const pids = usePids(serial, pkg);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase(), min = RANK[level];
    const out: LogLine[] = [];
    for (let i = log.lines.length - 1; i >= 0 && out.length < SHOWN; i--) {
      const l = log.lines[i];
      if (RANK[l.level] < min) continue;
      if (pids && !pids.has(l.pid)) continue;
      if (q && !l.msg.toLowerCase().includes(q) && !l.tag.toLowerCase().includes(q)) continue;
      out.push(l);
    }
    return out.reverse();
  }, [log.version, log.lines, level, pids, query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Held at the bottom while it is there; scrolling up to read stops that until you scroll back.
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useLayoutEffect(() => { const s = scroller.current; if (s && atEnd.current) s.scrollTop = s.scrollHeight; }, [shown]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-subtle">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-2 py-1.5">
        <Segmented value={level} onChange={setLevel} layoutId="android-level" options={LEVELS.map((l) => ({ value: l, label: l }))} />
        <TextInput value={pkg} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPkg(e.target.value)} placeholder="App, e.g. com.example.app" className="w-56" />
        <TextInput value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} placeholder="Search" className="w-40" />
        <span className="text-[11.5px] text-text-muted">
          {pkg.trim() && pids?.size === 0 ? "not running" : log.error || `${shown.length.toLocaleString()} lines`}
        </span>
        <span className="flex-1" />
        <IconButton title="Clear the log" onClick={() => clearLog(serial)}><Eraser size={14} /></IconButton>
      </div>
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1"
        onScroll={(e) => { const s = e.currentTarget; atEnd.current = s.scrollHeight - s.scrollTop - s.clientHeight < 24; }}>
        {shown.map((l) => <Row key={l.n} l={l} />)}
      </div>
    </div>
  );
}
