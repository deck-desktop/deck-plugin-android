// node android.check.mjs
//
// The plugin's logic, in node with no Deck and no phone. Worth the most: the H.264 splitter, which
// must find whole pictures in chunks cut anywhere (a start code split across two of them
// included) and hand out the last one when the stream goes quiet; and the text sent to the phone's
// shell, which runs whatever it is given.
import assert from "node:assert";
import { build } from "esbuild";

const load = async (entry) => {
  const out = await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, platform: "node" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const h = await load("src/h264.ts");
const p = await load("src/parse.ts");
const m = await load("src/scrcpy-msg.ts");

// ---- H.264 -----------------------------------------------------------------------------------
const sc4 = [0, 0, 0, 1], sc3 = [0, 0, 1];
const sps = [0x67, 0x64, 0x00, 0x33, 0xac, 0xb4];
const pps = [0x68, 0xee, 0x3c, 0x80];
const idr = [0x65, 0x88, 0x84, 0x00, 0x21];
const slice = [0x41, 0x9a, 0x22, 0x00];
const stream = Uint8Array.from([...sc4, ...sps, ...sc4, ...pps, ...sc4, ...idr, ...sc3, ...slice, ...sc4, ...slice]);

const all = (chunks) => {
  const s = new h.Splitter();
  const out = chunks.flatMap((c) => s.push(c));
  return { out: [...out, ...s.flush()], s };
};
const want = (out) => {
  assert.equal(out.length, 3, "an IDR picture and two others");
  assert.deepEqual([...out[0].data], [...sc4, ...sps, ...sc4, ...pps, ...sc4, ...idr], "the key picture carries its parameter sets");
  assert.equal(out[0].key, true);
  assert.deepEqual([...out[1].data], [...sc4, ...slice]);
  assert.equal(out[1].key, false);
  assert.deepEqual([...out[2].data], [...sc4, ...slice], "the last picture comes out on flush");
};
// Whole, then cut at every place, then a byte at a time: the same pictures each way.
want(all([stream]).out);
for (let i = 1; i < stream.length; i++) want(all([stream.subarray(0, i), stream.subarray(i)]).out);
want(all([...stream].map((b) => Uint8Array.of(b))).out);
assert.equal(h.codecOf(Uint8Array.from(sps)), "avc1.640033", "High profile, level 5.1, as the S25 sends");
assert.equal(all([stream]).s.sps.length, sps.length);
// The last picture is held until the next start code or a flush: it may not be whole yet.
{
  const s = new h.Splitter();
  assert.equal(s.push(Uint8Array.from([...sc4, ...sps, ...sc4, ...pps, ...sc4, ...idr])).length, 0);
  assert.equal(s.flush().length, 1);
  assert.equal(s.flush().length, 0, "a flush with nothing held gives nothing");
}

// ---- adb's output ----------------------------------------------------------------------------
assert.deepEqual(p.parseDevices("List of devices attached\nR5CY207JF2V            device product:pa3qxxx model:SM_S938B device:pa3q transport_id:5\nemulator-5554 unauthorized\n\n"), [
  { serial: "R5CY207JF2V", state: "device", model: "SM S938B" },
  { serial: "emulator-5554", state: "unauthorized", model: "" },
]);
assert.deepEqual(p.parseDevices("List of devices attached\n\n"), []);

assert.deepEqual(p.parseLine("10-25 13:09:01.123  1234  5678 W ActivityManager: Slow operation: 52ms so far"), {
  time: "10-25 13:09:01.123", pid: 1234, level: "W", tag: "ActivityManager", msg: "Slow operation: 52ms so far",
});
assert.equal(p.parseLine("10-25 13:09:01.123  1234  5678 I flutter : hello: world").msg, "hello: world", "the first ': ' ends the tag");
assert.equal(p.parseLine("--------- beginning of main"), null);

assert.deepEqual(p.parseMdns([
  "List of discovered mdns services",
  "adb-R5CY207JF2V-AbCdEf\t_adb-tls-connect._tcp\t192.168.1.5:37111",
  "adb-R5CY207JF2V-AbCdEf\t_adb-tls-pairing._tcp\t192.168.1.5:41234",
  "something\t_other._tcp\t1.2.3.4:5",
].join("\n")), [
  { name: "adb-R5CY207JF2V-AbCdEf", kind: "connect", address: "192.168.1.5:37111" },
  { name: "adb-R5CY207JF2V-AbCdEf", kind: "pair", address: "192.168.1.5:41234" },
], "phones ready to connect and phones showing a pairing code, nothing else");
assert.deepEqual(p.parseMdns("List of discovered mdns services\n"), []);

// ---- text for the phone's shell --------------------------------------------------------------
assert.equal(p.forInputText("hello world"), "'hello%sworld'");
assert.equal(p.forInputText("it's"), "'it'\\''s'", "a quote cannot end the quoting early");
assert.equal(p.forInputText("$(reboot)"), "'$(reboot)'", "nothing in it runs");

// ---- scrcpy control messages, as scrcpy 5.0.1 serializes them ---------------------------------
const hex = (u) => Buffer.from(u).toString("hex");
assert.equal(hex(m.keyMsg(0, 4)), "00" + "00" + "00000004" + "00000000" + "00000000", "a key: type, action, keycode, repeat, meta");
assert.equal(hex(m.textMsg("hé")), "01" + "00000003" + "68c3a9", "text: type, UTF-8 length, UTF-8");
assert.equal(m.textMsg("x".repeat(400)).length, 5 + 300, "text is cut at 300 bytes");
assert.equal(hex(m.touchMsg(0, 540, 1170.4, 1080, 2340)),
  "02" + "00" + "fffffffffffffffe" + "0000021c" + "00000492" + "0438" + "0924" + "ffff" + "00000000" + "00000000",
  "a finger down: type, action, pointer -2, x, y, width, height, full pressure, no buttons");
assert.equal(m.touchMsg(1, 0, 0, 1080, 2340).length, 32);
assert.equal(hex(m.touchMsg(1, 0, 0, 1080, 2340)).slice(44, 48), "0000", "no pressure as the finger lifts");
assert.equal(hex(m.scrollMsg(10, 20, 1080, 2340, 0, -1)),
  "03" + "0000000a" + "00000014" + "0438" + "0924" + "0000" + "f800" + "00000000", "a scroll of one step down: -1/16 as a 16-bit fraction");
assert.equal(m.scrollMsg(0, 0, 1, 1, 99, -99).subarray(13, 17).join(","), [0x7f, 0xff, 0x80, 0x00].join(","), "steps past 16 are held at the ends");
assert.equal(hex(m.backOrScreenOnMsg(1)), "0401");

console.log("android: all checks passed");
