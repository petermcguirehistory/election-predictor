// What happened: the returns, read against the 2024 presidential vote in the
// same places once they are mostly counted (engine/ingest/results.py `after`).
//
//   afterShift    bluer or redder than 2024 -- how many races moved which way
//                 and by how much, for every chamber and every state, and which
//                 moved most.
//   afterTurnout  who turned out -- the share of the 2024 presidential vote that
//                 came back, in the districts each side carried, by state against
//                 the last midterm as well, and whether the places that lost the
//                 most voters are the ones that moved.
//
// The baseline is the presidential vote because it is the one every race has on
// the 2026 lines. A midterm electorate is smaller than a presidential one, so
// the shift is partly who turned out and partly who changed their mind; the
// turnout panel is there to let a reader tell the two apart.
import d3 from '../d3.js';
import { C, svg, showTip, hideTip, fmtMargin, chamberName } from '../charts/util.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const fmtShift = v => (v == null ? '—' : v > 0 ? `D+${v.toFixed(1)}` : v < 0 ? `R+${(-v).toFixed(1)}` : 'even');
const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
const num = v => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const tickShift = t => (t === 0 ? 'even' : `${t > 0 ? 'D' : 'R'}+${Math.abs(t)}`);
const SHAPE = { house: d3.symbolCircle, senate: d3.symbolDiamond, governor: d3.symbolSquare };
const ORDER = ['house', 'senate', 'governor'];

function lede(host, html) { const p = el('p', 'night-lede'); p.innerHTML = html; host.append(p); return p; }
function note(host, html) { const p = el('p', 'chart-note'); p.innerHTML = html; host.append(p); return p; }
function h4(host, text) { host.append(el('h4', 'wl-h', text)); }

function cards(host, items) {
  const c = el('div', 'toplines night-cards');
  for (const [label, value, sub, color] of items) {
    const t = el('div', 'topline night-card');
    t.append(el('div', 'chamber', label));
    const v = el('div', 'prob', value);
    if (color) v.style.color = color;
    t.append(v);
    if (sub) { const n = el('div', 'seats'); n.innerHTML = sub; t.append(n); }
    c.append(t);
  }
  host.append(c);
}

// The block is written by the engine once any race is mostly counted. Before
// that, say so rather than draw an empty chart.
function ready(host, results) {
  const A = results.after;
  if (!A || !A.available) {
    lede(host, `<b>No comparison yet.</b> ${A && A.why ? esc(A.why) : 'The engine has not written one.'}`);
    return null;
  }
  if (!A.n) {
    lede(host, `<b>No race is ${A.eevp_min}% counted yet.</b> A margin is read against 2024 only once most of `
      + `the expected vote is in; early returns say which precincts count first, not how the electorate voted.`);
    return null;
  }
  return A;
}

// ---- bluer or redder ---------------------------------------------------------

