// Connecting a phone over Wi-Fi. Pair once with the code the phone shows, then connect to the
// address on its Wireless debugging screen; that address is remembered and tried again whenever no
// phone is connected. Where adb's mDNS works (it often does not across a router's Wi-Fi and wired
// sides, or past Windows' firewall), the phone is found and the addresses are filled in for you.
import { useEffect, useRef, useState } from "react";
import { Wifi } from "lucide-react";
import { configRead, configWrite } from "deck-plugin-sdk/bridge";
import { connectWireless, pairWireless, wireless } from "./adb";
import type { Service } from "./parse";

const CONFIG = "wireless";
/** "10.1.1.178:41234", or an IPv6 one in brackets. */
const ADDRESS = /^(\d{1,3}(\.\d{1,3}){3}|\[[\da-f:]+\]):\d{2,5}$/i;
const hostOf = (a: string) => a.replace(/:\d+$/, "");

const FIELD = "h-7 rounded-md border border-subtle bg-elev px-2 font-mono text-[12.5px] text-text-primary outline-none placeholder:font-sans placeholder:text-text-muted focus:border-[var(--accent)]";
const BUTTON = "h-7 shrink-0 rounded-md bg-[var(--accent)] px-3 text-[12px] text-white disabled:opacity-40";

export function Wireless() {
  const [found, setFound] = useState<Service[]>([]);
  const [pairAt, setPairAt] = useState("");
  const [code, setCode] = useState("");
  const [connectAt, setConnectAt] = useState("");
  const [step, setStep] = useState<"pair" | "connect">("pair");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const tried = useRef(new Map<string, number>());

  // The addresses connected to before, and whether the phone was paired already.
  useEffect(() => {
    configRead(CONFIG).then((t: string) => {
      const list = t.trim() ? ((JSON.parse(t) as { addresses?: string[] }).addresses ?? []) : [];
      setSaved(list);
      if (list.length) { setStep("connect"); setConnectAt((a) => a || list[0]); }
    }).catch((e: unknown) => console.warn("[android] the Wi-Fi addresses could not be read", e));
  }, []);
  const remember = (address: string) => {
    const next = [address, ...saved.filter((a) => a !== address)].slice(0, 5);
    if (JSON.stringify(next) === JSON.stringify(saved)) return;
    setSaved(next);
    configWrite(CONFIG, JSON.stringify({ addresses: next })).catch((e: unknown) => console.warn("[android] the Wi-Fi address could not be saved", e));
  };

  // Each address is tried at most once a minute: one that refuses should not be asked every look.
  const attempt = (address: string, quiet: boolean) => {
    if (Date.now() - (tried.current.get(address) ?? 0) < 60_000) return;
    tried.current.set(address, Date.now());
    // Once connected, the tab's device list finds the phone and this screen goes away.
    connectWireless(address).then(() => remember(address), (e: unknown) => { if (!quiet) setError(String(e).replace(/^Error: /, "")); });
  };

  useEffect(() => {
    let live = true;
    const look = () => {
      if (document.hidden) return;
      for (const a of saved) attempt(a, true);
      wireless().then((list) => {
        if (!live) return;
        setFound((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
        for (const s of list.filter((x) => x.kind === "connect")) attempt(s.address, true);
        const p = list.find((x) => x.kind === "pair");
        if (p) setPairAt((a) => a || p.address);
      }, () => { /* mDNS not answering is the common case; the form works without it */ });
    };
    look();
    const t = setInterval(look, 3000);
    return () => { live = false; clearInterval(t); };
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const pair = () => {
    if (!ADDRESS.test(pairAt.trim()) || code.length !== 6) return;
    setBusy("Pairing…"); setError("");
    pairWireless(pairAt.trim(), code).then(() => {
      setCode("");
      setStep("connect");
      // The phone's connect address is on the same host, on a port of its own.
      setConnectAt((a) => a || `${hostOf(pairAt.trim())}:`);
      tried.current.clear();
    }, (e: unknown) => setError(String(e).replace(/^Error: /, ""))).finally(() => setBusy(""));
  };
  const connect = () => {
    const a = connectAt.trim();
    if (!ADDRESS.test(a)) return;
    setBusy("Connecting…"); setError("");
    connectWireless(a).then(() => remember(a), (e: unknown) => setError(String(e).replace(/^Error: /, ""))).finally(() => setBusy(""));
  };
  const connecting = found.some((s) => s.kind === "connect");

  return (
    <div className="flex w-[min(100%,36ch)] flex-col gap-2.5 text-[12.5px] text-text-secondary">
      <div className="flex items-center gap-2 text-text-primary"><Wifi size={14} /> Over Wi-Fi</div>
      <span>On the phone, on the same Wi-Fi as this PC: Settings › Developer options › Wireless debugging, on.</span>

      {step === "pair" ? (
        <>
          <span className="text-text-primary">1. Tap Pair device with pairing code. Type the address and code it shows:</span>
          <input value={pairAt} onChange={(e) => setPairAt(e.target.value.trim())} placeholder="IP address & port, e.g. 10.1.1.178:41234"
            spellCheck={false} className={FIELD} />
          <div className="flex gap-1.5">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter") pair(); }}
              inputMode="numeric" placeholder="Code" className={FIELD + " w-24 tracking-widest"} />
            <button onClick={pair} disabled={!ADDRESS.test(pairAt.trim()) || code.length !== 6 || !!busy} className={BUTTON}>{busy || "Pair"}</button>
          </div>
          <button className="self-start text-[12px] text-[var(--accent)] hover:underline" onClick={() => setStep("connect")}>Paired already? Connect</button>
        </>
      ) : (
        <>
          <span className="text-text-primary">{saved.length ? "Connect to the phone again" : "2. Paired. Now the IP address & port at the top of the Wireless debugging screen:"}</span>
          <div className="flex gap-1.5">
            <input value={connectAt} onChange={(e) => setConnectAt(e.target.value.trim())} onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
              placeholder="e.g. 10.1.1.178:37111" spellCheck={false} className={FIELD + " min-w-0 flex-1"} />
            <button onClick={connect} disabled={!ADDRESS.test(connectAt.trim()) || !!busy} className={BUTTON}>{busy || "Connect"}</button>
          </div>
          {saved.length > 0 && <span className="text-[11.5px] text-text-muted">Tried by itself whenever no phone is connected. The port changes when Wireless debugging is turned off and on: type the new one then.</span>}
          <button className="self-start text-[12px] text-[var(--accent)] hover:underline" onClick={() => setStep("pair")}>Pair a phone</button>
        </>
      )}
      {connecting && <span>Found on the network, connecting…</span>}
      {error && <span className="text-[#f85149]">{error}</span>}
    </div>
  );
}
