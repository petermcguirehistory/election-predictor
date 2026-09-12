// Loading, decoding, and the conditional engine.
//
// sims.bin.gz is the joint distribution: one bit per race per draw, for every
// race in every chamber that ever flips. It is the reason this page can answer
// "if Republicans hold NC-SEN, what happens to the House" from the model's own
// draws instead of from a formula.
//
// What signs CANNOT give back is any quantity that needs a margin: a conditional
// median, a margin quantile, or the tipping point (which ranks all 435 margins
// within each draw). Those are precomputed by engine/dashboard/ and are frozen
// while a condition is applied. See Sims.recomputable.

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

async function json(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
  return r.json();
}

// GitHub Pages does not gzip application/octet-stream, so the payload ships
// pre-compressed and is inflated here rather than by the transport.
async function inflate(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream unavailable — browser too old for this payload');
  }
  const stream = r.body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class Sims {
  constructor(buf, manifest) {
    this.buf = buf;
    this.m = manifest;
    const { n_sims, row_bytes, n_races } = manifest;
    if (buf.length !== n_sims * row_bytes) {
      throw new Error(`sims.bin: expected ${n_sims * row_bytes} bytes, got ${buf.length}`);
    }
    this.col = new Map(manifest.race_ids.map((r, i) => [r, i]));

    // Chamber columns are contiguous, one block per chamber in manifest order,
    // which the builder guarantees; assert rather than trust, because a silent
    // reordering would produce seat totals that are wrong but entirely plausible.
    //
    // The blocks are read from the manifest rather than inferred. They used to be
    // inferred -- `lastIndexOf('house')` split the payload in two and everything
    // above it was Senate by elimination -- which was correct for exactly as long
    // as there were two chambers. Governors made "the rest is Senate" wrong, and
    // wrong in the quiet way: 36 extra columns would have been counted as Senate
    // seats and the page would have rendered a plausible, badly incorrect number.
    const ch = manifest.chamber_of;
    const chambers = Object.keys(manifest.blocks).filter(c => {
      const [s, e] = manifest.blocks[c];
      return e > s;
    });
    for (const c of chambers) {
      const [s, e] = manifest.blocks[c];
      for (let i = s; i < e; i++) {
        if (ch[i] !== c) throw new Error(`sims.bin: ${c} block broken at column ${i} (${ch[i]})`);
      }
    }
    const covered = chambers.reduce((n, c) => n + manifest.blocks[c][1] - manifest.blocks[c][0], 0);
    if (covered !== n_races) {
      throw new Error(`sims.bin: blocks cover ${covered} of ${n_races} columns`);
    }

    // Per-draw seat totals, computed once. Conditioning then filters draws and
    // re-aggregates these, which keeps a pin interactive rather than a rebuild.
    //
    // Counted a BYTE at a time through POPCOUNT rather than a bit at a time: at
    // 20,000 draws x 412 races that is 8.2M bit tests against 1M table lookups.
    // A block's ends land mid-byte, so each block is its whole interior bytes
    // plus a masked byte at either end -- column j is bit (7 - j%8), so the mask
    // for local columns lo..hi is (0xff >> lo) & (0xff << (7 - hi)).
    this.seats = {};
    const plan = chambers.map(c => {
      const [s, e] = manifest.blocks[c];
      const firstByte = s >> 3, lastByte = (e - 1) >> 3;
      const masks = [];
      for (let b = firstByte; b <= lastByte; b++) {
        const lo = Math.max(s, b * 8) - b * 8;
        const hi = Math.min(e - 1, b * 8 + 7) - b * 8;
        masks.push((0xff >> lo) & ((0xff << (7 - hi)) & 0xff));
      }
      // `offsets` is per chamber, so no chamber name appears in this decoder.
      const base = (manifest.baseline[c] || 0) + (manifest.offsets[c] || 0);
      return { c, firstByte, masks, out: (this.seats[c] = new Int16Array(n_sims)), base };
    });
    for (let s = 0; s < n_sims; s++) {
      const off = s * row_bytes;
      for (const p of plan) {
        let n = 0;
        for (let k = 0; k < p.masks.length; k++) n += POPCOUNT[buf[off + p.firstByte + k] & p.masks[k]];
        p.out[s] = p.base + n;
      }
    }
    this._bits = new Map();
  }

  // One race's outcome across every draw, as bytes. Cached: the correlation
  // matrix asks for the same 34 columns on every render, and re-walking the
  // packed buffer for each was most of that panel's cost.
  bitsFor(raceId) {
    let a = this._bits.get(raceId);
    if (a) return a;
    const c = this.col.get(raceId);
    if (c === undefined) return null;
    const n = this.m.n_sims, rb = this.m.row_bytes;
    const byte = c >> 3, shift = 7 - (c & 7);
    a = new Uint8Array(n);
    for (let s = 0; s < n; s++) a[s] = (this.buf[s * rb + byte] >> shift) & 1;
    this._bits.set(raceId, a);
    return a;
  }

  bit(sim, col) {
    const o = sim * this.m.row_bytes + (col >> 3);
    return (this.buf[o] >> (7 - (col & 7))) & 1;
  }

  // pins: [{race_id, party:'D'|'R'}] -> Int32Array of matching draw indices.
  select(pins) {
    const n = this.m.n_sims;
    if (!pins || !pins.length) return null;           // null means "all draws"
    const cols = pins.map(p => {
      const c = this.col.get(p.race_id);
      if (c === undefined) {
        throw new Error(`${p.race_id} never flips — it is not in the payload and cannot be pinned`);
      }
      return { c, want: p.party === 'D' ? 1 : 0 };
    });
    const out = new Int32Array(n);
    let k = 0;
    outer: for (let s = 0; s < n; s++) {
      for (const { c, want } of cols) if (this.bit(s, c) !== want) continue outer;
      out[k++] = s;
    }
    return out.subarray(0, k);
  }

  summary(chamber, idx) {
    const seats = this.seats[chamber];
    if (!seats) return null;
    // A chamber with no entry in `majority` has no collective majority to hold --
    // governors. It gets counts and an interval, and `control_prob` stays null
    // rather than defaulting to a threshold nobody chose. Callers must render the
    // null; a `?? 0` here would put a confident 0% on the page.
    const thresh = Object.prototype.hasOwnProperty.call(this.m.majority, chamber)
      ? this.m.majority[chamber] : null;
    const n = idx ? idx.length : this.m.n_sims;
    if (!n) return null;
    const vals = new Int16Array(n);
    for (let i = 0; i < n; i++) vals[i] = seats[idx ? idx[i] : i];
    let hit = 0;
    if (thresh !== null) for (let i = 0; i < n; i++) if (vals[i] >= thresh) hit++;
    const sorted = Int16Array.from(vals).sort();
    const q = p => sorted[Math.min(n - 1, Math.floor(p * n))];
    const lo = sorted[0], hi = sorted[n - 1];
    const counts = new Array(hi - lo + 1).fill(0);
    for (let i = 0; i < n; i++) counts[vals[i] - lo]++;
    return {
      n, threshold: thresh,
      control_prob: thresh === null ? null : hit / n,
      median: n % 2 ? sorted[(n - 1) >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
      p10: q(0.10), p90: q(0.90),
      hist: { min: lo, counts },
      // Monte Carlo standard error on the control probability. At the 500-draw
      // reporting floor this is ~2.2 points, which is large enough that a
      // conditional headline must show it rather than imply five-digit precision.
      se: thresh === null ? null : Math.sqrt((hit / n) * (1 - hit / n) / n),
    };
  }

  winProb(raceId, idx) {
    const c = this.col.get(raceId);
    if (c === undefined) return null;               // never-flip race: 0 or 1, not sampled
    const n = idx ? idx.length : this.m.n_sims;
    let d = 0;
    for (let i = 0; i < n; i++) d += this.bit(idx ? idx[i] : i, c);
    return d / n;
  }

  // Which panels may update under a condition, and which must freeze. Signs
  // support counts and probabilities; they do not support margins or rankings.
  static get recomputable() {
    return {
      yes: ['control probability', 'seat histogram', 'per-race win probability', 'correlation'],
      no: ['median margin', 'margin quantiles', 'snake ordering and colour',
           'cartogram margin/swing modes', 'tipping point'],
    };
  }
}

export async function loadAll(base = 'data') {
  const [forecast, pins, scenarios, history, blob] = await Promise.all([
    json(`${base}/forecast.json`),
    json(`${base}/pins.json`),
    json(`${base}/scenarios.json`).catch(() => null),
    // Absent until the model has been run more than once. The chart says so
    // rather than the page failing to load.
    json(`${base}/history.json`).catch(() => null),
    inflate(`${base}/sims.bin.gz`),
  ]);
  const manifest = { ...forecast.sims, race_ids: forecast.sims_race_ids };
  return { forecast, pins, scenarios, history, sims: new Sims(blob, manifest) };
}
