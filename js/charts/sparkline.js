// The card-sized version of the trend chart.
//
// Drawn only across runs js/history.js certifies comparable, which is why there
// is no break handling in here: a broken join never reaches this function. The
// caller gets `blocked` from the same helper and says in words that the series
// stops there, because a line that simply starts late looks like a model that
// started late rather than one whose earlier runs cannot be joined to these.
import d3 from '../d3.js';
import { C } from './util.js';

export function sparkline(host, { values, colour = C.dem, rule = null,
                                  width = 128, height = 30, label }) {
  host.replaceChildren();
  if (!values || values.length < 2) return;

  const m = { t: 4, b: 4, l: 1, r: 5 };
  const lo = Math.min(...values), hi = Math.max(...values);
  // A flat series -- governors have sat at 20 for every comparable run -- has no
  // extent to scale to, and an unpadded domain would divide by zero and put the
  // line on the top edge. Pad to a visible band and let it read as flat.
  const pad = (hi - lo) || Math.max(Math.abs(hi) * 0.04, 0.02);
  const dom = [lo - pad * 0.35, hi + pad * 0.35];
  // The even-odds line is the only reference a probability sparkline has; keep
  // it inside the frame whenever the series comes anywhere near it, so a card
  // showing a chamber crossing 50% actually shows the crossing.
  if (rule != null && rule > dom[0] - pad && rule < dom[1] + pad) {
    dom[0] = Math.min(dom[0], rule - pad * 0.2);
    dom[1] = Math.max(dom[1], rule + pad * 0.2);
  }

  const x = d3.scaleLinear().domain([0, values.length - 1]).range([m.l, width - m.r]);
  const y = d3.scaleLinear().domain(dom).range([height - m.b, m.t]);

  const s = d3.select(host).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', width).attr('height', height)
    .attr('role', 'img').attr('aria-label', label || 'trend')
    .style('display', 'block').style('overflow', 'visible');

  if (rule != null && rule >= dom[0] && rule <= dom[1]) {
    s.append('line').attr('x1', m.l).attr('x2', width - m.r)
      .attr('y1', y(rule)).attr('y2', y(rule))
      .attr('stroke', C.faint).attr('stroke-dasharray', '2 3').attr('stroke-opacity', 0.8);
  }

  const line = d3.line().x((_, i) => x(i)).y(d => y(d));
  s.append('path').attr('d', line(values))
    .attr('fill', 'none').attr('stroke', colour)
    .attr('stroke-width', 1.6).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
    .attr('stroke-opacity', 0.85);

  s.append('circle')
    .attr('cx', x(values.length - 1)).attr('cy', y(values.at(-1))).attr('r', 2.6)
    .attr('fill', colour);
}