export function afterShift(host, { results, forecast, onPick }) {
  host.replaceChildren();
  const A = ready(host, results);
  if (!A) return;
  const S = A.shift.all;
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  const rows = results.races.filter(r => r.shift != null);
  const share = n => `${Math.round(100 * n / S.n)}%`;

  lede(host,
    `Of the <b>${S.n}</b> races at least ${A.eevp_min}% counted, <b>${S.bluer}</b> (${share(S.bluer)}) voted bluer `
    + `than the same place voted for president in 2024 and <b>${S.redder}</b> (${share(S.redder)}) redder. `
    + `The median race moved <b>${fmtShift(S.median)}</b>; weighted by the votes cast, the shift is `
    + `<b>${fmtShift(S.weighted)}</b>. The forecast expected ${fmtShift(S.forecast_median)} in the median race.`);

  cards(host, [
    ['Moved bluer', String(S.bluer), `of ${S.n} races · ${share(S.bluer)}`, C.dem],
    ['Moved redder', String(S.redder), `of ${S.n} races · ${share(S.redder)}`, C.rep],
    ['Median race', fmtShift(S.median), `forecast expected ${fmtShift(S.forecast_median)}`],
    ['By votes cast', fmtShift(S.weighted), `forecast expected ${fmtShift(S.forecast_weighted)}`],
  ]);

  h4(host, 'How far each race moved');
  histogram(host, rows, S, A);
  note(host, `One bar per two points of shift: counted margin minus the 2024 presidential margin in the same `
    + `district or state. Blue bars are races that moved toward the Democrats, red toward the Republicans. `
    + `The solid line is the median race, the dashed line what the forecast expected.`);

  h4(host, 'By chamber');
  chamberTable(host, A);

  h4(host, 'By state');
  const st = Object.entries(A.shift.by_state).filter(([, v]) => v.n || v.statewide.length);
  const items = st.map(([state, v]) => ({
    state, v: v.n ? v.weighted : null,
    marks: v.statewide.map(w => ({ chamber: w.chamber, v: w.shift, race_id: w.race_id })),
    tip: `<b>${state}</b><br>`
      + (v.n ? `House ${fmtShift(v.weighted)} across ${v.n} of ${v.of} districts, by votes cast `
               + `<span class="tip-dim">(${v.bluer} bluer, ${v.redder} redder)</span>` : 'House: no district 90% in yet')
      + v.statewide.map(w => `<br>${chamberName(w.chamber)} ${fmtShift(w.shift)} <span class="tip-dim">${esc(w.race_id)}, ${w.eevp.toFixed(0)}% in</span>`).join(''),
  }));
  stateChart(host, items, { zero: 0, fmt: fmtShift, tick: tickShift, colour: v => (v >= 0 ? C.dem : C.rep),
    title: 'Shift from the 2024 presidential vote, by state' });
  note(host, `Bars: the state's House districts that are ${A.eevp_min}% counted, each district's shift weighted `
    + `by its votes. Diamonds are the Senate race, squares the governor's race, on the statewide presidential vote. `
    + `Sorted bluest first.`);

  h4(host, 'Moved most');
  const two = el('div', 'after-two');
  host.append(two);
  moversTable(two, A.shift.bluest.filter(r => r.shift > 0), 'Toward the Democrats', byId, onPick);
  moversTable(two, A.shift.reddest.filter(r => r.shift < 0), 'Toward the Republicans', byId, onPick);
}

function histogram(host, rows, S, A) {
  const W = 700, H = 240, m = { t: 30, r: 16, b: 36, l: 40 };
  const vals = rows.map(r => r.shift);
  const lo = Math.floor(Math.min(-6, d3.min(vals)) / 2) * 2, hi = Math.ceil(Math.max(6, d3.max(vals)) / 2) * 2;
  const x = d3.scaleLinear().domain([lo, hi]).range([m.l, W - m.r]);
  const bins = d3.bin().domain([lo, hi]).thresholds(d3.range(lo, hi, 2)).value(r => r.shift)(rows);
  const y = d3.scaleLinear().domain([0, d3.max(bins, b => b.length) || 1]).range([H - m.b, m.t]);
  const s = svg(host, W, H, 'How far every mostly-counted race moved from its 2024 presidential margin');
  s.node().parentNode.style.maxWidth = `${W + 40}px`;
  for (const t of y.ticks(4)) {
    if (!t) continue;
    s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t)).attr('stroke', C.line);
    s.append('text').attr('x', m.l - 6).attr('y', y(t) + 3).attr('text-anchor', 'end').attr('fill', C.muted)
      .attr('font-size', 10).text(t);
  }
  s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', H - m.b).attr('y2', H - m.b).attr('stroke', C.faint);
  s.append('g').selectAll('rect').data(bins).join('rect')
    .attr('x', b => x(b.x0) + 1).attr('width', b => Math.max(1, x(b.x1) - x(b.x0) - 2))
    .attr('y', b => y(b.length)).attr('height', b => H - m.b - y(b.length)).attr('rx', 2)
    .attr('fill', b => ((b.x0 + b.x1) / 2 >= 0 ? C.dem : C.rep)).attr('fill-opacity', 0.85)
    .on('pointerenter pointermove', (e, b) => showTip(e,
      `<b>${b.length}</b> race${b.length === 1 ? '' : 's'} moved ${fmtShift(b.x0)} to ${fmtShift(b.x1)}`
      + (b.length ? `<br><span class="tip-dim">${b.slice(0, 8).map(r => esc(r.race_id)).join(', ')}${b.length > 8 ? ' …' : ''}</span>` : '')))
    .on('pointerleave', hideTip);
  for (const t of x.ticks(8)) {
    s.append('text').attr('x', x(t)).attr('y', H - m.b + 14).attr('text-anchor', 'middle').attr('fill', C.muted)
      .attr('font-size', 10).text(t === 0 ? 'no change' : tickShift(t));
  }
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 4).attr('text-anchor', 'middle').attr('fill', C.muted)
    .attr('font-size', 11).text('shift from the 2024 presidential margin, points');
  s.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t - 4).attr('y2', H - m.b).attr('stroke', C.faint);
  const mark = (v, label, dash, dy) => {
    if (v == null) return;
    s.append('line').attr('x1', x(v)).attr('x2', x(v)).attr('y1', m.t - 10).attr('y2', H - m.b)
      .attr('stroke', C.ink).attr('stroke-width', 1.4).attr('stroke-dasharray', dash);
    s.append('text').attr('x', x(v) + 5).attr('y', m.t - 12 + dy).attr('fill', C.ink).attr('font-size', 11).text(label);
  };
  mark(S.forecast_median, `forecast expected ${fmtShift(S.forecast_median)}`, '4 3', 12);
  mark(S.median, `median ${fmtShift(S.median)}`, null, 0);
}

