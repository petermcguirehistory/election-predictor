// Election night: the returns, read against the forecast as they arrive.
//
// Four panels off one payload (docs/data/results.json, written every few minutes
// by engine/ingest/results.py from the AP calls and counts):
//
//   nightHeadline  what the calls so far say -- how many the model had right, how
//                  surprised it is against how surprised it said it would be, and
//                  the chambers re-read from only the simulations that match the
//                  calls. That last number is the page's own conditioning engine
//                  (data.js Sims.select) with every call as a pin, which is why
//                  the "hold these fixed" button exists: it hands the same pins
//                  to the store, and every panel on the site, the shared-error
//                  matrix included, is then re-read under tonight's results.
//   nightSwing     where the night sits on the shared error. The model's largest
//                  single error term is the one every race shares (sigma.nat);
//                  the counted margin minus the forecast margin, averaged across
//                  mostly-counted races, is a direct reading of it.
//   nightCalls     every call, most surprising first.
//   nightCounting  what the ballots say: every uncalled race with votes in, its
//                  lead in ballots, the pool still out and what it would have to
//                  run (results.py `ballots`); recount questions first.
//
// EARLY RETURNS ARE NOT A SAMPLE. The first votes counted in a state are whichever
// kind that state counts first -- mail in some, election-day in others -- and
// they lean one way by construction. So nothing here reads a margin from a race
// under `eevp_min` of its expected vote, the swing is shown at two thresholds
// with the count behind each, and a called race is scored on the call, not on
// whatever its count said at the moment of the call.
import d3 from '../d3.js';
import { C, svg, showTip, hideTip, fmtPct, fmtMargin, chamberName, SIDE, sideOf } from '../charts/util.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric',
                                               minute: '2-digit' });
const stamp = iso => (iso ? `${ET.format(new Date(iso))} ET` : '');
const fmtResid = v => (v > 0 ? `D+${v.toFixed(1)}` : v < 0 ? `R+${(-v).toFixed(1)}` : 'even');

// The pins a set of calls implies: a race the payload can condition on (both
// outcomes sampled, `col >= 0`), won by one of the two sides the model priced.
export function callPins(results, viability) {
  return results.races
    .filter(r => r.called && (r.winner === 'D' || r.winner === 'R'))
    .filter(r => viability[r.race_id] && viability[r.race_id].col >= 0)
    .map(r => ({ race_id: r.race_id, party: r.winner, p: r.forecast_p }));
}

// Condition on the calls. Every call first; if fewer draws survive than the
// reporting floor, the lopsided calls are dropped -- a 99% race that went the
// way it was always going to go removes almost no draws, so if the pool is thin
// it is the close calls doing it, and they are the ones worth keeping.
function conditionOnCalls(sims, pins, floor) {
  if (!pins.length) return { idx: null, used: [], n: sims.m.n_sims, ok: true, dropped: 0 };
  let idx = sims.select(pins);
  if (idx.length >= floor) return { idx, used: pins, n: idx.length, ok: true, dropped: 0 };
  const close = pins.filter(p => p.p > 0.02 && p.p < 0.98);
  idx = close.length ? sims.select(close) : null;
  const n = idx ? idx.length : sims.m.n_sims;
  return { idx, used: close, n, ok: n >= floor, dropped: pins.length - close.length };
}

function card(host, label, value, cls, note) {
  const c = el('div', 'topline night-card');
  c.append(el('div', 'chamber', label));
  const v = el('div', `prob ${cls || ''}`, value);
  c.append(v);
  if (note) {
    const n = el('div', 'seats');
    n.innerHTML = note;
    c.append(n);
  }
  host.append(c);
  return c;
}

export function nightHeadline(host, { results, forecast, sims, viability, rule, pins, onHold, onPick }) {
  host.replaceChildren();
  const sc = results.score.all;
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  const floor = viability._meta.floor;

  const lede = el('p', 'night-lede');
  if (!sc.n) {
    lede.innerHTML = `<b>No race has been called yet.</b> ${results.n.with_votes} races have votes in. `
      + `Updated ${stamp(results.results_updated_at)}; this page re-reads the returns every minute.`;
    host.append(lede);
    return;
  }
  const inf = sc.informative;
  lede.innerHTML =
    `<b>${sc.n} races called</b>, ${results.n.with_votes} with votes in, as of `
    + `${stamp(results.results_updated_at)}. The model's favourite won <b>${sc.favourite_won} of ${sc.n}</b>`
    + (inf.n ? ` — and <b>${inf.favourite_won} of the ${inf.n}</b> it gave either side at least a 2% chance in.`
             : '.')
    + ` Democratic-side wins so far: <b>${sc.d_wins}</b>, where the model expected ${sc.d_wins_expected.toFixed(1)}.`;
  host.append(lede);

  const cards = el('div', 'toplines night-cards');
  host.append(cards);

  // Surprise against expected surprise, on the calls the model could be wrong
  // about. The all-calls Brier is dominated by seats nobody doubted.
  const b = inf.n ? inf : sc;
  const ratio = b.brier_expected ? b.brier / b.brier_expected : null;
  card(cards, inf.n ? 'Surprise, close calls' : 'Surprise', ratio == null ? '—' : `${ratio.toFixed(2)}×`,
       ratio == null ? '' : ratio > 1.5 ? 'r' : ratio < 0.67 ? 'd' : '',
       `Brier <b>${b.brier.toFixed(3)}</b> against the <b>${b.brier_expected.toFixed(3)}</b> the model `
       + `expected on these ${b.n}. Near 1× is calibrated; well above it, the night is going `
       + `against the model's confidence.`);

  // The chambers, given tonight. Two readings of the same question: the joint
  // conditioned as a Gaussian on every counted margin and call (the engine,
  // `conditional`), which is the headline because it keeps working all night;
  // and the draws that match the calls outright, which is exact and thins.
  const allPins = callPins(results, viability);
  const cond = conditionOnCalls(sims, allPins, floor);
  const gc = results.conditional && results.conditional.available ? results.conditional : null;
  for (const ch of ['senate', 'house']) {
    const base = forecast.topline[ch];
    const now = cond.ok ? sims.summary(ch, cond.idx, rule) : null;
    const g = gc ? gc.control[ch] : null;
    const p = g ? g.d : now ? now.control_prob : null;
    const matching = now
      ? ` Matching draws alone, on ${cond.used.length} call${cond.used.length === 1 ? '' : 's'}: `
        + `<b>${fmtPct(now.control_prob, 0)}</b> from ${now.n.toLocaleString()} simulations.`
      : ` Fewer than ${floor} simulations match the calls outright.`;
    card(cards, `${chamberName(ch)}, given tonight`,
         p == null ? '—' : fmtPct(p, 0), p == null ? '' : p >= 0.5 ? 'd' : 'r',
         g
           ? `Democratic control, re-read from <b>${gc.obs.margins}</b> counted margins and `
             + `<b>${gc.obs.calls}</b> calls; the forecast said <b>${fmtPct(base.control_prob, 0)}</b>. `
             + `Median <b>${g.median}</b> seats, 80% range ${g.p10}–${g.p90} (forecast ${base.median}).`
             + matching
           : p == null ? `Fewer than ${floor} simulations match the calls.`
           : `Democratic control, from the <b>${now.n.toLocaleString()}</b> simulations that match `
             + `${cond.used.length} call${cond.used.length === 1 ? '' : 's'}; the forecast said `
             + `<b>${fmtPct(base.control_prob, 0)}</b>. Median <b>${now.median}</b> seats `
             + `(forecast ${base.median}).`);
  }

  // Hand the same pins to the store, so the whole site conditions on tonight.
  const bar = el('div', 'night-hold');
  const same = pins.length && pins.length === cond.used.length
    && cond.used.every(p => pins.some(q => q.race_id === p.race_id && q.party === p.party));
  const btn = el('button', `chip${same ? ' on' : ''}`,
                 same ? `Holding ${cond.used.length} calls fixed across the page`
                      : `Hold these ${cond.used.length} calls fixed across the whole page`);
  btn.disabled = !cond.ok || !cond.used.length;
  btn.onclick = () => onHold(same ? [] : cond.used.map(({ race_id, party }) => ({ race_id, party })));
  bar.append(btn);
  const why = el('span', 'hint');
  why.innerHTML = same
    ? 'Every number on every tab is now read from the simulations that match the calls — '
      + 'the <a href="#s-correlation">shared-error matrix</a> included. Click again to release.'
    : (cond.dropped ? `${cond.dropped} lopsided calls left out so enough simulations survive. ` : '')
      + 'Calls in seats the model never doubted are not pins: they hold in every simulation already.';
  bar.append(why);
  host.append(bar);

  if (sc.upsets) {
    const ups = results.races.filter(r => r.upset).sort((a, b) => a.p_winner - b.p_winner);
    const box = el('div', 'night-upsets');
    box.append(el('h4', 'wl-h', `${ups.length} upset${ups.length === 1 ? '' : 's'}`));
    const ul = el('ul', 'pts');
    for (const r of ups) {
      const race = byId.get(r.race_id);
      const li = el('li');
      const side = r.winner === 'OTHER' ? 'a third candidate' : SIDE[sideOf(race, r.winner)].name;
      li.innerHTML = `<b>${esc(r.race_id)}</b> went to ${side} (${esc(r.winner_name)}); the model gave that `
        + `<b>${fmtPct(r.p_winner, 0)}</b>.`;
      li.style.cursor = 'pointer';
      li.onclick = () => onPick && onPick(race);
      ul.append(li);
    }
    box.append(ul);
    host.append(box);
  }
}

// ---- the tug of war ----------------------------------------------------------
//
// One bar per chamber, every seat a unit of width. Democrats fill from the left
// (holdovers dim, calls solid), Republicans from the right, independents in
// gold beside the Democratic calls, and what is left in the middle is uncalled.
// The model's re-read sits in that middle: the seats it expects each side to
// take are tinted, the 80% range of the Democratic total is hatched across the
// dividing line, and the morning's median is a dashed tick for comparison. The
// SVG persists across repaints, so a call slides the boundary rather than
// redrawing the bar.
const TUG = { W: 920, rowH: 164, padL: 110, padR: 24, barH: 26, expH: 26, top: 6 };
// The model's own colour on these bars: not a party's, not the independents' gold.
const EXPECT = '#5ed6b8';
// Pickups: the party colour, lightened, so a seat taken from the other side reads
// apart from a seat held.
const PICK = { D: '#dbe9ff', R: '#ffd9d2' };

