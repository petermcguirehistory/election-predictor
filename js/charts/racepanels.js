// Three small panels that finish the race drawer.
//
// Each exists because a number already in the panel was uninspectable: the seat
// has a record the prior never shows, `effective_pollsters: 3.88` names nobody,
// and a race the reader can pin has a consequence the drawer never stated.
import d3 from '../d3.js';
import { C, fmtMargin, fmtPct, hoverable, svg } from './util.js';

// ---- what this seat actually did -------------------------------------------
// NOT A LINE. Redistricting means a 2018 TX-34 and a 2026 TX-34 share a name and
// not always a territory, so joining them would assert a continuity the district
// boundaries do not have. Four separate marks, each labelled with its year, and
// a caution underneath saying so.
export function seatHistory(host, { past, race }) {
  if (!past || past.length < 2) return null;
  const W = 680, H = 96, M = { t: 26, r: 16, b: 26, l: 44 };
  const vals = past.map(p => p.m).concat([race.median_margin ?? race.mu ?? 0]);
  const lim = Math.max(12, d3.max(vals.map(Math.abs)) * 1.15);
  const x = d3.scaleLinear().domain([-lim, lim]).range([M.l, W - M.r]);

  const s = svg(host, W, H, 'This seat in the last four elections, against the current forecast');
  s.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', M.t - 6).attr('y2', H - M.b)
    .attr('stroke', C.mid);
  const ax = s.append('g').attr('transform', `translate(0,${H - M.b})`)
    .call(d3.axisBottom(x).ticks(5)
            .tickFormat(v => (v > 0 ? `D+${v}` : v < 0 ? `R+${-v}` : '0')).tickSizeOuter(0));
  ax.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
  ax.selectAll('line,path').attr('stroke', C.line);

  const yRow = M.t + 8;
  hoverable(
    s.append('g').selectAll('circle').data(past).join('circle')
      .attr('cx', d => x(d.m)).attr('cy', yRow).attr('r', 5)
      .attr('fill', d => (d.m >= 0 ? C.dem : C.rep)).attr('opacity', d => (d.u ? 0.4 : 0.85))
      .attr('stroke', d => (d.u ? C.faint : 'none')).attr('stroke-dasharray', '2,2'),
    d => `<b>${d.y}</b> &middot; ${fmtMargin(d.m)}`
       + (d.u ? '<br><em>uncontested &mdash; no two-party margin to compare</em>' : ''));
  s.append('g').selectAll('text').data(past).join('text')
    .attr('x', d => x(d.m)).attr('y', yRow - 10).attr('text-anchor', 'middle')
    .attr('font-size', 9).attr('fill', C.muted).text(d => d.y);

  const now = race.median_margin ?? race.mu;
  if (now != null) {
    s.append('path').attr('transform', `translate(${x(now)},${yRow})`)
      .attr('d', d3.symbol().type(d3.symbolTriangle).size(70))
      .attr('fill', C.accent);
    s.append('text').attr('x', x(now)).attr('y', yRow + 20).attr('text-anchor', 'middle')
      .attr('font-size', 9).attr('fill', C.accent).text('2026 forecast');
  }
  return s;
}

