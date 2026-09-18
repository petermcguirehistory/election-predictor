// The two chambers together, and what the trailing side still needs.
//
// WHY THIS EXISTS. Every other view of the outcome on this page is a marginal:
// the House distribution, the Senate distribution, each correct and each silent
// about the other. The draws contain the joint outcome and nothing was reading
// it, so the page invited a reader to multiply the two card numbers together --
// which is wrong here by fourteen points, because the chambers move together.
// 64.1% x 48.1% is 30.8%; the draws say 44.8%.
//
// That gap is the whole argument for drawing this. A shared national polling
// miss moves both chambers the same way, so "Democrats take the House" and
// "Democrats take the Senate" are not independent events and cannot be combined
// as if they were.
import d3 from '../d3.js';
import { C, svg, fmtPct, hoverable } from './util.js';

const W = 680, H = 420, M = { t: 16, r: 118, b: 44, l: 52 };

// WHAT EACH AXIS COUNTS FOLLOWS THE CONTROL RULE, so the lines are exact. Under
// `free` a party needs its number, so control is a function of Democratic seats
// alone and the axes are those. Under `sit-out` the larger party organises, so
// control is a function of the LEAD -- Democratic seats minus Republican -- and
// the axes are that; an independent's seat moves neither.
export function axisFor(sims, chamber, rule) {
  const d = sims.seats[chamber], ind = sims.ind[chamber], size = sims.m.size[chamber];
  const tb = (sims.m.tiebreak || {})[chamber] ?? null;
  if (rule === 'free') {
    return { val: k => d[k], cut: sims.m.needs[chamber].D, lead: false };
  }
  // D controls from a lead of 1, or 0 where Democrats hold the tiebreak.
  return { val: k => 2 * d[k] + ind[k] - size, cut: tb === 'D' ? 0 : 1, lead: true };
}