function tugRows(results, forecast, sims) {
  const m = sims.m;
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  const cond = results.conditional && results.conditional.available ? results.conditional : null;
  return ['senate', 'house', 'governor'].map(ch => {
    const races = forecast.races.filter(r => r.chamber === ch);
    const up = races.length;
    const size = m.size[ch] || forecast.topline[ch].of || up;
    const heldD = (m.offsets || {})[ch] || 0;
    const heldR = size - heldD - up;
    // Seats each side held going in: holdovers plus the seats up that it holds.
    const goingInD = heldD + races.filter(r => r.incumbent_party === 'D').length;
    const goingInR = heldR + races.filter(r => r.incumbent_party === 'R').length;
    // Called seats, by who holds the seat and whether the model had it.
    const c = { D: { hold: 0, holdUp: 0, pick: 0, pickUp: 0 }, R: { hold: 0, holdUp: 0, pick: 0, pickUp: 0 }, I: 0 };
    // The races behind every count, for the list a click opens.
    const L = { Dhold: [], DholdUp: [], Dpick: [], DpickUp: [], Rhold: [], RholdUp: [], Rpick: [], RpickUp: [],
                i: [], open: [], expD: [], expR: [], flipD: [], flipR: [] };
    let expD = 0, expR = 0, expI = 0;        // uncalled seats the re-read gives to the other side
    for (const x of results.races) {
      if (x.chamber !== ch) continue;
      const race = byId.get(x.race_id);
      const held = race.incumbent_party;
      if (x.called) {
        const side = x.winner === 'OTHER' ? 'IND' : sideOf(race, x.winner);
        if (side === 'IND') { c.I++; L.i.push(x.race_id); continue; }
        const key = side === held ? 'hold' : 'pick';
        c[side][key + (x.upset ? 'Up' : '')]++;
        L[side + key + (x.upset ? 'Up' : '')].push(x.race_id);
      } else {
        L.open.push(x.race_id);
        const pD = x.live_p ?? x.cond_p ?? x.forecast_p;
        (pD >= 0.5 ? L.expD : L.expR).push(x.race_id);
        const fav = pD >= 0.5 ? sideOf(race, 'D') : sideOf(race, 'R');
        if (fav === held || (held !== 'D' && held !== 'R')) continue;
        if (fav === 'D') { expD++; L.flipD.push(x.race_id); } else if (fav === 'R') { expR++; L.flipR.push(x.race_id); } else expI++;
      }
    }
    const d = c.D.hold + c.D.holdUp + c.D.pick + c.D.pickUp;
    const r = c.R.hold + c.R.holdUp + c.R.pick + c.R.pickUp;
    return { ch, size, heldD, heldR, goingInD, goingInR, d, r, i: c.I, calls: c, lists: L,
             dUp: c.D.holdUp + c.D.pickUp, rUp: c.R.holdUp + c.R.pickUp,
             expFlips: { D: expD, R: expR, I: expI },
             uncalled: up - d - r - c.I, exp: cond ? cond.control[ch] : null,
             base: forecast.topline[ch], need: m.needs[ch] || null };
  });
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The segments of one chamber's two bars, each with the sentence its hover shows.
// The Democratic block runs holds then pickups outward from the left edge, the
// Republican block pickups then holds inward from the right, so each side's
// pickups sit at the inner edge against what is still open. Upsets are hatched.
function tugSegments(row) {
  const unit = row.ch === 'governor' ? 'governorship' : 'seat';
  const other = { D: 'Republicans', R: 'Democrats' };
  const own = { D: 'Democrats', R: 'Republicans' };
  const top = [];
  let x = 0;
  const push = (k, n, fill, op, tip, upset = false, races = null, title = null) => {
    if (n > 0) top.push({ k, a: x, b: x + n, fill, op, tip, upset, races, title });
    x += n;
  };
  push('heldD', row.heldD, C.demDeep, 0.4,
       `<b>${plural(row.heldD, `Democratic ${unit}`)} not on the ballot</b><br><span class="tip-dim">Held over; they count toward a majority but nothing tonight changes them.</span>`);
  for (const side of ['D', 'R']) {
    const cc = row.calls[side], col = side === 'D' ? C.dem : C.rep, pk = PICK[side];
    const order = side === 'D'
      ? [['hold', col, false], ['holdUp', col, true], ['pick', pk, false], ['pickUp', pk, true]]
      : [['pickUp', pk, true], ['pick', pk, false], ['holdUp', col, true], ['hold', col, false]];
    if (side === 'R') x = row.size - row.heldR - row.r;      // the Republican block, from its left edge
    for (const [key, fill, up] of order) {
      const n = cc[key];
      const what = key.startsWith('hold') ? `held by ${own[side]} and kept` : `taken from ${other[side]}`;
      push(`${side}${key}`, n, fill, 1,
           `<b>${plural(n, unit)} called for ${own[side]}, ${what}</b>` + (up ? '<br><span class="tip-dim">Against the model’s favourite.</span>' : ''), up,
           // The section's whole list, upsets included: a click on either the plain
           // chunk or its hatched upsets opens the same roster, upsets marked in it.
           [...row.lists[side + key.replace('Up', '')], ...row.lists[side + key.replace('Up', '') + 'Up']],
           `${chamberName(row.ch)}: called for ${own[side]}, ${what}`
             + (cc[key.replace('Up', '') + 'Up'] ? ` (${plural(cc[key.replace('Up', '') + 'Up'], 'upset')})` : ''));
    }
    if (side === 'D') {
      push('i', row.i, C.accent, 1, `<b>${plural(row.i, unit)} called for an independent</b><br><span class="tip-dim">Counts for neither side.</span>`,
           false, row.lists.i, `${chamberName(row.ch)}: called for an independent`);
      const zone1 = row.size - row.heldR - row.r;
      top.push({ k: 'open', a: x, b: zone1, fill: C.mid, op: 1, races: row.lists.open, title: `${chamberName(row.ch)}: not yet called`,
                 tip: `<b>${plural(row.uncalled, unit)} not yet called</b><br><span class="tip-dim">The bar beneath is how the model expects them to fall.</span>` });
    }
  }
  top.push({ k: 'heldR', a: row.size - row.heldR, b: row.size, fill: C.repDeep, op: 0.4,
             tip: `<b>${plural(row.heldR, `Republican ${unit}`)} not on the ballot</b><br><span class="tip-dim">Held over; they count toward a majority but nothing tonight changes them.</span>` });
  const e = row.exp;
  const needD = row.need ? ` ${row.need.D} needed for control.` : '';
  const needR = row.need ? ` ${row.need.R} needed for control.` : '';
  const bottom = e ? [
    { k: 'expD', a: 0, b: e.median, fill: C.dem, op: 0.85, races: row.lists.expD, title: `${chamberName(row.ch)}: uncalled seats the re-read gives to Democrats`,
      tip: `<b>Model now expects Democrats to finish with ${Math.round(e.median)} of ${row.size}</b><br>` +
           `<span class="tip-dim">80% range ${e.p10}–${e.p90}.${needD} They went in with ${row.goingInD}, so that is a net ` +
           `${Math.round(e.median) - row.goingInD >= 0 ? '+' : ''}${Math.round(e.median) - row.goingInD}. This morning's forecast was ${Math.round(row.base.median)}.</span>` },
    { k: 'expR', a: e.median, b: row.size, fill: C.rep, op: 0.85, races: row.lists.expR, title: `${chamberName(row.ch)}: uncalled seats the re-read gives to Republicans`,
      tip: `<b>Model now expects Republicans to finish with ${Math.round(row.size - e.median)} of ${row.size}</b><br>` +
           `<span class="tip-dim">80% range ${row.size - e.p90}–${row.size - e.p10}.${needR} They went in with ${row.goingInR}.</span>` },
  ] : [];
  return { top: top.filter(t => t.b > t.a), bottom };
}

export function nightTug(host, { results, forecast, sims, onPick }) {
  const rows = tugRows(results, forecast, sims);
  const { W, rowH, padL, padR, barH, expH, top } = TUG;
  const H = top + rows.length * rowH;
  let s = d3.select(host).select('svg.tug');
  const fresh = s.empty();
  if (fresh) {
    s = svg(host, W, H, 'Seats won so far by each side, and the model’s expected finish');
    s.classed('tug', true);
    s.node().parentNode.style.maxWidth = `${W + 40}px`;
    // Upsets: a gold hatch over the party colour, as on the map.
    const pat = s.append('defs').append('pattern').attr('id', 'tugup').attr('width', 7).attr('height', 7)
      .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 7).attr('height', 7).attr('fill', C.bg).attr('fill-opacity', 0.35);
    pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 7).attr('stroke', C.accent).attr('stroke-width', 3);
  }
  const T = sel => (fresh ? sel : sel.transition().duration(700).ease(d3.easeCubicOut));
  const Y = { title: 12, bar: 24 };
  Y.brk = Y.bar + barH + 9;            // the pickup brackets, between the bars
  Y.exp = Y.bar + barH + 24;
  Y.whisker = Y.exp + expH + 7;
  Y.text = Y.whisker + 20;
  Y.text2 = Y.text + 16;

  const g = s.selectAll('g.row').data(rows, d => d.ch).join(enter => {
    const e = enter.append('g').attr('class', 'row');
    e.append('text').attr('class', 'lbl').attr('x', 0).attr('y', Y.title).attr('font-size', 14)
      .attr('font-weight', 600).attr('fill', C.ink);
    e.append('text').attr('class', 'sub1').attr('x', padL - 10).attr('y', Y.bar + barH / 2 + 4)
      .attr('text-anchor', 'end').attr('font-size', 10.5).attr('fill', C.muted).text('so far');
    e.append('text').attr('class', 'sub2').attr('x', padL - 10).attr('y', Y.exp + expH / 2 + 4)
      .attr('text-anchor', 'end').attr('font-size', 10.5).attr('fill', EXPECT).text('expected finish');
    e.append('g').attr('class', 'top');
    e.append('g').attr('class', 'over');
    e.append('g').attr('class', 'bottom');
    e.append('g').attr('class', 'marks');
    e.append('g').attr('class', 'brackets');
    e.append('g').attr('class', 'whisker');
    e.append('text').attr('class', 'left').attr('font-size', 11.5).attr('fill', C.dem);
    e.append('text').attr('class', 'right').attr('font-size', 11.5).attr('fill', C.rep).attr('text-anchor', 'end');
    e.append('text').attr('class', 'mid').attr('font-size', 11.5).attr('fill', C.muted).attr('text-anchor', 'middle');
    e.append('text').attr('class', 'flips').attr('font-size', 11.5).attr('fill', C.muted).attr('text-anchor', 'middle');
    return e;
  });
  g.attr('transform', (d, k) => `translate(0,${top + k * rowH})`);
  g.select('text.lbl').text(d => chamberName(d.ch));

  const hover = sel => sel
    .on('pointerenter', function () { d3.select(this).attr('stroke', C.ink).attr('stroke-width', 1.5); })
    .on('pointermove', (e, d) => showTip(e, d.tip + (d.races && d.races.length ? '<br><span class="tip-dim">click for the list</span>' : '')))
    .on('pointerleave', function () { d3.select(this).attr('stroke', null); hideTip(); })
    .style('cursor', d => (d.races && d.races.length ? 'pointer' : 'default'))
    .on('click', (e, d) => { if (d.races && d.races.length) { hideTip(); raceList({ title: d.title, ids: d.races, results, forecast, onPick }); } });

  g.each(function (row) {
    const x = d3.scaleLinear().domain([0, row.size]).range([padL, W - padR]);
    const { top: segsTop, bottom: segsBot } = tugSegments(row);
    const place = (sel, y, h) => sel.attr('y', y).attr('height', h)
      .attr('x', d => x(d.a)).attr('width', d => Math.max(0, x(d.b) - x(d.a)));
    const rt = d3.select(this).select('g.top').selectAll('rect').data(segsTop, d => d.k)
      .join(enter => hover(place(enter.append('rect'), Y.bar, barH)), update => update, exit => exit.remove());
    rt.attr('fill', d => d.fill).attr('fill-opacity', d => d.op);
    T(rt).attr('x', d => x(d.a)).attr('width', d => Math.max(0, x(d.b) - x(d.a)));
    // The upset hatch rides on top and takes no pointer, so the hover below it still speaks.
    const upSegs = segsTop.filter(d => d.upset);
    const ov = d3.select(this).select('g.over').selectAll('rect').data(upSegs, d => d.k)
      .join(enter => place(enter.append('rect'), Y.bar - 2, barH + 4).attr('fill', 'url(#tugup)')
              .attr('stroke', C.accent).attr('stroke-width', 2).attr('pointer-events', 'none'),
            update => update, exit => exit.remove());
    T(ov).attr('x', d => x(d.a)).attr('width', d => Math.max(0, x(d.b) - x(d.a)));
    // A gold flag above each upset segment; the count is in the tally line and the hover.
    const uf = d3.select(this).select('g.over').selectAll('g.uflag').data(upSegs, d => d.k)
      .join(enter => {
        const e = enter.append('g').attr('class', 'uflag').attr('pointer-events', 'none');
        e.append('path').attr('d', d3.symbol().type(d3.symbolTriangle).size(48)()).attr('fill', C.accent);
        return e;
      }, update => update, exit => exit.remove());
    T(uf).attr('transform', d => `translate(${(x(d.a) + x(d.b)) / 2},${Y.bar - 7}) rotate(180)`);
    const rb = d3.select(this).select('g.bottom').selectAll('rect').data(segsBot, d => d.k)
      .join(enter => hover(place(enter.append('rect'), Y.exp, expH)), update => update, exit => exit.remove());
    rb.attr('fill', d => d.fill).attr('fill-opacity', d => d.op);
    T(rb).attr('x', d => x(d.a)).attr('width', d => Math.max(0, x(d.b) - x(d.a)));

    // Marks through both bars: the majority, and the line each side went in
    // with -- the distance from that line to a block's edge is the net change.
    // On the expected bar the re-read median and the morning's median.
    const marks = [];
    if (row.need) {
      const v = (row.need.D + (row.size - row.need.R)) / 2;
      marks.push({ k: 'need', v, y1: Y.bar - 4, y2: Y.exp + expH + 4, col: C.ink, dash: null, w: 1.5,
                   lbl: row.need.D === row.need.R ? `majority ${row.need.D}` : `majority: ${row.need.D} D / ${row.need.R} R`,
                   ly: Y.bar - 8, anchor: 'start' });
    }
    marks.push({ k: 'went', v: row.goingInD, y1: Y.bar - 4, y2: Y.exp + expH + 4, col: C.ink, dash: '4 3', w: 2,
                 lbl: `went in: D ${row.goingInD} / R ${row.goingInR}`, ly: Y.bar - 8, anchor: 'end' });
    if (row.base) marks.push({ k: 'base', v: row.base.median, y1: Y.exp - 3, y2: Y.exp + expH + 3, col: C.ink,
                               dash: '2 2', w: 1.2, lbl: '', ly: 0, anchor: 'middle' });
    if (row.exp) marks.push({ k: 'med', v: row.exp.median, y1: Y.exp - 6, y2: Y.whisker + 4, col: EXPECT,
                              dash: null, w: 3.5, lbl: '', ly: 0, anchor: 'middle' });
    const mk = d3.select(this).select('g.marks').selectAll('g.mark').data(marks, d => d.k)
      .join(enter => {
        const e = enter.append('g').attr('class', 'mark').attr('transform', d => `translate(${x(d.v)},0)`);
        e.append('line'); e.append('text').attr('font-size', 10.5);
        return e;
      });
    T(mk).attr('transform', d => `translate(${x(d.v)},0)`);
    mk.select('line').attr('y1', d => d.y1).attr('y2', d => d.y2).attr('stroke', d => d.col)
      .attr('stroke-width', d => d.w).attr('stroke-dasharray', d => d.dash);
    mk.select('text').attr('y', d => d.ly).attr('text-anchor', d => d.anchor).attr('fill', d => d.col)
      .attr('x', d => (d.anchor === 'start' ? 4 : d.anchor === 'end' ? -4 : 0)).text(d => d.lbl);

    // Brackets under the top bar spanning each side's pickups, labelled with the
    // count: the pale blocks are the seats, the bracket is the number.
    const pD = row.calls.D.pick + row.calls.D.pickUp, pR = row.calls.R.pick + row.calls.R.pickUp;
    const zone1 = row.size - row.heldR - row.r;
    const brs = [];
    if (pD) brs.push({ k: 'bD', a: row.heldD + row.calls.D.hold + row.calls.D.holdUp, b: row.heldD + row.d, col: C.dem, lbl: `+${pD} taken from R`, anchor: 'end' });
    if (pR) brs.push({ k: 'bR', a: zone1, b: zone1 + pR, col: C.rep, lbl: `+${pR} taken from D`, anchor: 'start' });
    const bg = d3.select(this).select('g.brackets').selectAll('g.b').data(brs, d => d.k)
      .join(enter => {
        const e = enter.append('g').attr('class', 'b');
        e.append('line').attr('class', 'bar').attr('stroke-width', 2).attr('y1', Y.brk).attr('y2', Y.brk);
        for (const c of ['c1', 'c2']) e.append('line').attr('class', c).attr('stroke-width', 2).attr('y1', Y.brk - 4).attr('y2', Y.brk + 1);
        e.append('text').attr('font-size', 10.5).attr('font-weight', 600).attr('y', Y.brk + 11);
        e.select('line.bar').attr('x1', d => x(d.a)).attr('x2', d => x(d.b));
        e.select('line.c1').attr('x1', d => x(d.a)).attr('x2', d => x(d.a));
        e.select('line.c2').attr('x1', d => x(d.b)).attr('x2', d => x(d.b));
        e.select('text').attr('x', d => (d.anchor === 'end' ? x(d.b) : x(d.a)));
        return e;
      }, update => update, exit => exit.remove());
    bg.selectAll('line').attr('stroke', function () { return d3.select(this.parentNode).datum().col; });
    bg.select('text').attr('fill', d => d.col).attr('text-anchor', d => d.anchor).text(d => d.lbl);
    T(bg.select('line.bar')).attr('x1', d => x(d.a)).attr('x2', d => x(d.b));
    T(bg.select('line.c1')).attr('x1', d => x(d.a)).attr('x2', d => x(d.a));
    T(bg.select('line.c2')).attr('x1', d => x(d.b)).attr('x2', d => x(d.b));
    T(bg.select('text')).attr('x', d => (d.anchor === 'end' ? x(d.b) : x(d.a)));

    // The 80% range as a whisker under the expected bar, in the model's colour.
    const wd = row.exp ? [{ k: 'w', a: row.exp.p10, b: row.exp.p90,
      tip: `<b>80% range of the Democratic total: ${row.exp.p10} to ${row.exp.p90}</b><br>` +
           `<span class="tip-dim">Where the dividing line lands in four fifths of the model's simulations given tonight.</span>` }] : [];
    const wg = d3.select(this).select('g.whisker').selectAll('g.w').data(wd, d => d.k)
      .join(enter => {
        const e = enter.append('g').attr('class', 'w');
        e.append('line').attr('class', 'bar').attr('stroke', EXPECT).attr('stroke-width', 3).attr('y1', Y.whisker).attr('y2', Y.whisker);
        for (const c of ['c1', 'c2']) e.append('line').attr('class', c).attr('stroke', EXPECT).attr('stroke-width', 2).attr('y1', Y.whisker - 5).attr('y2', Y.whisker + 5);
        hover(e.append('rect').attr('class', 'hit').attr('y', Y.whisker - 7).attr('height', 14).attr('fill', 'transparent'));
        e.select('line.bar').attr('x1', d => x(d.a)).attr('x2', d => x(d.b));
        e.select('line.c1').attr('x1', d => x(d.a)).attr('x2', d => x(d.a));
        e.select('line.c2').attr('x1', d => x(d.b)).attr('x2', d => x(d.b));
        e.select('rect.hit').attr('x', d => x(d.a)).attr('width', d => x(d.b) - x(d.a));
        return e;
      }, update => update, exit => exit.remove());
    T(wg.select('line.bar')).attr('x1', d => x(d.a)).attr('x2', d => x(d.b));
    T(wg.select('line.c1')).attr('x1', d => x(d.a)).attr('x2', d => x(d.a));
    T(wg.select('line.c2')).attr('x1', d => x(d.b)).attr('x2', d => x(d.b));
    T(wg.select('rect.hit')).attr('x', d => x(d.a)).attr('width', d => x(d.b) - x(d.a));

    const held = n => (n ? `, ${n} not up` : '');
    const ups = row.dUp + row.rUp;
    d3.select(this).select('text.left').attr('x', padL).attr('y', Y.text)
      .text(`Democrats ${row.heldD + row.d}${held(row.heldD)}${row.i ? ` · independents ${row.i}` : ''}`);
    d3.select(this).select('text.right').attr('x', W - padR).attr('y', Y.text)
      .text(`Republicans ${row.heldR + row.r}${held(row.heldR)}`);
    d3.select(this).select('text.mid').attr('x', (padL + W - padR) / 2).attr('y', Y.text)
      .text(`${row.uncalled} uncalled${ups ? ` · ${plural(ups, 'upset')}` : ''}` + (row.exp
        ? ` · expected finish D ${Math.round(row.exp.median)} (80%: ${row.exp.p10}–${row.exp.p90}); this morning ${Math.round(row.base.median)}`
        : ''));
    const netExp = row.exp ? Math.round(row.exp.median) - row.goingInD : null;
    d3.select(this).select('text.flips').attr('x', (padL + W - padR) / 2).attr('y', Y.text2)
      .text(`flipped so far: D took ${pD}, R took ${pR}${row.i ? `, independents ${row.i}` : ''} · net D ${pD - pR >= 0 ? '+' : ''}${pD - pR}`
        + ` · still expected to flip: ${row.expFlips.D} to D, ${row.expFlips.R} to R${row.expFlips.I ? `, ${row.expFlips.I} to an independent` : ''}`
        + (netExp == null ? '' : ` · expected net D ${netExp >= 0 ? '+' : ''}${netExp}`));
  });

  if (fresh) {
    const note = el('p', 'chart-note');
    note.innerHTML = 'Top bar: what has happened — calls in solid colour, seats not on the ballot dim at the ends, grey '
      + 'still to be called. Within each side’s calls the <b>pale blocks</b> at the inner edge are seats taken from the other '
      + 'side, each with a bracket counting them; upsets are gold-hatched. The dashed white line is where each side went in, so the '
      + 'distance from it to the edge of the calls is the net change so far. Bottom bar: where the model now expects '
      + `the chamber to finish; the <b style="color:${EXPECT}">green line</b> against the dotted line is the expected `
      + 'net change, the green whisker the 80% range, the white dotted tick this morning’s median. The solid white '
      + 'line is the majority. Hover any piece for what it is.';
    host.append(note);
  }
}

