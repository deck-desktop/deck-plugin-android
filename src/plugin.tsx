// Android: a connected phone's screen, live and clickable, its log, and screenshots, screen
// recordings and app installs, all over adb.
import { useEffect, useReducer, useState } from "react";
import { ArrowLeft, Camera, Circle, Download, House, Power, Smartphone, Square, SquareStack, Volume1, Volume2 } from "lucide-react";
import { configRead, configWrite } from "deck-plugin-sdk/bridge";
import { EmptyState, IconButton, Select } from "deck-plugin-sdk/ui";
import { devices, shell, type Device } from "./adb";
import { installApk, isRecording, screenshot, startRecording, stopRecording } from "./actions";
import { Logcat } from "./Logcat";
import { stopLogs } from "./logstore";
import { Screen } from "./Screen";

/** Before a reload imports the plugin again (Deck's rule 13): the logs run at module scope. */
export function dispose() { stopLogs(); }

/** Devices, read again every few seconds while the tab is shown (a phone plugged in or out). */
function useDevices(): Device[] | null {
  const [list, setList] = useState<Device[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      if (document.hidden) return;
      devices().then(
        (d) => { if (live) setList((prev) => (JSON.stringify(prev) === JSON.stringify(d) ? prev : d)); },
        (e: unknown) => { console.warn("[android] adb devices failed", e); if (live) setList((prev) => (prev?.length === 0 ? prev : [])); },
      );
    };
    read();
    const t = setInterval(read, 3000);
    const vis = () => { if (!document.hidden) read(); };
    document.addEventListener("visibilitychange", vis);
    return () => { live = false; clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return list;
}

/** What is shown beside the screen: its controls and the log. Each can go, to see only the screen. */
type View = { controls: boolean; log: boolean };
const SHOWN: View = { controls: true, log: true };
let lastView = "";
function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(SHOWN);
  useEffect(() => {
    configRead("view").then((t: string) => { lastView = t.trim(); if (lastView) setView({ ...SHOWN, ...JSON.parse(lastView) }); })
      .catch((e: unknown) => console.warn("[android] the view could not be read", e));
  }, []);
  const set = (v: View) => {
    setView(v);
    const text = JSON.stringify(v);
    if (text === lastView) return;
    lastView = text;
    configWrite("view", text).catch((e: unknown) => console.warn("[android] the view could not be saved", e));
  };
  return [view, set];
}

/** A part of the view, on or off: its name, lit while it is shown. */
function Switch({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} title={(on ? "Hide the " : "Show the ") + label.toLowerCase()}
      className={"h-7 rounded-md px-2.5 text-[12px] transition-colors " + (on ? "bg-[var(--accent-soft)] text-text-primary" : "text-text-muted hover:bg-white/5 hover:text-text-secondary")}>
      {label}
    </button>
  );
}

export default function Android() {
  const list = useDevices();
  const ready = (list ?? []).filter((d) => d.state === "device");
  const [pick, setPick] = useState("");
  const serial = ready.find((d) => d.serial === pick)?.serial ?? ready[0]?.serial ?? "";
  const [status, setStatus] = useState("");
  const [, changed] = useReducer((n: number) => n + 1, 0);
  const [view, setView] = useView();

  if (list && !ready.length) {
    const waiting = list.find((d) => d.state === "unauthorized");
    return (
      <EmptyState icon={<Smartphone size={18} />} title="No phone">
        {waiting ? "Allow USB debugging on the phone: it is asking whether to trust this PC." : "Plug in a phone with USB debugging on, in Developer options."}
      </EmptyState>
    );
  }
  const key = (code: number) => () => void shell(serial, `input keyevent ${code}`).catch((e: unknown) => console.warn("[android] key failed", e));
  const recording = serial ? isRecording(serial) : false;
  return (
    // Only the screen: no padding, no row, the screen as large as the pane allows.
    <div className={"group relative flex h-full min-h-0 flex-col " + (view.controls || view.log ? "gap-2 p-3" : "")}>
      {/* The two switches for what is shown sit in one place whatever is shown: the top right,
          at the end of the controls' row, or over the screen's corner when that row is hidden
          (seen while the pointer is over the tab). */}
      <div className={"absolute right-3 top-3 z-10 flex h-8 items-center gap-1 transition-opacity "
        + (view.controls ? "" : "rounded-lg bg-[var(--bg-elev)] px-0.5 opacity-0 shadow group-hover:opacity-100")}>
        <Switch label="Controls" on={view.controls} onClick={() => setView({ ...view, controls: !view.controls })} />
        <Switch label="Log" on={view.log} onClick={() => setView({ ...view, log: !view.log })} />
      </div>
      {view.controls && <header className="flex h-8 shrink-0 items-center gap-1">
        <>
        <Select value={serial} onChange={(e) => setPick(e.target.value)} className="mr-1 w-52">
          {ready.map((d) => <option key={d.serial} value={d.serial}>{d.model || d.serial}</option>)}
        </Select>
        <IconButton title="Back" onClick={key(4)}><ArrowLeft size={14} /></IconButton>
        <IconButton title="Home" onClick={key(3)}><House size={14} /></IconButton>
        <IconButton title="Recent apps" onClick={key(187)}><SquareStack size={14} /></IconButton>
        <span className="mx-1 h-4 w-px bg-[var(--border-subtle,#30363d)]" />
        <IconButton title="Volume down" onClick={key(25)}><Volume1 size={14} /></IconButton>
        <IconButton title="Volume up" onClick={key(24)}><Volume2 size={14} /></IconButton>
        <IconButton title="Power (screen off or on)" onClick={key(26)}><Power size={14} /></IconButton>
        <span className="mx-1 h-4 w-px bg-[var(--border-subtle,#30363d)]" />
        <IconButton title="Screenshot" onClick={() => void screenshot(serial)}><Camera size={14} /></IconButton>
        <IconButton title={recording ? "Stop recording" : "Record the screen"} active={recording}
          onClick={() => void (recording ? stopRecording(serial, changed) : startRecording(serial, changed))}>
          {recording ? <Square size={13} className="text-[#f85149]" /> : <Circle size={14} />}
        </IconButton>
        <IconButton title="Install an APK…" onClick={() => void installApk(serial)}><Download size={14} /></IconButton>
        <span className="ml-2 text-[12px] tabular-nums text-text-muted">{status}</span>
        </>
        {/* Room for the switches, which are drawn over this end of the row. */}
        <span className="w-36 shrink-0" />
      </header>}
      {serial && (
        <div className="flex min-h-0 flex-1 gap-3">
          <div className={"flex min-h-0 flex-col " + (view.log ? "w-[38%] min-w-[220px] max-w-[520px]" : "flex-1")}>
            <Screen key={serial} serial={serial} onStatus={setStatus} />
          </div>
          {view.log && <Logcat serial={serial} />}
        </div>
      )}
    </div>
  );
}
