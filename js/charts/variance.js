// Where a race's uncertainty comes from.
//
// The rows above this chart list four sigmas and a total, and the total is not
// their sum -- it is the square root of the sum of their squares, because the
// four errors are independent and independent errors combine in quadrature. That
// sentence is easy to write and easy to read past, and it has a consequence
// people consistently get wrong: the largest term dominates far more than its
// share of the list suggests, and the smallest ones almost do not matter.
//
// SO THE BAR IS DRAWN IN VARIANCE, NOT IN SIGMA. Variance is the quantity that
// actually adds, so a bar split by variance is a bar whose lengths mean
// something when you put them end to end. Splitting it by sigma would produce
// four segments that sum to more than the total and invite exactly the addition
// the note underneath spends a sentence denying.
//
// Each segment is still LABELLED with its sigma, because that is the number in
// the rows above and the number a reader can check. The label says points; the
// length says share of the variance. They are different quantities and the
// caption says which is which -- the alternative, drawing sigma and calling it a
// share, is the finding-41 mistake of a bar that encodes something other than
// what it is labelled with.
import d3 from '../d3.js';
import { C, hoverable, svg } from './util.js';

const W = 680, H = 92, M = { t: 26, r: 16, b: 30, l: 44 };

export function varianceBar(host, { sigma, race }) {
  const parts = [
    { k: 'National', v: sigma.nat, why: 'every race in the country moves together with it' },
    { k: 'Regional', v: sigma.reg, why: `shared across the ${race.region}` },
    { k: 'State', v: sigma.state, why: `shared across ${race.state}` },
    { k: 'This race', v: race.sigma_idio, why: 'this seat alone, and the polling of it' },
  ].filter(p => p.v > 0);
  if (!parts.length) return null;

  const varTotal = d3.sum(parts, p => p.v * p.v);
  const total = Math.sqrt(varTotal);
  const x = d3.scaleLinear().domain([0, varTotal]).range([M.l, W - M.r]);

  const s = svg(host, W, H, 'Where this race’s uncertainty comes from, by share of variance');
  const colour = ['#4a6fa5', '#5d8ab0', '#7aa6b8', C.accent];

  let acc = 0;
  const segs = parts.map((p, i) => {
    const x0 = x(acc); acc += p.v * p.v;
    return { ...p, x0, x1: x(acc), c: colour[i % colour.length],
             share: (p.v * p.v) / varTotal };
  });

  hoverable(
    s.append('g').selectAll('rect').data(segs).join('rect')
      .attr('x', d => d.x0).attr('y', M.t).attr('width', d => Math.max(1, d.x1 - d.x0))
      .attr('height', 26).attr('fill', d => d.c).attr('opacity', .85),
    d => `<b>${d.k}</b><br>±${d.v.toFixed(2)} points<br>`
       + `${(d.share * 100).toFixed(0)}% of the variance<br><em>${d.why}</em>`);

  // Only label segments with room for the text; the rest are in the tooltip and
  // in the rows above, so nothing is only here.
  s.append('g').selectAll('text').data(segs.filter(d => d.x1 - d.x0 > 58)).join('text')
    .attr('x', d => (d.x0 + d.x1) / 2).attr('y', M.t + 17)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#0c0e11')
    .attr('font-weight', 600)
    .text(d => `±${d.v.toFixed(1)}`);

  s.append('g').selectAll('text').data(segs.filter(d => d.x1 - d.x0 > 58)).join('text')
    .attr('x', d => (d.x0 + d.x1) / 2).attr('y', M.t - 8)
    .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', C.muted)
    .text(d => d.k);

  s.append('text').attr('x', M.l).attr('y', H - 10)
    .attr('font-size', 10).attr('fill', C.faint)
    .text(`√(sum of squares) = ±${total.toFixed(2)} points, not ${
      d3.sum(parts, p => p.v).toFixed(2)}: independent errors add in quadrature`);

  return s;
}