// ---- how the night is going --------------------------------------------------
//
// Two readings of the whole evening against the forecast. First, where tonight's
// re-read sits inside this morning's distribution of seat totals -- the draws
// the page already holds -- so a reader can see at once whether the night is a
// typical draw or a tail. Second, the trajectory: the re-read's median and 80%
// range at every tick since the first call, against the morning's median.
const ET_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

export function nightProgress(host, { results, forecast, sims }) {
  host.replaceChildren();
  const cond = results.conditional && results.conditional.available ? results.conditional : null;
  const chambers = ['senate', 'house', 'governor'];

  // A. Tonight inside this morning's forecast.
  const A = el('div', 'night-progress-a');
  host.append(el('h4', 'wl-h', 'Where tonight sits in this morning’s forecast'));
  host.append(A);
  for (const ch of chambers) {
    const sm = sims.summary(ch, null);
    const g = cond ? cond.control[ch] : null;
    if (!sm || !sm.hist) continue;
    const { min, counts } = sm.hist;
    const n = counts.reduce((a, b) => a + b, 0);
    const lo = min, hi = min + counts.length - 1;
    const W = 460, H = 96, m = { t: 8, r: 14, b: 22, l: 14 };
    const x = d3.scaleLinear().domain([lo - 0.5, hi + 0.5]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, d3.max(counts) / n]).range([H - m.b, m.t]);
    const row = el('div', 'night-progress-row');
    const cap = el('div', 'night-progress-cap');
    A.append(row);
    row.append(el('div', 'pc-h', chamberName(ch)));
    const s = svg(row, W, H, `${chamberName(ch)}: this morning's distribution of seats, with tonight's read`);
    s.node().parentNode.style.maxWidth = `${W + 40}px`;
    s.append('g').selectAll('rect').data(counts.map((c, k) => ({ seat: lo + k, p: c / n }))).join('rect')
      .attr('x', d => x(d.seat - 0.5) + 0.5).attr('width', d => Math.max(0.5, x(d.seat + 0.5) - x(d.seat - 0.5) - 1))
      .attr('y', d => y(d.p)).attr('height', d => H - m.b - y(d.p))
      .attr('fill', C.muted).attr('fill-opacity', 0.55);
    const need = sims.m.needs[ch];
    if (need) {
      s.append('line').attr('x1', x(need.D - 0.5)).attr('x2', x(need.D - 0.5)).attr('y1', m.t).attr('y2', H - m.b)
        .attr('stroke', C.ink).attr('stroke-width', 1.2);
      s.append('text').attr('x', x(need.D - 0.5) + 3).attr('y', m.t + 9).attr('fill', C.ink).attr('font-size', 10)
        .text(`${need.D} for D`);
    }
    const base = forecast.topline[ch];
    s.append('line').attr('x1', x(base.median)).attr('x2', x(base.median)).attr('y1', m.t).attr('y2', H - m.b)
      .attr('stroke', C.ink).attr('stroke-dasharray', '2 2').attr('stroke-width', 1.2);
    for (const t of x.ticks(8)) {
      s.append('text').attr('x', x(t)).attr('y', H - m.b + 13).attr('text-anchor', 'middle').attr('fill', C.muted)
        .attr('font-size', 10).text(t);
    }
    let pct = null;
    if (g) {
      const below = counts.reduce((a, c, k) => a + (lo + k < g.median ? c : lo + k === g.median ? c / 2 : 0), 0);
      pct = below / n;
      s.append('rect').attr('x', x(g.p10 - 0.5)).attr('width', x(g.p90 + 0.5) - x(g.p10 - 0.5))
        .attr('y', m.t).attr('height', H - m.b - m.t).attr('fill', EXPECT).attr('fill-opacity', 0.14);
      s.append('line').attr('x1', x(g.median)).attr('x2', x(g.median)).attr('y1', m.t - 4).attr('y2', H - m.b + 2)
        .attr('stroke', EXPECT).attr('stroke-width', 3.5);
    }
    cap.innerHTML = g
      ? `Tonight’s read, <b style="color:${EXPECT}">D ${Math.round(g.median)}</b>, sits at the `
        + `<b>${Math.round(pct * 100)}th percentile</b> of what the model expected this morning `
        + `(median ${Math.round(base.median)}, 80% range ${base.p10}–${base.p90}).`
      : `No re-read yet; this morning’s median was ${Math.round(base.median)}.`;
    row.append(cap);
  }

  // B. The trajectory.
  const tl = (results.timeline || []).filter(p => p.t && p.senate);
  host.append(el('h4', 'wl-h', 'The evening so far'));
  if (tl.length < 2) {
    host.append(el('p', 'chart-note', 'The trajectory needs a few ticks of the loop before it can be drawn.'));
    return;
  }
  const B = el('div', 'night-progress-b');
  host.append(B);
  const times = tl.map(p => new Date(p.t));
  const t0 = times[0], t1 = times[times.length - 1];
  for (const ch of chambers) {
    const pts = tl.filter(p => p[ch]);
    if (pts.length < 2) continue;
    const base = forecast.topline[ch];
    const need = sims.m.needs[ch];
    const W = 460, H = 130, m = { t: 10, r: 14, b: 22, l: 40 };
    const x = d3.scaleTime().domain([t0, t1]).range([m.l, W - m.r]);
    const ylo = Math.min(base.p10, d3.min(pts, p => p[ch].p10)) - 1;
    const yhi = Math.max(base.p90, d3.max(pts, p => p[ch].p90)) + 1;
    const y = d3.scaleLinear().domain([ylo, yhi]).range([H - m.b, m.t]);
    const row = el('div', 'night-progress-row');
    B.append(row);
    row.append(el('div', 'pc-h', chamberName(ch)));
    const s = svg(row, W, H, `${chamberName(ch)}: the model's expected finish through the evening`);
    s.node().parentNode.style.maxWidth = `${W + 40}px`;
    s.append('g').selectAll('line').data(y.ticks(4)).join('line')
      .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', C.line);
    s.append('g').selectAll('text').data(y.ticks(4)).join('text')
      .attr('x', m.l - 6).attr('y', d => y(d) + 3).attr('text-anchor', 'end').attr('fill', C.muted).attr('font-size', 10).text(d => d);
    for (const t of x.ticks(5)) {
      s.append('text').attr('x', x(t)).attr('y', H - m.b + 13).attr('text-anchor', 'middle').attr('fill', C.muted)
        .attr('font-size', 10).text(ET_HOUR.format(t));
    }
    // This morning's band and median, then tonight's.
    s.append('rect').attr('x', m.l).attr('width', W - m.r - m.l).attr('y', y(base.p90)).attr('height', y(base.p10) - y(base.p90))
      .attr('fill', C.muted).attr('fill-opacity', 0.1);
    s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(base.median)).attr('y2', y(base.median))
      .attr('stroke', C.ink).attr('stroke-dasharray', '2 2').attr('stroke-width', 1.2);
    if (need) {
      s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(need.D)).attr('y2', y(need.D))
        .attr('stroke', C.ink).attr('stroke-width', 1.2);
      s.append('text').attr('x', m.l + 3).attr('y', y(need.D) - 3).attr('fill', C.ink)
        .attr('font-size', 10).text(`${need.D} for D`);
    }
    s.append('path').datum(pts).attr('fill', EXPECT).attr('fill-opacity', 0.22)
      .attr('d', d3.area().x(p => x(new Date(p.t))).y0(p => y(p[ch].p10)).y1(p => y(p[ch].p90)).curve(d3.curveStepAfter));
    s.append('path').datum(pts).attr('fill', 'none').attr('stroke', EXPECT).attr('stroke-width', 2.5)
      .attr('d', d3.line().x(p => x(new Date(p.t))).y(p => y(p[ch].median)).curve(d3.curveStepAfter));
    // Hover: nearest tick.
    const bis = d3.bisector(p => new Date(p.t)).center;
    s.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.r - m.l).attr('height', H - m.b - m.t)
      .attr('fill', 'transparent')
      .on('pointermove', e => {
        const [px] = d3.pointer(e);
        const p = pts[bis(pts, x.invert(px))];
        const g = p[ch];
        showTip(e, `<b>${stamp(p.t)}</b> · ${p.called} called` + (p.upsets ? `, ${p.upsets} upset${p.upsets === 1 ? '' : 's'}` : '')
          + `<br>expected D ${Math.round(g.median)}, 80% range ${g.p10}–${g.p90}`
          + (g.d != null ? `<br><span class="tip-dim">D control ${fmtPct(g.d, 0)}</span>` : ''));
      })
      .on('pointerleave', hideTip);
  }
  const note = el('p', 'chart-note');
  note.innerHTML = `Top: this morning’s distribution of seat totals in grey, its median dotted, and tonight’s read as the `
    + `<b style="color:${EXPECT}">green line</b> with its 80% range shaded. Bottom: that read at every tick of the evening, `
    + `against the morning’s median (dotted) and 80% range (grey band). Hover for the moment.`;
  host.append(note);
}