// ---- who polled it, and what each one counted for ---------------------------
// `effective_pollsters` is a single number standing in for a list, and the list
// is the thing that answers "is this four shops or one shop four times".
export function pollsterTable(host, { polls }) {
  const live = polls.filter(p => !(p.x || '').includes('s'));
  if (!live.length) return null;
  const by = new Map();
  for (const p of live) {
    const cur = by.get(p.p) || { name: p.p, n: 0, w: 0, h: p.h, last: p.d, flags: new Set() };
    cur.n += 1; cur.w += p.w;
    if (p.d > cur.last) cur.last = p.d;
    for (const f of (p.x || '')) cur.flags.add(f);
    by.set(p.p, cur);
  }
  const rows = [...by.values()].sort((a, b) => b.w - a.w);
  const t = document.createElement('table');
  t.className = 'dt-pollsters';
  const label = { p: 'partisan', i: 'internal', u: 'unrated' };
  t.innerHTML =
    '<thead><tr><th>Pollster</th><th>Polls</th><th>Newest</th><th>House effect</th>'
    + '<th>Share of the average</th></tr></thead><tbody>'
    + rows.map(r => {
        const flags = [...r.flags].map(f => label[f]).filter(Boolean);
        return `<tr><td>${r.name}`
          + (flags.length ? ` <span class="dt-tag">${flags.join(', ')}</span>` : '')
          + `</td><td class="num">${r.n}</td><td class="num">${r.last}</td>`
          + `<td class="num">${r.h === 0 ? '—' : (r.h > 0 ? '+' : '') + r.h.toFixed(2)}</td>`
          + `<td class="num"><span class="dt-wbar" style="width:${(r.w * 100).toFixed(1)}%"></span>`
          + `${(r.w * 100).toFixed(0)}%</td></tr>`;
      }).join('')
    + '</tbody>';
  host.append(t);
  return t;
}

// ---- what this race does to the chamber -------------------------------------
// The drawer already lets a reader pin this race. It never said what pinning it
// WOULD do, which is the only reason to pin it. Both branches are read from the
// draws already in the browser -- no new payload, and no formula.
export function conditionalReadout(host, { race, sims, forecast }) {
  if (!sims.col.has(race.race_id)) return null;
  const ch = race.chamber;
  const base = forecast.topline[ch];
  if (!base || base.control_prob == null) return null;

  // 500 draws is the floor the payload documents for reporting a conditional at
  // all; below it the Monte Carlo error swamps the answer. A race this lopsided
  // simply does not get this panel.
  const FLOOR = 500;
  const out = [];
  for (const party of ['D', 'R']) {
    let idx;
    try { idx = sims.select([{ race_id: race.race_id, party }]); } catch { return null; }
    if (!idx || idx.length < FLOOR) continue;
    const sum = sims.summary(ch, idx);
    if (!sum || sum.control_prob == null) continue;
    out.push({ party, n: idx.length, prob: sum.control_prob, se: sum.se, median: sum.median });
  }
  if (out.length < 2) return null;

  const name = ch === 'house' ? 'the House' : ch === 'senate' ? 'the Senate' : 'the governorships';
  const d = document.createElement('div');
  d.className = 'dt-cond';
  d.innerHTML =
    '<div class="dt-cond-h">What this race does to the chamber</div>'
    + out.map(o => {
        const col = o.party === 'D' ? C.dem : C.rep;
        const who = o.party === 'D' ? 'Democrats' : 'Republicans';
        return `<div class="dt-cond-row">`
          + `<span class="dt-cond-k">If ${who} win ${race.race_id}</span>`
          + `<span class="dt-cond-v" style="color:${col}">${fmtPct(o.prob, 1)}`
          + (o.se ? `<span class="dt-cond-se"> &plusmn;${(o.se * 100).toFixed(1)}</span>` : '')
          + `</span>`
          + `<span class="dt-cond-n">D control of ${name} &middot; ${o.n.toLocaleString()} draws `
          + `&middot; median ${o.median} seats</span></div>`;
      }).join('')
    + `<div class="dt-cond-note">Unconditionally the figure is `
    + `<b>${fmtPct(base.control_prob, 1)}</b>.`
    + `<ul class="pts">`
    + `<li><b>Source</b> — the draws themselves, out of `
    + `${forecast.meta.n_sims.toLocaleString()}: those where this race went that way, and what `
    + `happened in the rest of each. No formula.</li>`
    + `<li><b>Not independent</b> — the draws already carry the national and regional error these `
    + `races share.</li>`
    + `<li><b>The &plusmn;</b> — Monte Carlo error from counting a subset of the draws, not model `
    + `uncertainty.</li>`
    + `</ul></div>`;
  host.append(d);
  return d;
}
