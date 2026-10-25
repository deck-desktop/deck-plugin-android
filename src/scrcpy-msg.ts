// scrcpy's control messages, byte for byte as its client writes them (app/src/control_msg.c in
// scrcpy 5.0.1): big-endian, a type byte first. Pure, so the check can hold them to the layout.

export const Action = { Down: 0, Up: 1, Move: 2 } as const;
export type Action = (typeof Action)[keyof typeof Action];

/** The pointer id scrcpy gives a finger that is not the mouse (SC_POINTER_ID_GENERIC_FINGER, -2). */
const FINGER = 0xffff_ffff_ffff_fffen;

/** A key going down or up: type 0, action, keycode, repeat, meta state. 14 bytes. */
export function keyMsg(action: 0 | 1, keycode: number): Uint8Array {
  const b = new Uint8Array(14), v = new DataView(b.buffer);
  b[0] = 0; b[1] = action;
  v.setUint32(2, keycode); v.setUint32(6, 0); v.setUint32(10, 0);
  return b;
}

/** Text typed as it is: type 1, a 4-byte length, UTF-8. scrcpy takes at most 300 bytes at once. */
export function textMsg(text: string): Uint8Array {
  const t = new TextEncoder().encode(text).subarray(0, 300);
  const b = new Uint8Array(5 + t.length);
  new DataView(b.buffer).setUint32(1, t.length);
  b[0] = 1; b.set(t, 5);
  return b;
}

/** Where on a screen of w×h (the video's size, which the phone checks it against). */
function position(v: DataView, at: number, x: number, y: number, w: number, h: number) {
  v.setInt32(at, Math.round(x)); v.setInt32(at + 4, Math.round(y));
  v.setUint16(at + 8, w); v.setUint16(at + 10, h);
}

/** A finger down, moving or up: type 2, action, pointer id, position, pressure, buttons. 32 bytes. */
export function touchMsg(action: Action, x: number, y: number, w: number, h: number): Uint8Array {
  const b = new Uint8Array(32), v = new DataView(b.buffer);
  b[0] = 2; b[1] = action;
  v.setBigUint64(2, FINGER);
  position(v, 10, x, y, w, h);
  // Pressure as a 16-bit fraction: full while the finger is down, none as it lifts.
  v.setUint16(22, action === Action.Up ? 0 : 0xffff);
  v.setUint32(24, 0); v.setUint32(28, 0);
  return b;
}

/** A 16-bit signed fraction of [-1, 1], as scrcpy's sc_float_to_i16fp. */
const i16fp = (f: number) => Math.max(-0x8000, Math.min(0x7fff, Math.round(Math.max(-1, Math.min(1, f)) * 0x8000)));

/** A scroll at a point, in wheel steps (-16 to 16, as scrcpy takes them): type 3. 21 bytes. */
export function scrollMsg(x: number, y: number, w: number, h: number, hsteps: number, vsteps: number): Uint8Array {
  const b = new Uint8Array(21), v = new DataView(b.buffer);
  b[0] = 3;
  position(v, 1, x, y, w, h);
  v.setInt16(13, i16fp(hsteps / 16)); v.setInt16(15, i16fp(vsteps / 16));
  v.setUint32(17, 0);
  return b;
}

/** Back, or the screen on when it is off: type 4, action. 2 bytes. */
export const backOrScreenOnMsg = (action: 0 | 1) => Uint8Array.of(4, action);