// ---- predicting the rest -----------------------------------------------------

const fmtMove = d => {
  const pts = Math.round(d * 100);
  if (!pts) return '<span class="tip-dim">—</span>';
  return `<b style="color:${pts > 0 ? C.dem : C.rep}">${pts > 0 ? '+' : '−'}${Math.abs(pts)}</b>`;
};

export function nightPredict(host, { results, forecast, onPick, onMap }) {
  host.replaceChildren();
  const c = results.conditional;
  if (!c || !c.available) {
    host.append(el('p', 'chart-note', `Not available: ${c && c.why ? c.why : 'the payload carries no conditional'}.`));
    return;
  }
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  const rows = results.races.filter(r => !r.called && r.cond_p != null && r.forecast_margin != null);
  const comp = rows.filter(r => r.forecast_p > 0.05 && r.forecast_p < 0.95);
  const before = d3.sum(comp, r => r.forecast_p), after = d3.sum(comp, r => r.cond_p);

  const lede = el('p', 'night-lede');
  lede.innerHTML =
    `Conditioned on <b>${c.obs.margins}</b> counted margins and <b>${c.obs.calls}</b> calls. Across the `
    + `<b>${comp.length}</b> uncalled races the model gave either side at least 5%, expected Democratic-side `
    + `wins move from <b>${before.toFixed(1)}</b> to <b>${after.toFixed(1)}</b>; the average uncalled race `
    + `moves <b>${fmtResid(c.shift_uncalled)}</b> in margin.`;
  host.append(lede);

  // The chambers side by side with the forecast, governors included: a count
  // for them, control for the other two.
  const t = el('table', 'plain night-swing-table');
  const h = t.createTHead().insertRow();
  for (const x of ['Chamber', 'Forecast', 'Given tonight']) h.append(el('th', null, x));
  const body = t.createTBody();
  for (const ch of ['senate', 'house', 'governor']) {
    const base = forecast.topline[ch], g = c.control[ch];
    if (!base || !g) continue;
    const tr = body.insertRow();
    tr.append(el('td', null, chamberName(ch)));
    const a = el('td', 'num'), b = el('td', 'num');
    const prob = (p, med, lo, hi) => (p == null ? `<b>${med}</b>` : `<b>${fmtPct(p, 0)}</b>`)
      + ` <span class="tip-dim">${p == null ? '' : `D control · `}median ${med}${lo != null ? `, ${lo}–${hi}` : ''}</span>`;
    a.innerHTML = prob(base.control_prob, base.median, base.p10, base.p90);
    b.innerHTML = prob(g.d ?? null, Math.round(g.median), g.p10, g.p90);
    tr.append(a, b);
  }
  host.append(t);

  const bar = el('div', 'night-hold');
  const btn = el('button', 'chip', 'See it on the map');
  btn.onclick = () => onMap && onMap();
  bar.append(btn);
  const why = el('span', 'hint');
  why.textContent = 'The map shaded by Tonight: called seats solid, upsets ringed, uncalled seats by these re-read probabilities.';
  bar.append(why);
  host.append(bar);

  rows.sort((a, b2) => Math.abs(b2.cond_p - b2.forecast_p) - Math.abs(a.cond_p - a.forecast_p));
  const shown = rows.slice(0, 40);
  const tb = table(host, [{ label: 'Race' }, { label: 'Forecast', num: true }, { label: 'Now', num: true },
                          { label: 'Move', num: true }, { label: 'Counted', num: true }, { label: 'In', num: true }]);
  for (const r of shown) {
    const race = byId.get(r.race_id);
    const tr = tb.insertRow();
    tr.tabIndex = 0;
    tr.onclick = () => onPick && onPick(race);
    tr.append(el('td', null, r.race_id));
    const side = SIDE[sideOf(race, 'D')].short;
    const f = el('td', 'num');
    f.innerHTML = `${side} ${fmtPct(r.forecast_p, 0)} <span class="tip-dim">${fmtMargin(r.forecast_margin)}</span>`;
    tr.append(f);
    const n = el('td', 'num');
    n.innerHTML = `<b>${side} ${fmtPct(r.cond_p, 0)}</b> <span class="tip-dim">${fmtMargin(r.cond_margin)} ± ${r.cond_sd.toFixed(1)}</span>`;
    tr.append(n);
    const m = el('td', 'num'); m.innerHTML = fmtMove(r.cond_p - r.forecast_p); tr.append(m);
    const cnt = el('td', 'num');
    cnt.innerHTML = r.margin == null ? '—'
      : r.eevp < results.eevp_min ? `<span class="tip-dim">${fmtMargin(r.margin)}</span>` : fmtMargin(r.margin);
    tr.append(cnt);
    tr.append(el('td', 'num', `${r.eevp.toFixed(0)}%`));
  }
  const note = el('p', 'chart-note');
  note.innerHTML = `The ${shown.length} uncalled races that moved most, in points of win probability. `
    + `<b>Now</b> is the conditional mean margin and its remaining standard deviation; a race mostly counted `
    + `has little left, a race with no votes in moves only through what it shares with the ones that have.`;
  host.append(note);
}