function chamberTable(host, A) {
  const t = el('table', 'plain');
  const h = t.createTHead().insertRow();
  for (const [lab, n] of [['Chamber'], ['Races', 1], ['Bluer', 1], ['Redder', 1], ['Median race', 1],
                          ['By votes cast', 1], ['Forecast expected', 1]]) {
    h.append(el('th', n ? 'num' : null, lab));
  }
  const b = t.createTBody();
  const line = (label, v, strong) => {
    if (!v || !v.n) return;
    const r = b.insertRow();
    if (strong) r.className = 'brk';
    r.append(el('td', null, label));
    r.append(el('td', 'num', String(v.n)));
    const bl = el('td', 'num'); bl.innerHTML = `<b style="color:${C.dem}">${v.bluer}</b>`; r.append(bl);
    const rd = el('td', 'num'); rd.innerHTML = `<b style="color:${C.rep}">${v.redder}</b>`; r.append(rd);
    const md = el('td', 'num'); md.innerHTML = `<b>${fmtShift(v.median)}</b>`; r.append(md);
    r.append(el('td', 'num', fmtShift(v.weighted)));
    r.append(el('td', 'num', fmtShift(v.forecast_median)));
  };
  for (const ch of ORDER) line(chamberName(ch), A.shift.by_chamber[ch]);
  line('All', A.shift.all, true);
  host.append(t);
}

