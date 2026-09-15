// Quantile dotplot of the seat total.
//
// Each dot is one percentile of the simulated distribution, so the reader
// COUNTS outcomes past the majority line instead of judging the area under a
// curve. Kay et al. (CHI 2018) found discrete-outcome displays beat density and
// error bars for exactly this kind of decision. The threshold is a hard rule,
// not a gradient, which is why a countable form suits it.
import d3 from '../d3.js';
import { C, svg, showTip, hideTip } from './util.js';

export function dotplot(host, { hist, threshold, n, chamber, unit, showNote = true }) {
  host.replaceChildren();
  const N = 100;
  // Expand the histogram into N equally-weighted quantiles.
  const vals = [];
  let cum = 0, k = 0;
  const total = hist.counts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < hist.counts.length; i++) {
    cum += hist.counts[i];
    while (k < N && (k + 0.5) / N * total <= cum) { vals.push(hist.min + i); k++; }
  }
  while (vals.length < N) vals.push(hist.min + hist.counts.length - 1);

  // A chamber can have no threshold -- 36 governorships confer no majority, so
  // there is no line to draw and no side of it to be on. Everything downstream
  // that would have referenced one is guarded rather than given a stand-in,
  // because a default here would draw a control line nobody chose.
  const hasThresh = threshold != null;
  const lo = (hasThresh ? Math.min(vals[0], threshold) : vals[0]) - 3;
  const hi = (hasThresh ? Math.max(vals[N - 1], threshold) : vals[N - 1]) + 3;
  const W = 720, H = 220, m = { t: 8, r: 12, b: 44, l: 12 };
  const x = d3.scaleLinear().domain([lo, hi]).range([m.l, W - m.r]);
  const stackBy = d3.group(vals, v => v);
  const maxStack = d3.max(stackBy, ([, v]) => v.length);
  const rad = Math.min(6.5, (W - m.l - m.r) / (hi - lo) / 2 - 0.6,
                       (H - m.t - m.b) / maxStack / 2 - 0.6);

  const s = svg(host, W, H, hasThresh
    ? `Quantile dotplot of simulated ${unit}; ${threshold} needed for control`
    : `Quantile dotplot of simulated ${unit}`);

  const dots = [];
  for (const [v, arr] of stackBy) {
    arr.forEach((_, j) => dots.push({ v, j }));
  }
  const yBase = H - m.b;

  s.selectAll('circle').data(dots).join('circle')
    .attr('cx', d => x(d.v))
    .attr('cy', d => yBase - rad - d.j * (rad * 2 + 1.2))
    .attr('r', rad)
    .attr('fill', d => (hasThresh && d.v < threshold ? C.rep : C.dem))
    .attr('fill-opacity', 0.9);

  // Threshold rule, drawn over the dots and labelled.
  if (hasThresh) {
    s.append('line')
      .attr('x1', x(threshold - 0.5)).attr('x2', x(threshold - 0.5))
      .attr('y1', m.t).attr('y2', yBase + 6)
      .attr('stroke', C.ink).attr('stroke-width', 2).attr('stroke-dasharray', '3 3');
    s.append('text')
      .attr('x', x(threshold - 0.5)).attr('y', m.t + 2)
      .attr('text-anchor', 'middle').attr('fill', C.ink)
      .attr('font-size', 11).attr('font-weight', 600)
      .text(`${threshold} for control`);
  }

  const axis = s.append('g').attr('transform', `translate(0,${yBase + 4})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format('d')).tickSizeOuter(0));
  axis.selectAll('text').attr('fill', C.muted).attr('font-size', 11);
  axis.selectAll('line,path').attr('stroke', C.line);
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 1)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 11).text(unit);

  s.on('pointermove', e => {
    const v = Math.round(x.invert(e.offsetX ?? 0));
    const cnt = (stackBy.get(v) || []).length;
    showTip(e, `<b>${v}</b> ${unit}<br>${cnt} of 100 simulations`);
  }).on('pointerleave', hideTip);

  // Under the `all` scope this chart is drawn three times and the note beneath
  // it was identical under the first two, which reads as a rendering fault
  // rather than as a caption. The caller says which instances need it -- the
  // same de-duplication the map caption already does.
  if (!showNote) return;
  const note = document.createElement('p');
  note.className = 'chart-note';
  // How to read the dots is said once, in the mode note above every chamber.
  // Only the chamber with no line needs a sentence of its own.
  if (hasThresh) return;
  note.innerHTML = 'No line: governorships confer no majority, so only the count won.';
  host.append(note);
}