// ---- the shared error --------------------------------------------------------

function swingTable(sw, eevp) {
  const t = el('table', 'plain night-swing-table');
  const h = t.createTHead().insertRow();
  for (const x of ['Races', `Mostly counted (≥${eevp.tight}% in)`, `Counted (≥${eevp.loose}% in)`]) {
    h.append(el('th', null, x));
  }
  const body = t.createTBody();
  const row = (label, a, b) => {
    const r = body.insertRow();
    r.append(el('td', null, label));
    for (const s of [a, b]) {
      const c = el('td', 'num');
      c.innerHTML = s && s.n
        ? `<b>${fmtResid(s.mean)}</b> <span class="tip-dim">± ${s.se == null ? '—' : s.se.toFixed(1)}, n=${s.n}</span>`
        : '<span class="tip-dim">none yet</span>';
      r.append(c);
    }
  };
  row('All', sw.tight, sw.all);
  for (const ch of ['senate', 'house', 'governor']) {
    const loose = sw.by_chamber[ch];
    if (!loose || !loose.n) continue;
    // The tight set is only published overall; re-derived per chamber by the caller.
    row(chamberName(ch), sw.by_chamber_tight ? sw.by_chamber_tight[ch] : null, loose);
  }
  return t;
}

// Per-chamber means at the tight threshold, from the race rows. The engine ships
// the tight set overall; splitting it here keeps the payload honest to one
// definition and the table honest to one number per cell.
function tightByChamber(results) {
  const out = {};
  for (const r of results.races) {
    if (r.margin == null || r.eevp < 90 || r.uncontested || r.forecast_margin == null) continue;
    (out[r.chamber] ||= []).push(r.margin - r.forecast_margin);
  }
  const stat = v => {
    const n = v.length, mean = d3.mean(v);
    const sd = n > 1 ? d3.deviation(v) : null;
    return { n, mean, se: sd == null ? null : sd / Math.sqrt(n) };
  };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, stat(v)]));
}

