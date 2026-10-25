// An H.264 byte stream (Annex B, as `screenrecord --output-format=h264` writes it) cut into the
// pictures WebCodecs decodes one at a time.
//
// The stream arrives in chunks of any size, so a NAL unit can straddle two of them: what follows
// the last start code is held until the next start code shows where it ends. Each picture is sent
// as soon as its slice arrives, with the parameter sets before it, rather than when the next one
// starts: screenrecord only sends a picture when the screen changes, so waiting for the next one
// would hold the last change back for as long as the screen stays still.
//
// ponytail: one slice per picture, which is what Android's encoders write for screenrecord. A
// picture in several slices would reach the decoder as several chunks and fail to decode; joining
// them needs first_mb_in_slice, and a stream that has them has not been seen yet.

export interface Picture {
  /** The picture's NAL units, each after a 4-byte start code: Annex B, as the decoder takes it. */
  data: Uint8Array;
  /** An IDR picture, which the decoder can start from. */
  key: boolean;
}

/** The NAL unit's type: 7 a sequence parameter set, 8 a picture parameter set, 5 an IDR slice, 1 another slice. */
export const nalType = (nal: Uint8Array) => nal[0] & 0x1f;

/** WebCodecs' name for the stream's codec, from its sequence parameter set: profile, constraints, level. */
export const codecOf = (sps: Uint8Array) =>
  "avc1." + [sps[1], sps[2], sps[3]].map((b) => b.toString(16).padStart(2, "0")).join("");

const START = new Uint8Array([0, 0, 0, 1]);

/** Cuts a byte stream into pictures; `push` each chunk as it comes, and it returns what is complete. */
export class Splitter {
  private held = new Uint8Array(0);
  private prefix: Uint8Array[] = [];
  /** The latest sequence parameter set, which names the codec. */
  sps: Uint8Array | null = null;

  push(chunk: Uint8Array): Picture[] {
    const buf = new Uint8Array(this.held.length + chunk.length);
    buf.set(this.held);
    buf.set(chunk, this.held.length);
    const out: Picture[] = [];
    // Where each NAL unit starts (just past its start code).
    const starts: number[] = [];
    for (let i = 0; i + 2 < buf.length; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) { starts.push(i + 3); i += 2; }
    }
    if (!starts.length) { this.held = buf; return out; }
    for (let k = 0; k + 1 < starts.length; k++) {
      // The next start code is 3 or 4 bytes; a 4-byte one leaves a zero at the end of this unit.
      let end = starts[k + 1] - 3;
      if (end > starts[k] && buf[end - 1] === 0) end--;
      this.take(buf.subarray(starts[k], end), out);
    }
    // The last unit may not be whole yet: kept, with its start code, for the next chunk.
    this.held = buf.slice(starts[starts.length - 1] - 3);
    return out;
  }

  /**
   * The unit held back, as complete: call when the stream has gone quiet. A picture's slice is the
   * last thing written for it, and it is held until a start code shows where it ends, which for
   * the last change before the screen goes still would be never.
   */
  flush(): Picture[] {
    const out: Picture[] = [];
    const b = this.held;
    const skip = b[0] === 0 && b[1] === 0 && b[2] === 1 ? 3 : b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 1 ? 4 : -1;
    if (skip > 0) { this.take(b.subarray(skip), out); this.held = new Uint8Array(0); }
    return out;
  }

  private take(nal: Uint8Array, out: Picture[]) {
    if (!nal.length) return;
    const t = nalType(nal);
    if (t === 7) this.sps = nal.slice();
    if (t !== 1 && t !== 5) { this.prefix.push(nal.slice()); return; }
    const parts = [...this.prefix, nal];
    this.prefix = [];
    const data = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
    let at = 0;
    for (const p of parts) { data.set(START, at); data.set(p, at + 4); at += 4 + p.length; }
    out.push({ data, key: t === 5 });
  }
}