// One row per state, a bar from `zero` to the state's value and a mark per
// statewide race, bluest or highest first. Used for the shift and for turnout.
// `dots`: a plain dot at the value on a plain axis, with `zero` drawn as a dashed
// reference line instead of being the bars' anchor. A bar anchored at an average
// reads as a deviation, which a turnout share is not.
function stateChart(host, items, { zero, fmt, tick = fmt, colour, title, tail, dots = false, refLabel }) {
  const list = items.filter(i => i.v != null || i.marks.length).sort((a, b) => (b.v ?? -1e9) - (a.v ?? -1e9));
  const rowH = 15, W = 700, m = { t: 22, r: tail ? 96 : 56, b: dots && refLabel ? 20 : 8, l: 34 };
  const H = m.t + list.length * rowH + m.b;
  const all = list.flatMap(i => [i.v, ...i.marks.map(k => k.v)]).filter(v => v != null);
  const lo = Math.min(zero, d3.min(all)), hi = Math.max(zero, d3.max(all));
  const pad = (hi - lo) * 0.04;
  const x = d3.scaleLinear().domain([lo - pad, hi + pad]).range([m.l, W - m.r]);
  const s = svg(host, W, H, title);
  s.node().parentNode.style.maxWidth = `${W + 40}px`;
  for (const t of x.ticks(6)) {
    s.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', m.t - 4).attr('y2', H - m.b)
      .attr('stroke', !dots && t === zero ? C.faint : C.line);
    s.append('text').attr('x', x(t)).attr('y', m.t - 8).attr('text-anchor', 'middle').attr('fill', C.muted)
      .attr('font-size', 10).text(tick(t));
  }
  if (dots) {
    s.append('line').attr('x1', x(zero)).attr('x2', x(zero)).attr('y1', m.t - 4).attr('y2', H - m.b)
      .attr('stroke', C.ink).attr('stroke-width', 1.2).attr('stroke-dasharray', '4 3');
    if (refLabel) {
      s.append('text').attr('x', x(zero) + 5).attr('y', H - 5).attr('fill', C.ink).attr('font-size', 10).text(refLabel);
    }
  }
  const rows = s.append('g').selectAll('g.row').data(list).join('g').attr('class', 'row')
    .attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);
  rows.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rowH).attr('fill', 'transparent');
  rows.append('text').attr('x', m.l - 6).attr('y', rowH / 2 + 3.5).attr('text-anchor', 'end').attr('fill', C.dim)
    .attr('font-size', 10.5).attr('font-weight', 600).text(d => d.state);
  if (dots) {
    rows.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', rowH / 2).attr('y2', rowH / 2)
      .attr('stroke', C.line).attr('stroke-width', 0.6);
    rows.filter(d => d.v != null).append('circle')
      .attr('cx', d => x(d.v)).attr('cy', rowH / 2).attr('r', 4.2)
      .attr('fill', d => colour(d.v)).attr('stroke', C.bg).attr('stroke-width', 1.2);
  } else {
    rows.filter(d => d.v != null).append('rect')
      .attr('x', d => Math.min(x(zero), x(d.v))).attr('y', 2.5)
      .attr('width', d => Math.max(1, Math.abs(x(d.v) - x(zero)))).attr('height', rowH - 5).attr('rx', 2)
      .attr('fill', d => colour(d.v)).attr('fill-opacity', 0.85);
  }
  // The value sits to the right of the dot and of every mark on the row (to the
  // left for a bar below its anchor), so it never lands on a diamond.
  const right = d => dots || d.v >= zero;
  const edge = d => (right(d) ? Math.max(x(d.v), ...d.marks.map(k => x(k.v) + 3)) + 5
                              : Math.min(x(d.v), ...d.marks.map(k => x(k.v) - 3)) - 5);
  rows.filter(d => d.v != null).append('text')
    .attr('x', edge).attr('y', rowH / 2 + 3.5)
    .attr('text-anchor', d => (right(d) ? 'start' : 'end')).attr('fill', C.muted).attr('font-size', 9.5)
    .text(d => fmt(d.v));
  rows.each(function (d) {
    const g = d3.select(this);
    for (const k of d.marks) {
      g.append('path').attr('d', d3.symbol().type(SHAPE[k.chamber] || d3.symbolCircle).size(k.chamber === 'senate' ? 42 : 34)())
        .attr('transform', `translate(${x(k.v)},${rowH / 2})`)
        .attr('fill', colour(k.v)).attr('stroke', C.bg).attr('stroke-width', 1.2);
    }
    if (tail && d.tail) {
      g.append('text').attr('x', W - 2).attr('y', rowH / 2 + 3.5).attr('text-anchor', 'end').attr('fill', C.muted)
        .attr('font-size', 9.5).text(d.tail);
    }
  });
  rows.on('pointerenter pointermove', (e, d) => showTip(e, d.tip)).on('pointerleave', hideTip);
}

function moversTable(host, list, title, byId, onPick) {
  const wrap = el('div');
  wrap.append(el('div', 'ladder-title', title));
  if (!list.length) { wrap.append(el('p', 'chart-note', 'None.')); host.append(wrap); return; }
  const t = el('table', 'plain');
  const h = t.createTHead().insertRow();
  for (const [lab, n] of [['Race'], ['2024 president', 1], ['Counted', 1], ['Shift', 1], ['Turnout', 1]]) {
    h.append(el('th', n ? 'num' : null, lab));
  }
  const b = t.createTBody();
  for (const r of list) {
    const row = b.insertRow();
    row.className = 'pick';
    const id = el('td'); id.innerHTML = `<b>${esc(r.race_id)}</b> <span class="tip-dim">${r.eevp.toFixed(0)}% in</span>`; row.append(id);
    row.append(el('td', 'num', fmtMargin(r.pres_margin)));
    row.append(el('td', 'num', fmtMargin(r.margin)));
    const sh = el('td', 'num'); sh.innerHTML = `<b style="color:${r.shift >= 0 ? C.dem : C.rep}">${fmtShift(r.shift)}</b>`; row.append(sh);
    row.append(el('td', 'num', pct(r.turnout)));
    row.addEventListener('click', () => onPick && byId.get(r.race_id) && onPick(byId.get(r.race_id)));
  }
  wrap.append(t);
  host.append(wrap);
}

// ---- who turned out ----------------------------------------------------------