export function nightSwing(host, { results, forecast, sigma, onPick }) {
  host.replaceChildren();
  const sw = { ...results.swing, by_chamber_tight: tightByChamber(results) };
  const eevp = { loose: results.eevp_min, tight: 90 };
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));

  const read = el('p', 'night-lede');
  const t = sw.tight, a = sw.all;
  if (!a.n) {
    read.innerHTML = `<b>No race is ${eevp.loose}% counted yet.</b> The shared error is read only from `
      + `races that are mostly in; early returns say which precincts count first, not how the `
      + `electorate voted.`;
    host.append(read);
    return;
  }
  const s = t.n ? t : a;
  const z = s.mean / sigma.nat;
  read.innerHTML =
    `Across the <b>${s.n}</b> races at least ${t.n ? eevp.tight : eevp.loose}% counted, the margin is running `
    + `<b>${fmtResid(s.mean)}</b> against the forecast (median ${fmtResid(s.median)}, `
    + `standard error ${s.se == null ? '—' : s.se.toFixed(1)}). The model priced the shared error at a `
    + `standard deviation of <b>${sigma.nat.toFixed(1)}</b> points, so that is `
    + `<b>${Math.abs(z).toFixed(1)} sigma</b> ${z > 0 ? 'toward the Democrats' : z < 0 ? 'toward the Republicans' : ''}`
    + ` — if it holds as the count completes.`;
  host.append(read);
  host.append(swingTable(sw, eevp));

  // The bell: the model's shared-error distribution, and where the night sits on it.
  const W = 460, H = 150, m = { t: 12, r: 14, b: 30, l: 14 };
  const lim = Math.max(12, Math.ceil(Math.abs(a.mean) + 2));
  const x = d3.scaleLinear().domain([-lim, lim]).range([m.l, W - m.r]);
  const pdf = v => Math.exp(-0.5 * (v / sigma.nat) ** 2) / (sigma.nat * Math.sqrt(2 * Math.PI));
  const y = d3.scaleLinear().domain([0, pdf(0) * 1.08]).range([H - m.b, m.t]);
  const g = svg(host, W, H, 'Where tonight sits on the model’s shared error');
  g.node().parentNode.style.maxWidth = `${W + 60}px`;
  const pts = d3.range(-lim, lim + 0.01, 0.25).map(v => [x(v), y(pdf(v))]);
  g.append('path').attr('d', d3.area().x(d => d[0]).y0(H - m.b).y1(d => d[1])(pts))
    .attr('fill', C.surface).attr('stroke', C.line);
  g.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t).attr('y2', H - m.b)
    .attr('stroke', C.muted).attr('stroke-dasharray', '3 3');
  g.append('text').attr('x', x(0)).attr('y', H - m.b + 14).attr('text-anchor', 'middle')
    .attr('fill', C.muted).attr('font-size', 10).text('forecast');
  for (const v of [-lim + 2, lim - 2]) {
    g.append('text').attr('x', x(v)).attr('y', H - m.b + 14).attr('text-anchor', 'middle')
      .attr('fill', C.muted).attr('font-size', 10).text(fmtResid(v));
  }
  const mark = (s2, col, label, dy) => {
    if (!s2 || !s2.n) return;
    const mx = x(Math.max(-lim, Math.min(lim, s2.mean)));
    g.append('line').attr('x1', mx).attr('x2', mx).attr('y1', m.t + dy).attr('y2', H - m.b)
      .attr('stroke', col).attr('stroke-width', 2);
    g.append('text').attr('x', mx + (s2.mean >= 0 ? 6 : -6)).attr('y', m.t + dy + 10)
      .attr('text-anchor', s2.mean >= 0 ? 'start' : 'end').attr('fill', col).attr('font-size', 11)
      .text(`${label}: ${fmtResid(s2.mean)} (n=${s2.n})`);
  };
  mark(a, C.muted, `≥${eevp.loose}% in`, 22);
  mark(t, t.mean >= 0 ? C.dem : C.rep, `≥${eevp.tight}% in`, 0);

  // The scatter: every mostly-counted race, forecast against count. The whole
  // cloud sitting above or below the line IS the shared error.
  const rows = results.races.filter(r => r.margin != null && r.eevp >= eevp.loose
                                         && !r.uncontested && r.forecast_margin != null);
  const SW = 460, SH = 360, sm = { t: 14, r: 14, b: 40, l: 46 };
  const ext = d3.max(rows, r => Math.max(Math.abs(r.margin), Math.abs(r.forecast_margin))) || 20;
  const dom = [-Math.min(45, Math.ceil(ext + 2)), Math.min(45, Math.ceil(ext + 2))];
  const sx = d3.scaleLinear().domain(dom).range([sm.l, SW - sm.r]);
  const sy = d3.scaleLinear().domain(dom).range([SH - sm.b, sm.t]);
  const sg = svg(host, SW, SH, 'Counted margin against forecast margin, race by race');
  sg.node().parentNode.style.maxWidth = `${SW + 60}px`;
  sg.append('g').selectAll('line').data(sx.ticks(6)).join('line')
    .attr('x1', sx).attr('x2', sx).attr('y1', sm.t).attr('y2', SH - sm.b).attr('stroke', C.line);
  sg.append('g').selectAll('line').data(sy.ticks(6)).join('line')
    .attr('y1', sy).attr('y2', sy).attr('x1', sm.l).attr('x2', SW - sm.r).attr('stroke', C.line);
  sg.append('line').attr('x1', sx(dom[0])).attr('y1', sy(dom[0])).attr('x2', sx(dom[1])).attr('y2', sy(dom[1]))
    .attr('stroke', C.muted).attr('stroke-dasharray', '4 3');
  sg.append('g').selectAll('text').data(sx.ticks(6)).join('text')
    .attr('x', sx).attr('y', SH - sm.b + 14).attr('text-anchor', 'middle').attr('fill', C.muted)
    .attr('font-size', 10).text(fmtResid);
  sg.append('g').selectAll('text').data(sy.ticks(6)).join('text')
    .attr('x', sm.l - 6).attr('y', d => sy(d) + 3).attr('text-anchor', 'end').attr('fill', C.muted)
    .attr('font-size', 10).text(fmtResid);
  sg.append('text').attr('x', (sm.l + SW - sm.r) / 2).attr('y', SH - 6).attr('text-anchor', 'middle')
    .attr('fill', C.muted).attr('font-size', 11).text('forecast margin');
  sg.append('text').attr('transform', `translate(12,${(sm.t + SH - sm.b) / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle').attr('fill', C.muted).attr('font-size', 11).text('counted margin');
  const shape = { senate: d3.symbolDiamond, governor: d3.symbolSquare, house: d3.symbolCircle };
  sg.append('g').selectAll('path').data(rows).join('path')
    .attr('d', r => d3.symbol().type(shape[r.chamber] || d3.symbolCircle).size(r.chamber === 'house' ? 34 : 60)())
    .attr('transform', r => `translate(${sx(Math.max(dom[0], Math.min(dom[1], r.forecast_margin)))},`
                            + `${sy(Math.max(dom[0], Math.min(dom[1], r.margin)))})`)
    .attr('fill', r => (r.margin - r.forecast_margin >= 0 ? C.dem : C.rep))
    .attr('fill-opacity', r => (r.eevp >= eevp.tight ? 0.9 : 0.35))
    .attr('stroke', r => (r.called ? C.ink : 'none')).attr('stroke-width', 0.8)
    .style('cursor', 'pointer')
    .on('pointermove', (e, r) => showTip(e,
      `<b>${esc(r.race_id)}</b> · ${r.eevp.toFixed(0)}% in${r.called ? ' · called' : ''}<br>`
      + `counted ${fmtMargin(r.margin)} · forecast ${fmtMargin(r.forecast_margin)}<br>`
      + `<span class="tip-dim">${fmtResid(r.margin - r.forecast_margin)} against the forecast</span>`))
    .on('pointerleave', hideTip)
    .on('click', (e, r) => onPick && onPick(byId.get(r.race_id)));
  const note = el('p', 'chart-note');
  note.innerHTML = `Circles House, diamonds Senate, squares governors; solid at ≥${eevp.tight}% counted, faint `
    + `between ${eevp.loose}% and ${eevp.tight}%; outlined once called. Blue sits above the line (more `
    + `Democratic than forecast), red below. The ${sw.by_region ? 'regional' : ''} shared-error term is `
    + `the <em>whole cloud</em> moving off the line together; one dot off it is that race's own error.`;
  host.append(note);

  const reg = Object.entries(sw.by_region || {}).filter(([, v]) => v.n).sort((a, b) => b[1].n - a[1].n);
  if (reg.length > 1) {
    const rt = el('table', 'plain');
    const h = rt.createTHead().insertRow();
    for (const x2 of ['Region', `Against forecast (≥${eevp.loose}% in)`, 'Races']) h.append(el('th', null, x2));
    const body = rt.createTBody();
    for (const [name, v] of reg) {
      const r = body.insertRow();
      r.append(el('td', null, name));
      const c = el('td', 'num'); c.innerHTML = `<b>${fmtResid(v.mean)}</b>`; r.append(c);
      r.append(el('td', 'num', String(v.n)));
    }
    host.append(rt);
  }
}

// ---- tables ------------------------------------------------------------------

function table(host, cols) {
  const wrap = el('div', 'table-wrap');
  const t = el('table', 'races night-table');
  const h = t.createTHead().insertRow();
  for (const c of cols) {
    const th = el('th', c.num ? 'num' : null, c.label);
    h.append(th);
  }
  wrap.append(t);
  host.append(wrap);
  return t.createTBody();
}

function resultCell(r, race) {
  const side = r.winner === 'OTHER' ? 'third' : SIDE[sideOf(race, r.winner)].short;
  const col = r.winner === 'D' ? C.dem : r.winner === 'R' ? C.rep : C.accent;
  return `<b style="color:${col}">${esc(side)}</b> ${esc(r.winner_name || '')}`
    + (r.margin != null && r.eevp >= 30 ? ` <span class="tip-dim">${fmtMargin(r.margin)}, ${r.eevp.toFixed(0)}% in</span>`
                                         : ` <span class="tip-dim">${r.eevp.toFixed(0)}% in</span>`);
}

export function nightCalls(host, { results, forecast, onPick }) {
  host.replaceChildren();
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  const rows = results.races.filter(r => r.called).sort((a, b) => a.p_winner - b.p_winner
                                                                  || (b.called_at || '').localeCompare(a.called_at || ''));
  if (!rows.length) {
    host.append(el('p', 'chart-note', 'Nothing called yet.'));
    return;
  }
  const body = table(host, [{ label: 'Race' }, { label: 'Forecast', num: true }, { label: 'Result' },
                            { label: 'Verdict' }, { label: 'Called', num: true }]);
  for (const r of rows) {
    const race = byId.get(r.race_id);
    const tr = body.insertRow();
    tr.tabIndex = 0;
    tr.onclick = () => onPick && onPick(race);
    tr.append(el('td', null, r.race_id));
    const f = el('td', 'num');
    const dside = SIDE[sideOf(race, 'D')].short;
    f.innerHTML = `${dside} ${fmtPct(r.forecast_p, 0)} <span class="tip-dim">${fmtMargin(r.forecast_margin)}</span>`;
    tr.append(f);
    const res = el('td'); res.innerHTML = resultCell(r, race); tr.append(res);
    const v = el('td');
    v.innerHTML = r.upset
      ? `<b style="color:${C.rep}">upset</b> <span class="tip-dim">model gave it ${fmtPct(r.p_winner, 0)}</span>`
      : r.informative ? `<span style="color:${C.dem}">right</span> <span class="tip-dim">at ${fmtPct(r.p_winner, 0)}</span>`
                      : `<span class="tip-dim">never in doubt</span>`;
    tr.append(v);
    tr.append(el('td', 'num', stamp(r.called_at)));
  }
}

