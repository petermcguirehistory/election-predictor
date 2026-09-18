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

// The per-race layer: every poll, and what the model said about each race on
// every dated run. Half a megabyte raw, and read only by somebody who has opened
// a race -- which most readers never do -- so it is fetched on the first race
// opened rather than shipped to everyone with the page.
//
// Cached as the PROMISE and not the result, so two quick clicks on two races
// start one request rather than two. A failure resolves to null instead of
// rejecting: the panel it feeds is an enrichment, and the arithmetic beneath it
// is already correct without it.
let _detail = null;
export function loadRaceDetail(base = 'data') {
  if (!_detail) {
    _detail = json(`${base}/racedetail.json`).catch(e => {
      console.warn('race detail unavailable:', e.message);
      return null;
    });
  }
  return _detail;
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
    // Every column is in a chamber block, except the three-way races' independent
    // wins, which the builder appends after them and counts in `extra_columns`.
    const covered = chambers.reduce((n, c) => n + manifest.blocks[c][1] - manifest.blocks[c][0], 0);
    if (covered + (manifest.extra_columns || 0) !== n_races) {
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

    // A WIN IN AN INDEPENDENT'S SLOT IS NOBODY'S SEAT. The browser twin of
    // `party_columns` in engine/simulate/tabulate.py -- CHANGE BOTH OR NEITHER.
    // Where the independent holds the D slot a SET bit is their win, and it
    // comes back out of the popcount above; where they are the D slot's
    // opponent a CLEAR bit is theirs. The engine's verify() reconstructs both
    // columns from these same manifest fields before the payload ships.
    //
    // A handful of columns per chamber, so tested a bit at a time rather than
    // folded into the byte masks.
    this.ind = {};
    for (const c of chambers) {
      const slots = manifest.independents[c] || { D: [], R: [] };
      const at = r => {
        const j = this.col.get(r);
        if (j === undefined) throw new Error(`sims.bin: independent slot ${r} is not a column`);
        return j;
      };
      const inD = slots.D.map(at), inR = slots.R.map(at);
      // A three-way race's own column already means "the Democrat won outright";
      // its `#IND` column is the independent's win, and adds to them alone.
      const inX = ((manifest.three_way || {})[c] || []).map(r => at(`${r}#IND`));
      const dSeats = this.seats[c];
      const ind = (this.ind[c] = new Int16Array(n_sims).fill(manifest.ind_baseline[c] || 0));
      if (!inD.length && !inR.length && !inX.length) continue;
      for (let s = 0; s < n_sims; s++) {
        const off = s * row_bytes;
        let won = 0;
        for (const j of inD) won += (buf[off + (j >> 3)] >> (7 - (j & 7))) & 1;
        let lost = 0;
        for (const j of inR) lost += 1 - ((buf[off + (j >> 3)] >> (7 - (j & 7))) & 1);
        let third = 0;
        for (const j of inX) third += (buf[off + (j >> 3)] >> (7 - (j & 7))) & 1;
        dSeats[s] -= won;
        ind[s] += won + lost + third;
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

  // HOW A DRAW'S SEAT COUNT BECOMES CONTROL: +1 D, -1 R, 0 neither. The twin of
  // `outcome` in engine/simulate/tabulate.py -- CHANGE BOTH OR NEITHER; the
  // diagnostics panel recounts every rule against the payload.
  //   free:    each party needs its number; neither at it = the independents decide.
  //   sit-out: the independents vote with neither, so the larger conference
  //            organises; a tie goes to `tiebreak` (the Senate's VP), or stays 0.
  static outcome(d, r, need, rule, tiebreak) {
    if (rule === 'free') return d >= need.D ? 1 : r >= need.R ? -1 : 0;
    if (rule === 'sit-out') {
      return d > r ? 1 : r > d ? -1 : tiebreak === 'D' ? 1 : tiebreak === 'R' ? -1 : 0;
    }
    throw new Error(`unknown control rule ${rule}`);
  }

  summary(chamber, idx, rule = this.m.control_rule) {
    const seats = this.seats[chamber];
    if (!seats) return null;
    // A chamber with no entry in `needs` has no collective majority to hold --
    // governors. It gets counts and an interval, and the probabilities stay null
    // rather than defaulting to a threshold nobody chose. Callers must render the
    // null; a `?? 0` here would put a confident 0% on the page.
    const need = Object.prototype.hasOwnProperty.call(this.m.needs, chamber)
      ? this.m.needs[chamber] : null;
    const n = idx ? idx.length : this.m.n_sims;
    if (!n) return null;
    const ind = this.ind[chamber];
    const size = this.m.size[chamber];
    const vals = new Int16Array(n);
    // THREE OUTCOMES, COUNTED, under `rule` (see `outcome`): D control, R
    // control, and neither -- the independents deciding under the free rule, a
    // tied House under sit-out. Counted rather than taken as 1 - d - r, so each
    // matches the engine's `control` to the last digit.
    const tb = (this.m.tiebreak || {})[chamber] ?? null;
    let hit = 0, hitR = 0;
    for (let i = 0; i < n; i++) {
      const s = idx ? idx[i] : i;
      const d = seats[s];
      vals[i] = d;
      if (need) {
        const o = Sims.outcome(d, size - d - ind[s], need, rule, tb);
        if (o === 1) hit++;
        else if (o === -1) hitR++;
      }
    }
    const sorted = Int16Array.from(vals).sort();
    // ONE HALF OF A PAIR: `seat_quantile` in engine/simulate/tabulate.py is the
    // other, and the two must return the same integer for the same draws.
    // CHANGE BOTH OR NEITHER. The engine used to reach this number through
    // np.percentile, which interpolates between the draws either side of
    // (n-1)*p; this takes the draw at rank floor(p*n). They agree only when
    // those land on the same value, so the House p10 shipped as
    // 207.9000000000001 here against 208 -- and on another day they can differ
    // by a whole seat with both sides printing clean integers. The diagnostics
    // panel below compares them for equality, which is what caught it.
    const q = p => sorted[Math.min(n - 1, Math.floor(p * n))];
    const lo = sorted[0], hi = sorted[n - 1];
    const counts = new Array(hi - lo + 1).fill(0);
    for (let i = 0; i < n; i++) counts[vals[i] - lo]++;
    const se = k => Math.sqrt((k / n) * (1 - k / n) / n);
    return {
      n, rule, threshold: need ? need.D : null, r_threshold: need ? need.R : null,
      control_prob: need ? hit / n : null,
      r_control_prob: need ? hitR / n : null,
      undecided_prob: need ? (n - hit - hitR) / n : null,
      median: n % 2 ? sorted[(n - 1) >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
      p10: q(0.10), p90: q(0.90),
      hist: { min: lo, counts },
      // Monte Carlo standard error on each party's control probability. At the
      // 500-draw reporting floor this is ~2.2 points, which is large enough that
      // a conditional headline must show it rather than imply five-digit precision.
      se: need ? se(hit) : null,
      se_r: need ? se(hitR) : null,
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
      yes: ['control probability', 'seat histogram', 'per-race win probability', 'correlation',
            'seat strip colour', 'flip probabilities and flip ranges'],
      no: ['median margin', 'margin quantiles', 'seat strip order',
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