export function jointChambers(host, { sims, forecast, idx = null, rule = 'sit-out' }) {
  const h = sims.seats.house, s = sims.seats.senate;
  if (!h || !s) return null;
  const n = idx ? idx.length : h.length;
  const AH = axisFor(sims, 'house', rule), AS = axisFor(sims, 'senate', rule);
  const majH = AH.cut, majS = AS.cut;

  // Count the joint distribution once, and the four quadrants with it.
  const cell = new Map();
  let both = 0, hOnly = 0, sOnly = 0, neither = 0;
  let hLo = Infinity, hHi = -Infinity, sLo = Infinity, sHi = -Infinity;
  for (let i = 0; i < n; i++) {
    const k = idx ? idx[i] : i;
    const a = AH.val(k), b = AS.val(k);
    if (a < hLo) hLo = a; if (a > hHi) hHi = a;
    if (b < sLo) sLo = b; if (b > sHi) sHi = b;
    // Offset so a negative lead keys cleanly.
    const key = (a + 1000) * 10000 + (b + 1000);
    cell.set(key, (cell.get(key) || 0) + 1);
    const dh = a >= majH, ds = b >= majS;
    if (dh && ds) both++; else if (dh) hOnly++; else if (ds) sOnly++; else neither++;
  }

  const x = d3.scaleLinear().domain([hLo - 1, hHi + 1]).range([M.l, W - M.r]);
  const y = d3.scaleLinear().domain([sLo - 1, sHi + 1]).range([H - M.b, M.t]);
  const cw = Math.max(1.6, (x(hLo + 1) - x(hLo)));
  const chh = Math.max(1.6, (y(sLo) - y(sLo + 1)));
  const peak = d3.max([...cell.values()]);

  const g = svg(host, W, H, 'House and Senate outcomes together, across every simulation');

  // Quadrant washes first, so the draws sit on top of them.
  const quad = (x0, x1, y0, y1, col, op) =>
    g.append('rect').attr('x', x0).attr('y', y1).attr('width', Math.max(0, x1 - x0))
      .attr('height', Math.max(0, y0 - y1)).attr('fill', col).attr('opacity', op);
  // THE BOUNDARY IS A CELL EDGE, NOT A CELL CENTRE, and the first version put it
  // at the centre. Every mark is drawn centred on its value, so the row for 51
  // Senate seats spans y(51) +/- half a cell -- and control means *at least* 51,
  // so the whole of that row belongs to the winning side. A line at y(51) cuts
  // through the middle of the 51 row, leaving blue marks visibly below the line
  // that is supposed to bound them. Same for the House: the 218 column is
  // entirely inside the majority, so the divider sits at its left edge.
  const yCut = y(majS) + chh / 2;
  const xCut = x(majH) - cw / 2;
  quad(xCut, W - M.r, yCut, M.t, C.dem, .10);             // both
  quad(M.l, xCut, H - M.b, yCut, C.rep, .10);             // neither

  // One mark per distinct outcome, opacity by how often it came up. Not a
  // smoothed density: the underlying quantity is a pair of integers, and
  // smoothing it would invent outcomes between seats that cannot happen.
  const marks = [...cell.entries()].map(([k, c]) => ({
    h: Math.floor(k / 10000) - 1000, s: (k % 10000) - 1000, c }));
  hoverable(
    g.append('g').selectAll('rect').data(marks).join('rect')
      .attr('x', d => x(d.h) - cw / 2).attr('y', d => y(d.s) - chh / 2)
      .attr('width', cw).attr('height', chh)
      .attr('fill', d => (d.h >= majH && d.s >= majS ? C.dem
                        : d.h < majH && d.s < majS ? C.rep : C.accent))
      .attr('opacity', d => 0.18 + 0.82 * Math.sqrt(d.c / peak)),
    d => (AH.lead
         ? `Democrats ${d.h >= 0 ? '+' : ''}${d.h} in the House · ${d.s >= 0 ? '+' : ''}${d.s} in the Senate<br>`
         : `<b>${d.h}</b> House · <b>${d.s}</b> Senate<br>`)
       + `${fmtPct(d.c / n, 2)} of draws`);

  g.append('line').attr('x1', xCut).attr('x2', xCut).attr('y1', M.t).attr('y2', H - M.b)
    .attr('stroke', C.faint).attr('stroke-dasharray', '3,3');
  g.append('text').attr('x', xCut).attr('y', H - M.b + 30).attr('text-anchor', 'middle')
    .attr('font-size', 9.5).attr('fill', C.faint)
    .text(AH.lead ? 'House: Democrats ahead' : `${majH} for the House`);
  g.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', yCut).attr('y2', yCut)
    .attr('stroke', C.faint).attr('stroke-dasharray', '3,3');
  g.append('text').attr('x', W - M.r + 5).attr('y', yCut + 3)
    .attr('font-size', 9.5).attr('fill', C.faint)
    .text(AS.lead ? (majS === 1 ? 'Senate: D ahead' : 'Senate: D level') : `${majS} Senate`);

  const ax = g.append('g').attr('transform', `translate(0,${H - M.b})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format('d')).tickSizeOuter(0));
  const ay = g.append('g').attr('transform', `translate(${M.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('d')).tickSizeOuter(0));
  for (const a of [ax, ay]) {
    a.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
    a.selectAll('line,path').attr('stroke', C.line);
  }
  g.append('text').attr('x', M.l).attr('y', M.t + 2).attr('font-size', 10).attr('fill', C.muted)
    .text(AS.lead ? 'Democratic Senate seats minus Republican' : 'Democratic Senate seats');

  // Quadrant figures, placed in their own corner rather than in a legend.
  const label = (px, py, pct, txt, col, anchor) => {
    g.append('text').attr('x', px).attr('y', py).attr('text-anchor', anchor)
      .attr('font-size', 15).attr('font-weight', 600).attr('fill', col).text(pct);
    g.append('text').attr('x', px).attr('y', py + 13).attr('text-anchor', anchor)
      .attr('font-size', 9.5).attr('fill', C.muted).text(txt);
  };
  label(W - M.r - 6, M.t + 18, fmtPct(both / n, 1), 'both chambers', C.dem, 'end');
  label(M.l + 6, H - M.b - 20, fmtPct(neither / n, 1), 'neither', C.rep, 'start');
  label(W - M.r - 6, H - M.b - 20, fmtPct(hOnly / n, 1), 'House only', C.accent, 'end');
  if (sOnly / n > 0.005) label(M.l + 6, M.t + 18, fmtPct(sOnly / n, 1), 'Senate only', C.accent, 'start');

  return { both: both / n, hOnly: hOnly / n, sOnly: sOnly / n, neither: neither / n, n };
}

// What the trailing side still needs, in the chamber it is behind in.
//
// The seat distribution says how likely control is. It does not say what control
// would consist of, and "48.1%" is a worse answer to "can they still do it" than
// a list of the four seats it would take.
//
// Under `sit-out` the target is a LEAD, not a number: each seat taken from the
// other party moves it by two, so a party behind by L needs ceil((L + 1) / 2)
// seats -- one fewer where it holds the tiebreak.
export function cheapestPath(host, { sims, forecast, races, chamber, rule = 'sit-out' }) {
  const maj = sims.m.majority[chamber];
  if (maj == null) return null;
  const A = axisFor(sims, chamber, rule);
  const vals = Array.from({ length: sims.seats[chamber].length }, (_, k) => A.val(k));
  const median = d3.median(vals);
  let behind, need;
  if (!A.lead) {
    behind = median < maj ? 'D' : 'R';
    need = behind === 'D' ? maj - median : median - maj + 1;
  } else {
    const tb = (sims.m.tiebreak || {})[chamber] ?? null;
    // D controls at lead >= A.cut; R at lead <= (tb === 'R' ? 0 : -1).
    const rCut = tb === 'R' ? 0 : -1;
    behind = median < A.cut ? 'D' : 'R';
    need = behind === 'D' ? Math.ceil((A.cut - median) / 2) : Math.ceil((median - rCut) / 2);
  }
  if (need <= 0) return null;

  // Seats the trailing side does not currently favour, closest first. Their own
  // win probability is the price of each one.
  // Not an independent's slot: those wins belong to neither party, so they are
  // not seats either side can pick up.
  const ind = new Set([...(sims.m.independents[chamber]?.D || []),
                       ...(sims.m.independents[chamber]?.R || [])]);
  const pool = races
    .filter(r => r.chamber === chamber && sims.col.has(r.race_id) && !ind.has(r.race_id))
    .map(r => ({ ...r, p: behind === 'D' ? r.win_prob : 1 - r.win_prob }))
    .filter(r => r.p < 0.5)
    .sort((a, b) => b.p - a.p)
    .slice(0, 8);
  if (!pool.length) return null;
  return { behind, need, median, maj, pool, lead: A.lead };
}