export function nightCounting(host, { results, forecast, onPick }) {
  host.replaceChildren();
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  const b = results.ballots;
  const rows = results.races.filter(r => !r.called && r.total_votes > 0);
  if (!rows.length) {
    host.append(el('p', 'chart-note', 'No uncalled race has votes in yet.'));
    return;
  }
  if (!b || !b.available) {
    host.append(el('p', 'chart-note', `The ballot reading is not available: ${b && b.why ? b.why : 'the payload carries none'}.`));
  }
  // Recount questions first, then the open races closest to even, then the
  // ones the count has settled; races the ballots cannot read yet sit with the
  // open ones, by the conditional's number.
  const rank = { recount: 0, open: 1, decided: 2 };
  const pNow = r => r.live_p ?? r.cond_p ?? r.forecast_p;
  rows.sort((a, c) => (rank[a.verdict] ?? 1) - (rank[c.verdict] ?? 1)
                      || Math.abs(pNow(a) - 0.5) - Math.abs(pNow(c) - 0.5));
  const body = table(host, [{ label: 'Race' }, { label: 'Forecast', num: true }, { label: 'Counted', num: true },
                            { label: 'Lead', num: true }, { label: 'Still out', num: true }, { label: 'Needs', num: true },
                            { label: 'Late ballots', num: true }, { label: 'Now', num: true }, { label: 'Verdict' }]);
  const n = v => (v == null ? '—' : Math.abs(v).toLocaleString());
  for (const r of rows) {
    const race = byId.get(r.race_id);
    const tr = body.insertRow();
    tr.tabIndex = 0;
    tr.onclick = () => onPick && onPick(race);
    tr.append(el('td', null, r.race_id + (r.rcv ? ' ·RCV' : '')));
    const dside = SIDE[sideOf(race, 'D')].short;
    const f = el('td', 'num');
    f.innerHTML = `${dside} ${fmtPct(r.forecast_p, 0)} <span class="tip-dim">${fmtMargin(r.forecast_margin)}</span>`;
    tr.append(f);
    const c = el('td', 'num');
    c.innerHTML = r.margin == null ? '—'
      : `${r.eevp < results.eevp_min ? `<span class="tip-dim">${fmtMargin(r.margin)}</span>` : `<b>${fmtMargin(r.margin)}</b>`}`
        + ` <span class="tip-dim">${r.eevp.toFixed(0)}% in</span>`;
    tr.append(c);
    const fromBallots = r.live_src === 'ballots' && r.live_p != null;
    const lead = el('td', 'num');
    lead.innerHTML = r.gap == null ? '—'
      : `<span style="color:${r.gap > 0 ? C.dem : r.gap < 0 ? C.rep : C.muted}">${r.gap > 0 ? 'D' : r.gap < 0 ? 'R' : ''}</span> ${n(r.gap)}`;
    tr.append(lead);
    const out = el('td', 'num');
    out.innerHTML = r.pool == null ? '—'
      : r.capped ? `<span class="tip-dim">AP says done</span>` : n(r.pool);
    tr.append(out);
    const need = el('td', 'num');
    need.innerHTML = r.to_tie == null || r.capped ? '<span class="tip-dim">—</span>'
      : Math.abs(r.to_tie) > 100 ? `<span class="tip-dim">more than there is</span>` : fmtMargin(r.to_tie);
    tr.append(need);
    const late = el('td', 'num');
    late.innerHTML = r.late_lean == null ? '<span class="tip-dim">—</span>' : fmtMargin(r.late_lean);
    tr.append(late);
    const now = el('td', 'num');
    const p = pNow(r);
    now.innerHTML = p == null ? '—'
      : `<b>${dside} ${fmtPct(p, 0)}</b> <span class="tip-dim">${fromBallots ? 'ballots' : 'conditional'}</span>`;
    tr.append(now);
    const v = el('td');
    const leader = r.gap > 0 ? SIDE[sideOf(race, 'D')].short : r.gap < 0 ? SIDE[sideOf(race, 'R')].short : '';
    v.innerHTML = !r.verdict ? '<span class="tip-dim">no reading</span>'
      : !fromBallots ? `<span class="vd">too early</span>`
      : r.verdict === 'recount' ? `<span class="vd recount">recount</span>`
      : r.verdict === 'decided' ? `<span class="vd">decided</span> <span class="tip-dim">${esc(leader)}</span>`
      : `<span class="vd open">open</span>`;
    tr.append(v);
  }
  const note = el('p', 'chart-note');
  note.innerHTML = `${rows.length} uncalled races with votes in. <b>Lead</b> is in ballots; <b>still out</b> is AP's `
    + `remainder before the correction described above; <b>needs</b> is what the rest would have to run for the `
    + `trailer to tie. <b>Late ballots</b> is the lean of those counted after 70% of the vote was in`
    + (b && b.available ? `: across the ${b.late_n} finished races tonight the ballots after 93% in ran `
      + `${b.late_sd.toFixed(0)} points either side of the running margin, and the earlier late lean predicted `
      + `them with a correlation of ${b.persistence == null ? '—' : b.persistence.toFixed(2)}, so it widens the `
      + `reading more than it moves it. A lead under ${(b.recount * 100).toFixed(1)}% of the count on a nearly `
      + `complete count is a recount question; the reading is from the ballots once ${b.firm.toFixed(0)}% is in.` : '.')
    + ` Ranked-choice races (·RCV) show first choices until the tabulation runs.`;
  host.append(note);
}

// ---- the record books --------------------------------------------------------
//
// Historical ladders for tonight's expected finish to climb (docs/data/milestones.json,
// built by engine/dashboard/milestones.py from the party-division tables). Each
// ladder is the set of past levels that were a running maximum going back from
// today, so the rungs a number has passed are the years it now beats, and the
// first rung it has not passed names the year it is "the most since".
//
// Drawn as a ladder, not a ruler: rungs top to bottom with the value in large
// type and the year beside it, tonight's row inserted at its height. A ruler put
// nine labels on one line and they overprinted; a list has a line per rung.
function ladderRead(rungs, value) {
  const passed = rungs.filter(r => r.value <= value);
  const next = rungs.find(r => r.value > value) || null;
  // "The most since 1982" means 1982 was the last time it was higher: the first
  // rung tonight has NOT passed, not the last one it has.
  return { passed, next, since: next };
}

const yearOf = label => label.replace(/^after /, '');

function ladderList(host, { rungs, value, range, fmt, unit, title, above = 3, below = 3 }) {
  const col = el('div', 'ladder');
  col.append(el('div', 'ladder-title', title));
  const ul = el('ol', 'ladder-rungs');
  const idx = rungs.findIndex(r => r.value > value);           // first rung above tonight
  const firstAbove = idx < 0 ? rungs.length : idx;
  const hiRows = rungs.slice(firstAbove, firstAbove + above).reverse();
  const loRows = rungs.slice(Math.max(0, firstAbove - below), firstAbove).reverse();
  const more = rungs.length - firstAbove - above;
  if (more > 0) ul.append(el('li', 'ladder-more', `${more} higher rung${more === 1 ? '' : 's'} above`));
  hiRows.forEach((r, i) => {
    const li = el('li', 'ladder-row above');
    const gap = r.value - value;
    li.innerHTML = `<span class="lv">${fmt(r.value)}</span><span class="ll">${esc(r.label)}</span>`
      + `<span class="ls">${i === hiRows.length - 1 ? `next · ${fmt(gap)} to go` : `${fmt(gap)} above`}</span>`;
    if (i === hiRows.length - 1) li.classList.add('next');
    ul.append(li);
  });
  const me = el('li', 'ladder-row tonight');
  me.innerHTML = `<span class="lv">${fmt(value)}</span><span class="ll">tonight</span>`
    + `<span class="ls">${range ? `80% range ${fmt(range[0])}–${fmt(range[1])}` : ''}</span>`;
  ul.append(me);
  loRows.forEach(r => {
    const li = el('li', 'ladder-row passed');
    li.innerHTML = `<span class="lv">${fmt(r.value)}</span><span class="ll">${esc(r.label)}</span>`
      + `<span class="ls">${r.value === value ? 'tied' : 'passed'}</span>`;
    ul.append(li);
  });
  const left = Math.max(0, firstAbove - below);
  if (left > 0) ul.append(el('li', 'ladder-more', `${left} lower rung${left === 1 ? '' : 's'} passed`));
  col.append(ul);
  host.append(col);
}

export function nightLadders(host, { results, forecast, milestones }) {
  host.replaceChildren();
  const cond = results.conditional && results.conditional.available ? results.conditional : null;
  if (!milestones || !cond) {
    host.append(el('p', 'chart-note', milestones ? 'No re-read yet.' : 'The milestone ladders have not been built.'));
    return;
  }
  const base = milestones.baseline;
  const lad = milestones.ladders;
  const signed = v => (v > 0 ? `+${v}` : String(v));
  for (const ch of ['senate', 'house', 'governor']) {
    const g = cond.control[ch];
    const notUp = ch === 'governor' ? base.governor - base.governor_up_d : 0;
    const seats = Math.round(g.median) + notUp;
    const gain = seats - base[ch];
    const name = ch === 'governor' ? 'Democratic governors' : `Democratic ${chamberName(ch)} seats`;
    const card = el('div', 'night-ladder');
    host.append(card);
    card.append(el('div', 'pc-h', chamberName(ch)));

    const sR = ladderRead(lad[ch].seats, seats);
    const gR = ladderRead(lad[ch].gain, gain);
    const any = lad[ch].gain_any ? ladderRead(lad[ch].gain_any, gain) : null;
    const cap = el('p', 'night-lede');
    cap.innerHTML = `<b style="color:${EXPECT}">${seats}</b> ${name}`
      + (ch === 'governor' ? ` <span class="tip-dim">(${Math.round(g.median)} of the 36 on the ballot, plus ${notUp} not up)</span>` : '')
      + (sR.since ? `, the most since <b>${esc(yearOf(sR.since.label))}</b>` : ', more than in any year on record')
      + `. A midterm gain of <b style="color:${EXPECT}">${signed(gain)}</b>`
      + (gain <= 0 ? '' : gR.since ? `, the largest Democratic midterm gain since <b>${esc(gR.since.label)}</b>`
                                  : ', the largest Democratic midterm gain on record')
      + (gain <= 0 || !any ? '' : any.since ? ` and the largest by either party since <b>${esc(any.since.label)}</b>`
                                            : ' and the largest by either party on record') + '.';
    card.append(cap);

    const grid = el('div', 'ladder-grid');
    card.append(grid);
    ladderList(grid, { rungs: lad[ch].seats, value: seats, range: [g.p10 + notUp, g.p90 + notUp],
                       fmt: v => String(v), title: `${name}: the most since`,
                       unit: ch === 'governor' ? 'governors' : 'seats' });
    const gainRungs = lad[ch].gain_any
      // One ladder, both parties: the either-party rungs, with the Democratic-only
      // rungs they coincide with named as such.
      ? mergeGainRungs(lad[ch].gain, lad[ch].gain_any) : lad[ch].gain;
    ladderList(grid, { rungs: gainRungs, value: gain, range: [g.p10 + notUp - base[ch], g.p90 + notUp - base[ch]],
                       fmt: signed, title: 'Midterm gain: the largest since', unit: 'seats' });
  }
  const note = el('p', 'chart-note');
  note.innerHTML = `Rungs are every past level that beat everything after it, so the rungs below tonight are the years it `
    + `now beats and the first rung above is the year it is "the most since". Seats are counted at the seating of `
    + `each Congress, with independents who caucus with the Democrats included. Gains are the Democratic change in `
    + `a midterm; a rung marked (R) is a Republican gain of that size. `
    + `Sources: ${milestones.sources.map(s => esc(s.split(' (')[0])).join('; ')}.`;
  host.append(note);
}

// The either-party gain ladder already contains every Democratic rung that is a
// high-water mark for both; a Democratic rung the Republicans beat later is kept
// too, marked (D), so the ladder reads as one list.
function mergeGainRungs(dem, any) {
  const seen = new Set(any.map(r => r.value));
  const extra = dem.filter(r => !seen.has(r.value)).map(r => ({ ...r, label: `${r.label} (D)` }));
  return [...any, ...extra].sort((a, b) => a.value - b.value);
}

// ---- upsets, by size and certainty ------------------------------------------
//
// Part of the tug of war: the races pulling against the forecast, each its own
// block as on the seat strip. A race is here when the re-read gives the side the
// forecast did NOT favour at least a one-in-five chance, or when a call has gone
// that way. Two things about each race matter and both are drawn:
//
//   size       how confident the forecast was in the side now losing -- the width
//   certainty  how sure the re-read is that the upset holds, with the count's
//              weight already in it -- the strength; a call is solid and ringed
//
// Democratic upsets build from the left edge, Republican from the right, biggest
// expected surprise (size x certainty) at the outer ends: the ones pulling hardest.
const UPSET = { W: 920, H: 44, minP: 0.2, perSide: 24 };