export function afterTurnout(host, { results, forecast, onPick }) {
  host.replaceChildren();
  const A = ready(host, results);
  if (!A) return;
  const T = A.turnout, all = T.all, hd = T.harris_districts, td = T.trump_districts, mid = T.midterm_2022;
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  const rows = results.races.filter(r => r.turnout != null && r.shift != null);

  const r = T.corr_shift;
  const corrText = r == null ? ''
    : ` Across the ${T.corr_n} House districts, how much of the vote came back and how far the district moved `
      + `are correlated at <b>r = ${r.toFixed(2)}</b>: `
      + (Math.abs(r) < 0.1 ? 'the districts that lost the most voters moved no differently from the rest.'
         : r < 0 ? 'the districts that lost more of their voters moved further toward the Democrats.'
                 : 'the districts that kept more of their voters moved further toward the Democrats.');
  lede(host,
    `Across the same <b>${all.n}</b> races, <b>${pct(all.ratio)}</b> of the 2024 presidential vote came back `
    + `(${pct(all.median)} in the median race). Districts Harris carried kept <b>${pct(hd.ratio)}</b> of their 2024 `
    + `vote; districts Trump carried kept <b>${pct(td.ratio)}</b>.`
    + (mid.ratio != null ? ` Against the last midterm, House turnout in the ${mid.states} states fully counted is `
                           + `<b>${pct(mid.ratio)}</b> of 2022's.` : '')
    + corrText);

  cards(host, [
    ['Of the 2024 vote', pct(all.ratio), `${num(all.votes_2026)} votes against ${num(all.votes_2024)} · ${all.n} races`],
    ['Harris districts', pct(hd.ratio), `${hd.n} districts she carried in 2024`, C.dem],
    ['Trump districts', pct(td.ratio), `${td.n} districts he carried in 2024`, C.rep],
    ['Against 2022', mid.ratio != null ? pct(mid.ratio) : '—',
     mid.ratio != null ? `House votes in the ${mid.states} states fully counted, as a share of the last midterm's`
                       : 'no state fully counted yet'],
  ]);

  h4(host, 'By state');
  const st = Object.entries(A.shift.by_state).filter(([, v]) => v.turnout != null || v.statewide.length);
  const items = st.map(([state, v]) => ({
    state, v: v.turnout ?? null,
    marks: v.statewide.filter(w => w.turnout != null).map(w => ({ chamber: w.chamber, v: w.turnout, race_id: w.race_id })),
    tail: v.turnout_2022 != null ? `${pct(v.turnout_2022)} of 2022` : (v.n && !v.complete ? `${v.n} of ${v.of} in` : ''),
    tip: `<b>${state}</b><br>`
      + (v.turnout != null ? `House ${pct(v.turnout)} of the 2024 presidential vote across ${v.n} of ${v.of} districts `
                             + `<span class="tip-dim">(${num(v.votes_2026)} against ${num(v.votes_2024)})</span>`
                           : 'House: no district 90% in yet')
      + (v.turnout_2022 != null ? `<br>${pct(v.turnout_2022)} of the 2022 midterm's House vote (${num(v.house_2022)})` : '')
      + v.statewide.map(w => `<br>${chamberName(w.chamber)} ${pct(w.turnout)} <span class="tip-dim">${esc(w.race_id)}, ${w.eevp.toFixed(0)}% in</span>`).join(''),
  }));
  stateChart(host, items, { zero: all.ratio, fmt: pct, colour: () => C.ink, tail: true, dots: true,
    refLabel: `all races ${pct(all.ratio)}`,
    title: 'Share of the 2024 presidential vote that came back, by state' });
  note(host, `Each dot is a state's House vote as a share of the same districts' 2024 presidential vote, over the `
    + `districts that are ${A.eevp_min}% counted. Diamonds are the Senate race and squares the governor's race on the `
    + `statewide vote. The dashed line is the figure across every race. At the right, the state's House vote against `
    + `2022 where every district is in; otherwise how many are.`);

  h4(host, 'Turnout against shift');
  scatter(host, rows, T, byId, onPick);
  note(host, `One mark per race ${A.eevp_min}% counted. Blue: Harris carried it in 2024; red: Trump did. Circles `
    + `House, diamonds Senate, squares governors. A race high and to the right kept its voters and still moved; `
    + `one high and to the left moved as its electorate shrank.`);

  h4(host, 'Held and lost the most');
  const two = el('div', 'after-two');
  host.append(two);
  turnoutTable(two, T.held_best, 'Kept the most of its 2024 vote', byId, onPick);
  turnoutTable(two, T.held_least, 'Kept the least', byId, onPick);
}

