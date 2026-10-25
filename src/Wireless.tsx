// Connecting a phone over Wi-Fi, with nothing to type but a pairing code. While this is shown it
// looks for phones with Wireless debugging on (adb's mDNS): a phone paired before is connected to
// as soon as it appears, and one showing a pairing code is offered with its address filled in.
import { useEffect, useRef, useState } from "react";
import { Wifi } from "lucide-react";
import { connectWireless, pairWireless, wireless } from "./adb";
import type { Service } from "./parse";

/** The serial part of a service name ("adb-R5CY207JF2V-AbCdEf"), which a phone's two services share. */
const phoneOf = (name: string) => name.replace(/^adb-/, "").replace(/-[^-]*$/, "");

export function Wireless() {
  const [found, setFound] = useState<Service[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // Each address is tried once a minute at most: a phone that refuses should not be asked every poll.
  const tried = useRef(new Map<string, number>());

  useEffect(() => {
    let live = true;
    const look = () => {
      if (document.hidden) return;
      wireless().then((list) => {
        if (!live) return;
        setFound((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
        for (const s of list.filter((x) => x.kind === "connect")) {
          const at = tried.current.get(s.address) ?? 0;
          if (Date.now() - at < 60_000) continue;
          tried.current.set(s.address, Date.now());
          // Once connected, the device list (polled by the tab) finds it and this screen goes.
          connectWireless(s.address).catch((e: unknown) => { if (live) setError(String(e).replace(/^Error: /, "")); });
        }
      }, (e: unknown) => console.warn("[android] looking for wireless phones failed", e));
    };
    look();
    const t = setInterval(look, 2000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const pairing = found.find((s) => s.kind === "pair");
  const pair = () => {
    if (!pairing || code.trim().length !== 6) return;
    setBusy("pairing");
    setError("");
    pairWireless(pairing.address, code.trim()).then(() => {
      setCode("");
      // Paired: its connect service appears on the next look and is connected to then.
      tried.current.clear();
    }, (e: unknown) => setError(String(e).replace(/^Error: /, ""))).finally(() => setBusy(""));
  };
  const connecting = found.filter((s) => s.kind === "connect").map((s) => phoneOf(s.name));

  return (
    <div className="flex max-w-[34ch] flex-col gap-2 text-[12.5px] text-text-secondary">
      <div className="flex items-center gap-2 text-text-primary"><Wifi size={14} /> Over Wi-Fi</div>
      {connecting.length > 0 ? (
        <span>Connecting to {connecting.join(", ")}…</span>
      ) : pairing ? (
        <>
          <span>Type the 6-digit code the phone shows for {phoneOf(pairing.name)}:</span>
          <div className="flex gap-1.5">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter") pair(); }}
              inputMode="numeric" placeholder="123456" autoFocus
              className="h-7 w-24 rounded-md border border-subtle bg-elev px-2 font-mono text-[13px] tracking-widest text-text-primary outline-none focus:border-[var(--accent)]" />
            <button onClick={pair} disabled={code.length !== 6 || !!busy}
              className="h-7 rounded-md bg-[var(--accent)] px-3 text-[12px] text-white disabled:opacity-40">{busy ? "Pairing…" : "Pair"}</button>
          </div>
        </>
      ) : (
        <span>
          On the phone, on the same Wi-Fi as this PC: Settings › Developer options › Wireless debugging,
          turn it on. A phone paired before connects by itself; for a new one, tap Pair device with
          pairing code there, and the code goes here.
        </span>
      )}
      {error && <span className="text-[#f85149]">{error}</span>}
    </div>
  );
}
