// The device's log, filtered: the lowest level shown, one app (by its package, followed across
// restarts by its process ids), and a search. It keeps to the bottom while new lines arrive, unless
// you have scrolled up to read.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Eraser, Filter } from "lucide-react";
import { IconButton } from "deck-plugin-sdk/ui";
import { shell } from "./adb";
import { clearLog, startLog, useLog, type LogLine } from "./logstore";

const LEVELS = ["V", "D", "I", "W", "E"] as const;
const NAMES: Record<(typeof LEVELS)[number], string> = { V: "Verbose", D: "Debug", I: "Info", W: "Warnings", E: "Errors" };
/** A small field, so the row fits a narrow pane. */
const FIELD = "h-6 rounded-md border border-subtle bg-elev px-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-[var(--accent)]";
const RANK: Record<LogLine["level"], number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };
const COLOR: Record<LogLine["level"], string> = {
  V: "var(--text-muted)", D: "var(--text-secondary)", I: "var(--text-primary)", W: "#e3b341", E: "#f85149", F: "#f85149",
};
/** The most lines drawn; the rest stay in the buffer and come back with a narrower filter. */
const SHOWN = 2000;

const Row = memo(function Row({ l }: { l: LogLine }) {
  return (
    // One run of text, as logcat prints it, so a long message wraps under the whole width rather
    // than down a column beside the time and tag, which in a narrow pane left it a few letters wide.
    <div className="whitespace-pre-wrap break-words px-2 font-mono text-[11.5px] leading-[17px]" style={{ color: COLOR[l.level] }}>
      <span className="text-text-muted">{l.time.slice(6)} </span>
      <span>{l.level} </span>
      <span className="text-text-secondary">{l.tag}: </span>
      {l.msg}
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

/** `roomForSwitches`: the tab's Controls and Log switches are drawn over the end of the filter row. */
export function Logcat({ serial, roomForSwitches }: { serial: string; roomForSwitches?: boolean }) {
  useEffect(() => startLog(serial), [serial]);
  const log = useLog(serial);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("I");
  const [pkg, setPkg] = useState("");
  const [query, setQuery] = useState("");
  const [appOpen, setAppOpen] = useState(false);
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
      {/* One row at any width: the level, a search that takes what room there is, the app filter
          behind its button (open while it has an app), the count and Clear. */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-subtle px-1.5">
        <div className="flex shrink-0 rounded-md bg-elev p-0.5" role="radiogroup" aria-label="Lowest level shown">
          {LEVELS.map((l) => (
            <button key={l} role="radio" aria-checked={level === l} onClick={() => setLevel(l)} title={`${NAMES[l]} and above`}
              className={"h-6 w-6 rounded text-[11px] font-medium " + (level === l ? "bg-[var(--accent-soft)] text-text-primary" : "text-text-muted hover:text-text-secondary")}>
              {l}
            </button>
          ))}
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" spellCheck={false}
          className={FIELD + " min-w-12 flex-1"} />
        {appOpen || pkg ? (
          <input autoFocus={appOpen && !pkg} value={pkg} onChange={(e) => setPkg(e.target.value)} onBlur={() => setAppOpen(false)}
            placeholder="com.example.app" spellCheck={false} title="Only this app's lines" className={FIELD + " w-40 min-w-16 shrink"} />
        ) : (
          <IconButton title="Only one app's lines…" onClick={() => setAppOpen(true)}><Filter size={13} /></IconButton>
        )}
        <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-text-muted">
          {pkg.trim() && pids?.size === 0 ? "not running" : log.error || shown.length.toLocaleString()}
        </span>
        <IconButton title="Clear the log" onClick={() => clearLog(serial)}><Eraser size={13} /></IconButton>
        {roomForSwitches && <span className="w-36 shrink-0" />}
      </div>
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1"
        onScroll={(e) => { const s = e.currentTarget; atEnd.current = s.scrollHeight - s.scrollTop - s.clientHeight < 24; }}>
        {shown.map((l) => <Row key={l.n} l={l} />)}
      </div>
    </div>
  );
}
