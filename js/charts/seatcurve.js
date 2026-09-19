// The seat total as a cumulative probability: P(at least N seats).
//
// A COMPANION TO THE QUANTILE DOTPLOT, NOT A REPLACEMENT FOR IT. The dotplot is
// countable on purpose -- Kay et al. (CHI 2018) found discrete outcomes beat
// density displays for exactly the decision a majority line poses, and counting
// dots past a hard threshold is the task it is good at. This curve is good at a
// different one: it reads off ANY threshold, not only the majority. "What are
// the chances of at least 230?" has no answer in a dotplot and is a single
// glance here.
//
// CUMULATIVE RATHER THAN A DENSITY. A density curve invites judging area, which
// is the thing people are measurably bad at, and its peak height means nothing a
// reader can name. Every height on this curve is a probability, so the y axis is
// the quantity the page is about rather than a shape.
//
// The majority is drawn as a right angle into the axis -- across to the curve,
// down to the probability -- because that is the read the headline number IS,
// and showing it as a construction makes the headline a consequence of the chart
// rather than a caption on it.
import d3 from '../d3.js';
import { C, svg, fmtPct, hoverable } from './util.js';

const W = 720, H = 250, M = { t: 14, r: 54, b: 42, l: 44 };

export function seatCurve(host, { hist, threshold, n, chamber, unit,
                                  lineLabel = t => `${t} to control` }) {
  const total = hist.counts.reduce((a, b) => a + b, 0);
  if (!total) return null;

  // P(seats >= v) for every v in range, from the top down.
  const pts = [];
  let tail = 0;
  for (let i = hist.counts.length - 1; i >= 0; i--) {
    tail += hist.counts[i];
    pts.unshift({ v: hist.min + i, p: tail / total });
  }
  const lo = Math.min(pts[0].v, threshold ?? pts[0].v) - 2;
  const hi = Math.max(pts[pts.length - 1].v, threshold ?? 0) + 2;

  const x = d3.scaleLinear().domain([lo, hi]).range([M.l, W - M.r]);
  const y = d3.scaleLinear().domain([0, 1]).range([H - M.b, M.t]);
  const s = svg(host, W, H, `Chance of at least a given number of ${unit}`);

  const ax = s.append('g').attr('transform', `translate(0,${H - M.b})`)
    .call(d3.axisBottom(x).ticks(7).tickFormat(d3.format('d')).tickSizeOuter(0));
  ax.selectAll('text').attr('font-size', 10.5).attr('fill', C.muted);
  ax.selectAll('line,path').attr('stroke', C.line);
  const ay = s.append('g').attr('transform', `translate(${M.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(v => `${Math.round(v * 100)}%`).tickSizeOuter(0));
  ay.selectAll('text').attr('font-size', 10.5).attr('fill', C.muted);
  ay.selectAll('line,path').attr('stroke', C.line);

  // ONE NEUTRAL FILL, AND NOT A PARTY ONE. The first version shaded left of the
  // majority red and right of it blue, which is a lie about what the shape
  // means: on a cumulative curve the probability is the HEIGHT at a seat number,
  // not the area either side of it. Those two regions are not a partition of
  // anything and summing them gives no quantity. Party colour on them invites
  // exactly the area-judging this form was chosen to avoid -- the same mistake
  // as finding 41, a fill encoding something other than what it appears to.
  //
  // The fill that remains is one tone and carries no quantity: it is there to
  // make the line legible against the ground, and it is the same colour whatever
  // the number is.
  const area = d3.area().x(d => x(d.v)).y0(y(0)).y1(d => y(d.p)).curve(d3.curveStepAfter);
  s.append('path').datum(pts).attr('d', area).attr('fill', C.ink).attr('opacity', .06);

  const line = d3.line().x(d => x(d.v)).y(d => y(d.p)).curve(d3.curveStepAfter);
  s.append('path').datum(pts).attr('d', line).attr('fill', 'none')
    .attr('stroke', C.ink).attr('stroke-width', 1.8);

  // The headline, drawn as the construction that produces it.
  if (threshold != null) {
    const at = pts.find(d => d.v === threshold);
    // Below every simulated total, every draw clears it; above every one, none.
    const p = at ? at.p : (threshold < pts[0].v ? 1 : 0);
    s.append('line').attr('x1', x(threshold)).attr('x2', x(threshold))
      .attr('y1', H - M.b).attr('y2', y(p))
      .attr('stroke', C.accent).attr('stroke-dasharray', '3,3');
    s.append('line').attr('x1', M.l).attr('x2', x(threshold))
      .attr('y1', y(p)).attr('y2', y(p))
      .attr('stroke', C.accent).attr('stroke-dasharray', '3,3');
    s.append('circle').attr('cx', x(threshold)).attr('cy', y(p)).attr('r', 3.5)
      .attr('fill', C.accent);
    s.append('text').attr('x', x(threshold) + 6).attr('y', y(p) - 8)
      .attr('font-size', 12).attr('font-weight', 600).attr('fill', C.accent)
      .text(fmtPct(p, 1));
    s.append('text').attr('x', x(threshold)).attr('y', H - M.b + 26)
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', C.accent)
      .text(lineLabel(threshold));
  }

  // Every point is readable, not just the majority.
  hoverable(
    s.append('g').selectAll('rect').data(pts).join('rect')
      .attr('x', d => x(d.v) - Math.abs(x(1) - x(0)) / 2)
      .attr('y', M.t).attr('width', Math.max(2, Math.abs(x(1) - x(0))))
      .attr('height', H - M.b - M.t).attr('fill', 'transparent'),
    d => `<b>${d.v}</b> ${unit}<br>at least this many in ${fmtPct(d.p, 1)} of draws`);

  // An even-chance rule, drawn as a rule rather than a floating label.
  s.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', y(0.5)).attr('y2', y(0.5))
    .attr('stroke', C.line).attr('stroke-dasharray', '2,4');
  s.append('text').attr('x', W - M.r + 4).attr('y', y(0.5) + 3)
    .attr('font-size', 9.5).attr('fill', C.faint).text('even');
  return s;
}
