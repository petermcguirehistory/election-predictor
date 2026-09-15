// Frequency framing: "in 100 simulated elections, D won 66".
//
// A percentage asks the reader to hold an abstraction; an icon array shows the
// reference class and the subset at once, which the risk-communication
// literature finds people read more accurately -- and the gap widens for less
// numerate readers, who are exactly the ones a public forecast most often
// misleads. Position (grouped, never interleaved) and the count label carry the
// split independently of hue.
//
// The reference class is a PARAMETER, because governors have no control
// probability to draw: 36 governorships confer no collective majority. There the
// hundred hypothetical elections become the 36 actual governorships and the
// filled block is the median Democratic count -- the same grammar answering the
// question governors do have, which is how many are won.
import d3 from '../d3.js';
import { C, svg, showTip, hideTip } from './util.js';

// `mid` is an optional middle block between the two parties: simulated elections
// that neither party won outright, drawn in the page's caveat colour. Democrats
// first, then the middle, then Republicans -- grouped, so the three counts can be
// read by position as well as by hue.
export function iconArray(host, { n = 100, k, mid = 0, cols = 20, label, unit, midUnit, of }) {
  host.replaceChildren();
  const rows = Math.ceil(n / cols);
  // Icons shrink as the reference class grows so a 36-unit array and a 100-unit
  // one occupy roughly the same block rather than one of them looking like a
  // different chart.
  const cell = n > 60 ? 22 : 30, r = cell * 0.33;
  const w = cols * cell, h = rows * cell;

  const s = svg(host, w, h + 4,
    `${k} of ${n} ${unit}` + (mid ? `; ${mid} ${midUnit}` : ''));
  const data = d3.range(n).map(i => ({ i, kind: i < k ? 'd' : i < k + mid ? 'mid' : 'r' }));

  s.selectAll('circle').data(data).join('circle')
    .attr('cx', d => (d.i % cols) * cell + cell / 2)
    .attr('cy', d => Math.floor(d.i / cols) * cell + cell / 2)
    .attr('r', r)
    .attr('fill', d => (d.kind === 'd' ? C.dem : d.kind === 'mid' ? C.accent : C.rep))
    .attr('fill-opacity', 0.92);

  // The boundaries between the blocks are the numbers. Mark them.
  for (const at of mid ? [k, k + mid] : [k]) {
    if (at <= 0 || at >= n) continue;
    const bx = (at % cols) * cell, by = Math.floor(at / cols) * cell;
    s.append('line')
      .attr('x1', bx).attr('x2', bx).attr('y1', by).attr('y2', by + cell)
      .attr('stroke', C.ink).attr('stroke-width', 2);
  }

  s.on('pointermove', e => showTip(e, `<b>${k} of ${n}</b><br>${unit}` +
      (mid ? `<br><b>${mid} of ${n}</b><br>${midUnit}` : '')))
   .on('pointerleave', hideTip);

  const cap = document.createElement('p');
  cap.className = 'icon-cap';
  cap.innerHTML = label;
  host.append(cap);
}