export function upsetCandidates(results, forecast) {
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  const out = [];
  for (const r of results.races) {
    if (r.uncontested || r.forecast_p == null) continue;
    const race = byId.get(r.race_id);
    const favD = r.forecast_p >= 0.5;
    const size = Math.max(r.forecast_p, 1 - r.forecast_p);           // forecast confidence in the favourite
    let pUp, side, status;
    if (r.called) {
      if (r.winner === 'OTHER') { pUp = 1; side = 'IND'; status = 'called'; }
      else if ((r.winner === 'D') === favD) continue;                  // favourite won
      else { pUp = 1; side = r.winner; status = 'called'; }
    } else {
      const pNow = r.live_p ?? r.cond_p ?? r.forecast_p;
      pUp = favD ? 1 - pNow : pNow;
      side = favD ? 'R' : 'D';
      status = pUp >= 0.5 ? 'leading' : 'possible';
    }
    if (pUp < UPSET.minP) continue;
    out.push({ ...r, race, favD, size, pUp, side, status, score: pUp * size,
               sideLabel: side === 'IND' ? 'IND' : SIDE[sideOf(race, side)].short });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Which chambers the upsets view shows. Module state, so the choice survives
// the repaint every tick brings; the chips re-render the panel in place.
const upsetFilter = { house: true, senate: true, governor: true };

export function nightUpsets(host, opts) {
  const { results, forecast, onPick } = opts;
  host.replaceChildren();
  const everything = upsetCandidates(results, forecast);
  const head = el('div', 'night-hold');
  head.append(el('h4', 'wl-h', 'Upsets, by size and certainty'));
  const chips = el('div', 'toggle');
  chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Chambers shown');
  for (const ch of ['house', 'senate', 'governor']) {
    const n = everything.filter(u => u.chamber === ch).length;
    const btn = el('button', upsetFilter[ch] ? 'on' : '', `${chamberName(ch)} (${n})`);
    btn.setAttribute('aria-pressed', String(upsetFilter[ch]));
    btn.onclick = () => { upsetFilter[ch] = !upsetFilter[ch]; nightUpsets(host, opts); };
    chips.append(btn);
  }
  head.append(chips);
  host.append(head);
  const all = everything.filter(u => upsetFilter[u.chamber]);
  if (!all.length) {
    host.append(el('p', 'chart-note', everything.length
      ? 'Nothing in the chambers selected.'
      : 'Nothing is pulling against the forecast yet: no call has gone against the favourite and no uncalled '
        + 'race gives the other side one chance in five.'));
    return;
  }
  const left = all.filter(u => u.side === 'D').slice(0, UPSET.perSide);
  const right = all.filter(u => u.side !== 'D').slice(0, UPSET.perSide);
  const fillOf = u => (u.side === 'D' ? C.dem : u.side === 'R' ? C.rep : C.accent);
  const tip = u => `<b>${esc(u.race_id)}</b> · ${u.status === 'called' ? 'called' : u.status === 'leading' ? 'leading' : 'possible'} upset<br>`
    + `forecast favoured ${u.favD ? 'D' : 'R'} at ${fmtPct(u.size, 0)} · now ${esc(u.sideLabel)} ${fmtPct(u.pUp, 0)}`
    + (u.margin != null && u.eevp >= 20 ? `<br><span class="tip-dim">counted ${fmtMargin(u.margin)}, ${u.eevp.toFixed(0)}% in</span>`
                                         : `<br><span class="tip-dim">${u.eevp.toFixed(0)}% in</span>`);
  // Every block the same size and readable: the race on one line, what the
  // forecast had for the side now losing on the next. Strength is certainty.
  const strip = el('div', 'upset-strip');
  const side = (list, cls, label) => {
    const col = el('div', `upset-side ${cls}`);
    col.append(el('div', 'upset-side-label', label));
    const wrap = el('div', 'upset-blocks');
    for (const u of list) {
      const b = el('button', `upset-block${u.status === 'called' ? ' called' : ''}`);
      b.style.background = fillOf(u);
      b.style.opacity = String(0.35 + 0.65 * u.pUp);
      b.innerHTML = `<span class="ub-id">${esc(u.race_id)}</span>`
        + `<span class="ub-fc">had ${u.favD ? 'D' : 'R'} ${fmtPct(u.size, 0)}</span>`;
      b.onpointermove = e => showTip(e, tip(u));
      b.onpointerleave = hideTip;
      b.onclick = () => onPick && onPick(u.race);
      wrap.append(b);
    }
    if (!list.length) wrap.append(el('span', 'tip-dim', 'none'));
    col.append(wrap);
    strip.append(col);
  };
  side(left, 'dem', `Democratic upsets (${left.length})`);
  side(right, 'rep', `Republican upsets (${right.length})`);
  host.append(strip);

  // The ranked list behind the strip.
  const body = table(host, [{ label: 'Race' }, { label: 'Forecast', num: true }, { label: 'Now', num: true },
                            { label: 'Counted', num: true }, { label: 'Status' }, { label: 'Expected surprise', num: true }]);
  for (const u of all.slice(0, 15)) {
    const tr = body.insertRow();
    tr.tabIndex = 0;
    tr.onclick = () => onPick && onPick(u.race);
    tr.append(el('td', null, u.race_id));
    const f = el('td', 'num');
    f.innerHTML = `${u.favD ? SIDE[sideOf(u.race, 'D')].short : SIDE[sideOf(u.race, 'R')].short} ${fmtPct(u.size, 0)} `
      + `<span class="tip-dim">${fmtMargin(u.forecast_margin)}</span>`;
    tr.append(f);
    const n = el('td', 'num');
    n.innerHTML = `<b style="color:${fillOf(u)}">${esc(u.sideLabel)} ${fmtPct(u.pUp, 0)}</b>`;
    tr.append(n);
    const c = el('td', 'num');
    c.innerHTML = u.margin == null ? '—' : `${fmtMargin(u.margin)} <span class="tip-dim">${u.eevp.toFixed(0)}% in</span>`;
    tr.append(c);
    const st = el('td');
    st.innerHTML = u.status === 'called' ? `<b style="color:${C.accent}">called</b>`
      : u.status === 'leading' ? 'leading' : '<span class="tip-dim">possible</span>';
    tr.append(st);
    const sc = el('td', 'num'); sc.innerHTML = `<b>${fmtPct(u.score, 0)}</b>`; tr.append(sc);
  }
  const note = el('p', 'chart-note');
  note.innerHTML = `Each block is one race pulling against the forecast, biggest expected surprise first. The small line `
    + `is what the forecast gave the side now losing; <b>strength</b> is how sure the re-read is that the upset holds, `
    + `the count's weight included; a call is framed in gold. <b>Expected surprise</b> ranks everything: that certainty `
    + `times that forecast confidence, `
    + `so a sure modest upset and a possible huge one can sit side by side. Races where the other side has under one `
    + `chance in five are left out.`;
  host.append(note);
}

// ---- the race list drawer -----------------------------------------------------
//
// A click on any chunk of the tug-of-war bars opens the races behind it in the
// right-hand drawer, one row per race with the forecast, the re-read, the count
// and the status. A row opens the race's own drawer.
export function raceList({ title, ids, results, forecast, onPick }) {
  const host = document.getElementById('night-list');
  if (!host) return;
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  const res = new Map(results.races.map(r => [r.race_id, r]));
  const rows = ids.map(id => ({ r: res.get(id), f: byId.get(id) })).filter(x => x.r && x.f);
  // Closest to even first: the ones worth a look.
  rows.sort((a, b) => Math.abs((a.r.live_p ?? a.r.cond_p ?? a.r.forecast_p) - 0.5) - Math.abs((b.r.live_p ?? b.r.cond_p ?? b.r.forecast_p) - 0.5));
  host.replaceChildren();
  const inner = el('div', 'drawer-inner');
  const close = el('button', 'drawer-close', '×');
  close.setAttribute('aria-label', 'Close');
  close.onclick = () => { host.hidden = true; };
  inner.append(close);
  inner.append(el('h3', null, title));
  inner.append(el('p', 'night-progress-cap', `${rows.length} race${rows.length === 1 ? '' : 's'}. Closest first. Click a race for its own page.`));
  const body = table(inner, [{ label: 'Race' }, { label: 'Candidates' }, { label: 'Forecast', num: true }, { label: 'Now', num: true },
                             { label: 'Counted', num: true }, { label: 'Status' }]);
  for (const { r, f } of rows) {
    const tr = body.insertRow();
    tr.tabIndex = 0;
    tr.onclick = () => { host.hidden = true; onPick && onPick(f); };
    tr.append(el('td', null, r.race_id));
    const who = el('td');
    who.innerHTML = `<span style="color:${C.dem}">${esc(r.d_name || '—')}</span> <span class="tip-dim">v</span> <span style="color:${C.rep}">${esc(r.r_name || '—')}</span>`;
    tr.append(who);
    const dside = SIDE[sideOf(f, 'D')].short;
    const fc = el('td', 'num'); fc.innerHTML = `${dside} ${fmtPct(r.forecast_p, 0)} <span class="tip-dim">${fmtMargin(r.forecast_margin)}</span>`; tr.append(fc);
    const now = el('td', 'num');
    const pNow = r.called ? (r.winner === 'D' ? 1 : r.winner === 'R' ? 0 : null) : (r.live_p ?? r.cond_p ?? r.forecast_p);
    now.innerHTML = pNow == null ? '—' : `<b>${dside} ${fmtPct(pNow, 0)}</b>` + (!r.called ? ` <span class="tip-dim">${r.live_src === 'ballots' ? 'ballots' : fmtMargin(r.cond_margin)}</span>` : '');
    tr.append(now);
    const cnt = el('td', 'num');
    cnt.innerHTML = r.margin == null ? '—' : `${fmtMargin(r.margin)} <span class="tip-dim">${r.eevp.toFixed(0)}% in</span>`;
    tr.append(cnt);
    const st = el('td');
    st.innerHTML = r.called
      ? `<b style="color:${r.winner === 'D' ? C.dem : r.winner === 'R' ? C.rep : C.accent}">called</b>${r.upset ? ` <span style="color:${C.accent}">upset</span>` : ''}`
        + (r.winner_name ? ` <span class="tip-dim">${esc(r.winner_name)}</span>` : '')
      : r.leader ? `leading: <span style="color:${r.leader === 'D' ? C.dem : r.leader === 'R' ? C.rep : C.accent}">${esc(r.leader === 'OTHER' ? 'third' : SIDE[sideOf(f, r.leader)].short)}</span>` : '<span class="tip-dim">no votes yet</span>';
    tr.append(st);
  }
  host.append(inner);
  host.hidden = false;
  if (!raceList._esc) {
    raceList._esc = true;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') host.hidden = true; });
  }
}
