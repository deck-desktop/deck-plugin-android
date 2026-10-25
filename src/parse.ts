// What adb prints, read: the device list and log lines, and text made safe for `input text`.
// Pure, so the check can run it with no Deck around.

export interface Device {
  serial: string;
  /** "device" when it can be used; "unauthorized" until the phone's prompt is accepted, "offline". */
  state: string;
  model: string;
}

/** `adb devices -l`, one device per line after the header. */
export function parseDevices(text: string): Device[] {
  return text.split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [serial, state, ...rest] = l.split(/\s+/);
    const model = rest.find((p) => p.startsWith("model:"))?.slice(6).replace(/_/g, " ") ?? "";
    return { serial, state, model };
  });
}

export interface LogLine {
  /** "10-25 13:09:01.123", as logcat prints it. */
  time: string;
  pid: number;
  level: "V" | "D" | "I" | "W" | "E" | "F";
  tag: string;
  msg: string;
  /** Its place in the stream, for a stable key. */
  n: number;
}

/** One `logcat -v threadtime` line: date, time, pid, tid, level, tag and message. Null for anything else. */
export function parseLine(line: string): Omit<LogLine, "n"> | null {
  const m = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+\d+\s+([VDIWEF])\s+(.*?)\s*: (.*)$/.exec(line);
  if (!m) return null;
  return { time: m[1], pid: Number(m[2]), level: m[3] as LogLine["level"], tag: m[4], msg: m[5] };
}

/** `input text` takes no spaces (%s stands for one) and goes through the phone's shell, so it is quoted for it. */
export const forInputText = (s: string) => `'${s.replace(/ /g, "%s").replace(/'/g, "'\\''")}'`;

export interface Service {
  /** "adb-R5CY207JF2V-AbCdEf": the phone's serial is in it, which ties a pairing to its connection. */
  name: string;
  /** "connect" for a phone ready to connect to (already paired), "pair" while its pairing code is on screen. */
  kind: "connect" | "pair";
  /** "192.168.1.5:37111". */
  address: string;
}

/** `adb mdns services`: phones with Wireless debugging on, on this network, one service per line. */
export function parseMdns(text: string): Service[] {
  const out: Service[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [name, type, address] = line.trim().split(/\s+/);
    const kind = type === "_adb-tls-connect._tcp" ? "connect" : type === "_adb-tls-pairing._tcp" ? "pair" : null;
    if (kind && name && /^[\d.]+:\d+$|^\[[\da-f:]+\]:\d+$/i.test(address ?? "")) out.push({ name, kind, address });
  }
  return out;
}