function scatter(host, rows, T, byId, onPick) {
  const W = 620, H = 400, m = { t: 16, r: 16, b: 46, l: 62 };
  const xs = rows.map(r => r.turnout), ys = rows.map(r => r.shift);
  const x = d3.scaleLinear().domain([Math.min(0.5, d3.min(xs)), Math.max(1, d3.max(xs))]).nice().range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([Math.min(-10, d3.min(ys)), Math.max(10, d3.max(ys))]).nice().range([H - m.b, m.t]);
  const s = svg(host, W, H, 'Turnout against shift, one mark per mostly-counted race');
  s.node().parentNode.style.maxWidth = `${W + 40}px`;
  s.append('g').selectAll('line').data(x.ticks(6)).join('line')
    .attr('x1', x).attr('x2', x).attr('y1', m.t).attr('y2', H - m.b).attr('stroke', C.line);
  s.append('g').selectAll('line').data(y.ticks(6)).join('line')
    .attr('y1', y).attr('y2', y).attr('x1', m.l).attr('x2', W - m.r).attr('stroke', d => (d === 0 ? C.faint : C.line));
  s.append('g').selectAll('text').data(x.ticks(6)).join('text')
    .attr('x', x).attr('y', H - m.b + 14).attr('text-anchor', 'middle').attr('fill', C.muted).attr('font-size', 10).text(pct);
  s.append('g').selectAll('text').data(y.ticks(6)).join('text')
    .attr('x', m.l - 6).attr('y', d => y(d) + 3).attr('text-anchor', 'end').attr('fill', C.muted).attr('font-size', 10)
    .text(d => (d === 0 ? '0' : `${d > 0 ? 'D' : 'R'}+${Math.abs(d)}`));
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 6).attr('text-anchor', 'middle').attr('fill', C.muted)
    .attr('font-size', 11).text('share of the 2024 presidential vote that came back');
  s.append('text').attr('transform', `translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle')
    .attr('fill', C.muted).attr('font-size', 11).text('shift from 2024, points');
  if (T.all.ratio != null) {
    s.append('line').attr('x1', x(T.all.ratio)).attr('x2', x(T.all.ratio)).attr('y1', m.t).attr('y2', H - m.b)
      .attr('stroke', C.muted).attr('stroke-dasharray', '4 3');
    s.append('text').attr('x', x(T.all.ratio) + 5).attr('y', m.t + 10).attr('fill', C.muted).attr('font-size', 10)
      .text(`all races ${pct(T.all.ratio)}`);
  }
  s.append('g').selectAll('path').data(rows).join('path')
    .attr('d', r => d3.symbol().type(SHAPE[r.chamber] || d3.symbolCircle).size(r.chamber === 'house' ? 30 : 56)())
    .attr('transform', r => `translate(${x(r.turnout)},${y(r.shift)})`)
    .attr('fill', r => (r.pres_margin >= 0 ? C.dem : C.rep)).attr('fill-opacity', 0.8)
    .attr('stroke', C.bg).attr('stroke-width', 0.6)
    .style('cursor', 'pointer')
    .on('pointerenter pointermove', (e, r) => showTip(e,
      `<b>${esc(r.race_id)}</b> · ${r.eevp.toFixed(0)}% in<br>`
      + `turnout ${pct(r.turnout)} of 2024 · moved ${fmtShift(r.shift)}<br>`
      + `<span class="tip-dim">president 2024 ${fmtMargin(r.pres_margin)} → counted ${fmtMargin(r.margin)}</span>`))
    .on('pointerleave', hideTip)
    .on('click', (e, r) => onPick && byId.get(r.race_id) && onPick(byId.get(r.race_id)));
}

function turnoutTable(host, list, title, byId, onPick) {
  const wrap = el('div');
  wrap.append(el('div', 'ladder-title', title));
  const t = el('table', 'plain');
  const h = t.createTHead().insertRow();
  for (const [lab, n] of [['Race'], ['Of 2024', 1], ['Shift', 1]]) h.append(el('th', n ? 'num' : null, lab));
  const b = t.createTBody();
  for (const r of list) {
    const row = b.insertRow();
    row.className = 'pick';
    const id = el('td'); id.innerHTML = `<b>${esc(r.race_id)}</b> <span class="tip-dim">${r.eevp.toFixed(0)}% in</span>`; row.append(id);
    const tu = el('td', 'num'); tu.innerHTML = `<b>${pct(r.turnout)}</b>`; row.append(tu);
    const sh = el('td', 'num'); sh.innerHTML = `<span style="color:${r.shift >= 0 ? C.dem : C.rep}">${fmtShift(r.shift)}</span>`; row.append(sh);
    row.addEventListener('click', () => onPick && byId.get(r.race_id) && onPick(byId.get(r.race_id)));
  }
  wrap.append(t);
  host.append(wrap);
}
