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

export function jointChambers(host, { sims, forecast, idx = null }) {
  const h = sims.seats.house, s = sims.seats.senate;
  if (!h || !s) return null;
  const n = idx ? idx.length : h.length;
  const majH = sims.m.majority.house, majS = sims.m.majority.senate;

  // Count the joint distribution once, and the four quadrants with it.
  const cell = new Map();
  let both = 0, hOnly = 0, sOnly = 0, neither = 0;
  let hLo = Infinity, hHi = -Infinity, sLo = Infinity, sHi = -Infinity;
  for (let i = 0; i < n; i++) {
    const k = idx ? idx[i] : i;
    const a = h[k], b = s[k];
    if (a < hLo) hLo = a; if (a > hHi) hHi = a;
    if (b < sLo) sLo = b; if (b > sHi) sHi = b;
    const key = a * 1000 + b;
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
  // `quad(x0, x1, yBottom, yTop, ...)`. Getting these the wrong way round put the
  // blue wash over "House only" and the red over "Senate only" -- the two
  // quadrants they are not about -- which is a background asserting the opposite
  // of the figure printed in the corner of it.
  quad(x(majH), W - M.r, y(majS), M.t, C.dem, .10);       // both: right of majH, above majS
  quad(M.l, x(majH), H - M.b, y(majS), C.rep, .10);       // neither: left of majH, below majS

  // One mark per distinct outcome, opacity by how often it came up. Not a
  // smoothed density: the underlying quantity is a pair of integers, and
  // smoothing it would invent outcomes between seats that cannot happen.
  const marks = [...cell.entries()].map(([k, c]) => ({
    h: Math.floor(k / 1000), s: k % 1000, c }));
  hoverable(
    g.append('g').selectAll('rect').data(marks).join('rect')
      .attr('x', d => x(d.h) - cw / 2).attr('y', d => y(d.s) - chh / 2)
      .attr('width', cw).attr('height', chh)
      .attr('fill', d => (d.h >= majH && d.s >= majS ? C.dem
                        : d.h < majH && d.s < majS ? C.rep : C.accent))
      .attr('opacity', d => 0.18 + 0.82 * Math.sqrt(d.c / peak)),
    d => `<b>${d.h}</b> House · <b>${d.s}</b> Senate<br>`
       + `${fmtPct(d.c / n, 2)} of draws`);

  for (const [xv, lab] of [[majH, `${majH} for the House`]]) {
    g.append('line').attr('x1', x(xv)).attr('x2', x(xv)).attr('y1', M.t).attr('y2', H - M.b)
      .attr('stroke', C.faint).attr('stroke-dasharray', '3,3');
    g.append('text').attr('x', x(xv)).attr('y', H - M.b + 30).attr('text-anchor', 'middle')
      .attr('font-size', 9.5).attr('fill', C.faint).text(lab);
  }
  g.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', y(majS)).attr('y2', y(majS))
    .attr('stroke', C.faint).attr('stroke-dasharray', '3,3');
  g.append('text').attr('x', W - M.r + 5).attr('y', y(majS) + 3)
    .attr('font-size', 9.5).attr('fill', C.faint).text(`${majS} Senate`);

  const ax = g.append('g').attr('transform', `translate(0,${H - M.b})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format('d')).tickSizeOuter(0));
  const ay = g.append('g').attr('transform', `translate(${M.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('d')).tickSizeOuter(0));
  for (const a of [ax, ay]) {
    a.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
    a.selectAll('line,path').attr('stroke', C.line);
  }
  g.append('text').attr('x', M.l).attr('y', M.t + 2).attr('font-size', 10).attr('fill', C.muted)
    .text('Democratic Senate seats');

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
export function cheapestPath(host, { sims, forecast, races, chamber }) {
  const maj = sims.m.majority[chamber];
  if (maj == null) return null;
  const seats = sims.seats[chamber];
  const median = d3.median(seats);
  const behind = median < maj ? 'D' : 'R';
  const need = behind === 'D' ? maj - median : median - maj + 1;
  if (need <= 0) return null;

  // Seats the trailing side does not currently favour, closest first. Their own
  // win probability is the price of each one.
  const pool = races
    .filter(r => r.chamber === chamber && sims.col.has(r.race_id))
    .map(r => ({ ...r, p: behind === 'D' ? r.win_prob : 1 - r.win_prob }))
    .filter(r => r.p < 0.5)
    .sort((a, b) => b.p - a.p)
    .slice(0, 8);
  if (!pool.length) return null;
  return { behind, need, median, maj, pool };
}
