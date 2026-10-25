// A device's log, kept while Deck runs rather than while the tab is shown: only the tab in view is
// mounted, and a log that started again from nothing on every tab switch would lose what it was
// for. One `adb logcat` per device, its lines in a capped buffer; stopped by the plugin's dispose.
import { useSyncExternalStore } from "react";
import { listen } from "deck-plugin-sdk/event";
import { procKill, procStream, type ProcLine } from "deck-plugin-sdk/bridge";
import { adb } from "./adb";
import { parseLine, type LogLine } from "./parse";

export type { LogLine };



/** The most lines kept per device; older ones go first. */
const CAP = 20_000;

interface Log { lines: LogLine[]; version: number; error: string }
const logs = new Map<string, Log>();
const ids = new Map<string, string>();
const subs = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
let lines = 0;

// One listener for every log, handing each line to its device by stream id.
const owner = new Map<string, string>();
const unlisten = listen<ProcLine>("proc-line", (e: { payload: ProcLine }) => {
  const serial = owner.get(e.payload.id);
  const log = serial ? logs.get(serial) : undefined;
  if (!log || e.payload.stream !== "stdout") return;
  const l = parseLine(e.payload.line);
  if (!l) return;
  log.lines.push({ ...l, n: ++lines });
  if (log.lines.length > CAP) log.lines.splice(0, log.lines.length - CAP);
  log.version++;
  // A busy log prints hundreds of lines a second: the view is told at most ten times a second.
  pending ??= setTimeout(() => { pending = undefined; subs.forEach((f) => f()); }, 100);
});

/** Start reading a device's log, if it is not being read already. */
export function startLog(serial: string) {
  if (ids.has(serial)) return;
  const id = `android:logcat:${++seq}`;
  ids.set(serial, id);
  owner.set(id, serial);
  const log: Log = logs.get(serial) ?? { lines: [], version: 0, error: "" };
  log.error = "";
  logs.set(serial, log);
  void adb().then((exe) => procStream(id, exe, ["-s", serial, "logcat", "-v", "threadtime", "-T", "500"]))
    .then((r: { cancelled: boolean; code: number }) => { if (!r.cancelled) log.error = `logcat ended (${r.code})`; })
    .catch((e: unknown) => { console.warn("[android] logcat failed", e); log.error = String(e); })
    .finally(() => { if (ids.get(serial) === id) ids.delete(serial); owner.delete(id); log.version++; subs.forEach((f) => f()); });
}

export function clearLog(serial: string) {
  const log = logs.get(serial);
  if (!log) return;
  log.lines = [];
  log.version++;
  subs.forEach((f) => f());
}

const EMPTY: Log = { lines: [], version: 0, error: "" };
/** A device's log, re-rendered when lines arrive (at most ten times a second). */
export function useLog(serial: string): Log {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => logs.get(serial)?.version ?? 0);
  return logs.get(serial) ?? EMPTY;
}

/** Stops every log and the listener: the plugin's dispose. */
export function stopLogs() {
  clearTimeout(pending);
  void unlisten.then((f: () => void) => f());
  for (const id of ids.values()) void procKill(id).catch(() => { /* already ended */ });
  ids.clear();
  owner.clear();
}
