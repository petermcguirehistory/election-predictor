// Path to the majority.
//
// Races ordered safest-D to safest-R, with each race's median margin plotted
// against its rank. Two lines matter and the gap between them is the story:
// where the curve crosses ZERO is how many seats Democrats take at the median,
// and seat 218 is how many they need. The horizontal distance between those two
// is the seats-votes bias the model reports in its own reproduction gate.
//
// A flat colour strip -- the first version of this chart -- marked the crossing
// and said nothing else. The curve shows how STEEP the middle is, which is what
// determines whether a small national swing moves ten seats or fifty.
//
// This ordering is NOT the simulated tipping point beside it. It crosses at
// CA-41; the draws most often turn on NY-03. Different questions, both labelled.
//
// `threshold` is counted in RACES ON THE BALLOT, not in seats held. For the
// House those are the same number and the line is 218. For the Senate they are
// not: 34 Democratic seats are not up, so the majority falls at seat 17 of the
// 35 being contested, and a line drawn at 51 would sit off the end of the chart.
// Governors pass null -- 36 governorships confer no collective majority, so
// there is no line to draw. The curve still crosses zero, and where it crosses
// is still the answer to the question governors do have: how many are won.
import d3 from '../d3.js';
import { C, svg, fmtMargin, showTip, hideTip } from './util.js';

export function snake(host, { races, threshold, crossing, unit = 'seats', held = 0,
                              majority = null, onPick }) {
  host.replaceChildren();
  const rows = races
    .map(r => ({ ...r, key: r.locked ? (r.locked_party === 'D' ? 1e6 : -1e6) : r.median_margin }))
    .sort((a, b) => b.key - a.key)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const CLAMP = 40;
  const W = 520, H = 230, m = { t: 14, r: 14, b: 34, l: 42 };
  const x = d3.scaleLinear().domain([1, rows.length]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([-CLAMP, CLAMP]).range([H - m.b, m.t]);
  const cy = d => y(Math.max(-CLAMP, Math.min(CLAMP, d.key)));

  const s = svg(host, W, H, threshold == null
    ? `Median margin by rank across ${rows.length} ${unit}`
    : `Median margin by rank; the curve crosses zero near ${unit.replace(/s$/, '')} ${threshold}`);

  // Grid, recessive.
  s.append('g').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y)
    .attr('stroke', C.line).attr('stroke-width', 1);

  const area = side => d3.area()
    .x(d => x(d.rank))
    .y0(y(0))
    .y1(d => (side > 0 ? Math.min(y(0), cy(d)) : Math.max(y(0), cy(d))))
    .curve(d3.curveStepAfter)(rows);

  s.append('path').attr('d', area(1)).attr('fill', C.dem).attr('fill-opacity', 0.34);
  s.append('path').attr('d', area(-1)).attr('fill', C.rep).attr('fill-opacity', 0.34);
  s.append('path')
    .attr('d', d3.line().x(d => x(d.rank)).y(cy).curve(d3.curveStepAfter)(rows))
    .attr('fill', 'none').attr('stroke', C.ink).attr('stroke-width', 1.6).attr('stroke-opacity', 0.75);

  // Zero, and the majority -- if there is one to reach.
  s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', C.ink).attr('stroke-width', 1).attr('stroke-opacity', 0.55);
  if (threshold != null) {
    const tx = x(threshold);
    s.append('line').attr('x1', tx).attr('x2', tx).attr('y1', m.t).attr('y2', H - m.b)
      .attr('stroke', C.accent).attr('stroke-width', 2);
    s.append('text').attr('x', tx + 5).attr('y', m.t + 10)
      .attr('fill', C.accent).attr('font-size', 11).attr('font-weight', 600)
      .text(held ? `${threshold} of these` : `seat ${threshold}`);
  }

  const zero = rows.findIndex(r => r.key <= 0);
  const nWin = zero < 0 ? rows.length : zero;

  const ax = s.append('g').attr('transform', `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format('d')).tickSizeOuter(0));
  const ay = s.append('g').attr('transform', `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(5)
      .tickFormat(v => (v === 0 ? '0' : `${v > 0 ? 'D' : 'R'}+${Math.abs(v)}`)).tickSizeOuter(0));
  for (const g of [ax, ay]) {
    g.selectAll('text').attr('fill', C.muted).attr('font-size', 10.5);
    g.selectAll('line,path').attr('stroke', C.line);
  }
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 1)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5)
    .text(`${unit} on the ballot, ordered safest Democratic to safest Republican`);

  // Hover reads off the rank under the pointer.
  const hit = s.append('rect')
    .attr('x', m.l).attr('y', m.t).attr('width', W - m.r - m.l).attr('height', H - m.b - m.t)
    .attr('fill', 'transparent').style('cursor', 'pointer');
  const mark = s.append('circle').attr('r', 4).attr('fill', C.accent).style('display', 'none');
  hit.on('pointermove', e => {
    const [px] = d3.pointer(e);
    const r = rows[Math.max(0, Math.min(rows.length - 1, Math.round(x.invert(px)) - 1))];
    mark.style('display', null).attr('cx', x(r.rank)).attr('cy', cy(r));
    showTip(e, `<b>${r.race_id}</b> · seat ${r.rank}<br>` +
      (r.locked ? 'settled — same-party general'
                : `median ${fmtMargin(r.median_margin)} · D win ${(r.win_prob * 100).toFixed(0)}%`));
  }).on('pointerleave', () => { mark.style('display', 'none'); hideTip(); })
    .on('click', e => {
      const [px] = d3.pointer(e);
      const r = rows[Math.max(0, Math.min(rows.length - 1, Math.round(x.invert(px)) - 1))];
      onPick && onPick(r);
    });

  const note = document.createElement('p');
  note.className = 'chart-note';
  if (threshold == null) {
    // No majority to reach, so the only thing the crossing can report is the
    // count -- which is the whole question here.
    note.innerHTML =
      `Every ${unit.replace(/s$/, '')} on the ballot ordered by expected margin, the curve ` +
      `crossing zero at <b>${nWin}</b> of ${rows.length}. No line to cross: ${rows.length} ` +
      `governorships are separate offices with no collective majority, so this ordering reports how ` +
      `many are won and nothing about control.`;
  } else {
    const gap = nWin - threshold;
    note.innerHTML =
      `Every ${unit.replace(/s$/, '')} on the ballot, ordered by its expected margin. Democrats ` +
      `are ahead in <b>${nWin}</b> of ${rows.length}, which is <b>${Math.abs(gap)}</b> ` +
      `${gap >= 0 ? 'more than' : 'short of'} the <b>${threshold}</b> they need. ` +
      (held
        ? `The line is at ${threshold} rather than ${majority} because ${held} Democratic seats ` +
          `are not on the ballot this cycle and carry over: ${threshold} of these ${rows.length} ` +
          `makes ${majority} in the chamber. `
        : '') +
      (crossing
        ? `The seat sitting at rank ${threshold} here is <b>${crossing.race_id}</b> ` +
          `(${fmtMargin(crossing.median_margin)}). That is not the same thing as the race most ` +
          `likely to decide control — this is one fixed ordering by expected margin, and the ` +
          `chart beside it counts how often each race lands in the deciding position once every ` +
          `run is ordered on its own.`
        : '');
  }
  host.append(note);
}
