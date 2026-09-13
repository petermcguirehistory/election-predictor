// The model's own error record.
//
// A forecast that will not show how it has done before is asking to be taken on
// faith. These three charts are the ones that could embarrass it, which is why
// they are here rather than in an appendix -- and two of them are computed by
// the build from data the engine was never tuned on.
import d3 from '../d3.js';
import { term } from '../glossary.js';
import { C, svg, showTip, hideTip, hoverable } from './util.js';

// ---- 1. reliability: does a 70% mean 70%? --------------------------------
export function reliability(host, { bands }) {
  host.replaceChildren();
  const W = 330, H = 300, m = { t: 12, r: 12, b: 42, l: 46 };
  const x = d3.scaleLinear().domain([0, 1]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  const r = d3.scaleSqrt().domain([0, d3.max(bands, b => b.n)]).range([2.5, 10]);
  const s = svg(host, W, H, 'Predicted probability against observed frequency');

  s.append('g').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', C.line);
  s.append('line')
    .attr('x1', x(0)).attr('y1', y(0)).attr('x2', x(1)).attr('y2', y(1))
    .attr('stroke', C.ink).attr('stroke-opacity', 0.45).attr('stroke-dasharray', '4 3');
  s.append('text').attr('x', x(0.58)).attr('y', y(0.72)).attr('fill', C.muted)
    .attr('font-size', 10.5).attr('text-anchor', 'end').text('perfect calibration');

  s.append('path')
    .attr('d', d3.line().x(b => x(b.predicted)).y(b => y(b.observed))(bands))
    .attr('fill', 'none').attr('stroke', C.dem).attr('stroke-width', 1.5).attr('stroke-opacity', 0.6);

  const dots = s.selectAll('circle').data(bands).join('circle')
    .attr('cx', b => x(b.predicted)).attr('cy', b => y(b.observed)).attr('r', b => r(b.n))
    .attr('fill', C.dem).attr('fill-opacity', 0.75)
    .attr('stroke', C.surface).attr('stroke-width', 2);
  hoverable(dots, b =>
    `<b>${b.band}</b><br>predicted ${(b.predicted * 100).toFixed(1)}% · ` +
    `observed ${(b.observed * 100).toFixed(1)}%<br><span class="tip-dim">${b.n.toLocaleString()} races</span>`);

  for (const [g, ax, lbl] of [
    [s.append('g').attr('transform', `translate(0,${H - m.b})`), d3.axisBottom(x).ticks(5).tickFormat(d3.format('.0%')), 'forecast probability'],
    [s.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')), null],
  ]) {
    g.call(ax.tickSizeOuter(0));
    g.selectAll('text').attr('fill', C.muted).attr('font-size', 10);
    g.selectAll('line,path').attr('stroke', C.line);
  }
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 3).attr('text-anchor', 'middle')
    .attr('fill', C.faint).attr('font-size', 10.5).text('forecast probability');
  s.append('text').attr('transform', `translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5)
    .text('share that actually happened');
  host.append(caption(
    `Take every race the model gave roughly a 70% chance to, and count how many of them actually ` +
    `happened. If the model is honest about what it knows, about 70% did. Each dot is one band of ` +
    `forecast probability: across is what the model said, up is what the races in that band ` +
    `actually did, and the dot's area is how many races are in it. On the dashed line, the two ` +
    `agree. <b>Below the line the model was overconfident</b> — it claimed 70% and got less. ` +
    `Above it, it was too cautious.`));
}

// ---- 2. leave-one-cycle-out ---------------------------------------------
export function locoChart(host, { loco }) {
  host.replaceChildren();
  const W = 330, H = 300, m = { t: 12, r: 12, b: 42, l: 46 };
  const x = d3.scaleLinear().domain(d3.extent(loco, r => r.days)).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, 2.2]).range([H - m.b, m.t]);
  const s = svg(host, W, H, 'Standardised residual spread against forecast horizon');

  s.append('g').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', C.line);
  s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(1)).attr('y2', y(1))
    .attr('stroke', C.ink).attr('stroke-opacity', 0.5).attr('stroke-dasharray', '4 3');
  s.append('text').attr('x', W - m.r).attr('y', y(1) - 5).attr('text-anchor', 'end')
    .attr('fill', C.muted).attr('font-size', 10.5).text('1.0 = honest intervals');

  for (const [key, col, dash] of [['v0_sd_z', C.rep, null], ['sd_z', C.dem, null]]) {
    s.append('path').attr('d', d3.line().x(r => x(r.days)).y(r => y(r[key]))(loco))
      .attr('fill', 'none').attr('stroke', col).attr('stroke-width', 2)
      .attr('stroke-dasharray', dash);
    const dots = s.selectAll(`circle.${key}`).data(loco).join('circle').attr('class', key)
      .attr('cx', r => x(r.days)).attr('cy', r => y(r[key])).attr('r', 4)
      .attr('fill', col).attr('stroke', C.surface).attr('stroke-width', 1.5);
    hoverable(dots, r =>
      `<b>${r.days} days out</b><br>this model sd(z) ${r.sd_z.toFixed(2)}, 80% band ` +
      `${(r.coverage['80'] * 100).toFixed(0)}%<br>` +
      `<span class="tip-dim">earlier model: ${r.v0_sd_z.toFixed(2)}, band covered ` +
      `${(r.v0_coverage_80 * 100).toFixed(0)}%</span>`);
  }

  for (const [g, ax] of [
    [s.append('g').attr('transform', `translate(0,${H - m.b})`), d3.axisBottom(x).tickValues(loco.map(r => r.days)).tickFormat(d3.format('d'))],
    [s.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5)],
  ]) {
    g.call(ax.tickSizeOuter(0));
    g.selectAll('text').attr('fill', C.muted).attr('font-size', 10);
    g.selectAll('line,path').attr('stroke', C.line);
  }
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 3).attr('text-anchor', 'middle')
    .attr('fill', C.faint).attr('font-size', 10.5).text('days before the election');
  s.append('text').attr('transform', `translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5)
    .text('actual spread ÷ predicted spread');

  host.append(caption(
    `A different question from the one on the left: not "were the calls right" but "were the ` +
    `<em>error bars</em> the right size". Every past poll is scored as how many of the model's own ` +
    `predicted standard deviations it missed by. If the model has the width right those misses ` +
    `spread out with a standard deviation of <b>1.0</b>, the dashed line. <b>Above 1.0 the ` +
    `intervals are too narrow</b> and the model is claiming to know more than it does; below, they ` +
    `are wider than they need to be. Shown for ` +
    `<span style="color:${C.dem}">this model</span> against ` +
    `<span style="color:${C.rep}">the earlier version it replaced</span>, which used one fixed ` +
    `error width for every race regardless of how much was known about it. The curve is refitted ` +
    `each time with the cycle being scored held out, so no cycle grades itself.`));
}

// ---- 3. replaying real elections ----------------------------------------
export function seatMisses(host, { rows }) {
  host.replaceChildren();
  const cycles = [...new Set(rows.map(r => r.cycle))].sort();
  const final = cycles.map(c => rows.filter(r => r.cycle === c).sort((a, b) => a.days_out - b.days_out)[0]);
  const lo = d3.min(final, r => Math.min(r.seats_p10, r.seats_actual)) - 6;
  const hi = d3.max(final, r => Math.max(r.seats_p90, r.seats_actual)) + 6;
  const W = 330, rowH = 62, m = { t: 18, r: 16, b: 40, l: 46 };
  const H = cycles.length * rowH + m.t + m.b;
  const x = d3.scaleLinear().domain([lo, hi]).range([m.l, W - m.r]);
  const s = svg(host, W, H, 'Predicted seat range against the actual result, three cycles');

  const g = s.selectAll('g.row').data(final).join('g').attr('class', 'row')
    .attr('transform', (d, i) => `translate(0,${m.t + i * rowH + rowH / 2})`);

  g.append('line').attr('x1', r => x(r.seats_p10)).attr('x2', r => x(r.seats_p90))
    .attr('stroke', C.dem).attr('stroke-width', 7).attr('stroke-opacity', 0.32)
    .attr('stroke-linecap', 'round');
  g.append('line').attr('x1', r => x(r.seats_median)).attr('x2', r => x(r.seats_median))
    .attr('y1', -8).attr('y2', 8).attr('stroke', C.dem).attr('stroke-width', 2.5);
  g.append('circle').attr('cx', r => x(r.seats_actual)).attr('cy', 0).attr('r', 5)
    .attr('fill', C.accent).attr('stroke', C.surface).attr('stroke-width', 2);
  g.append('text').attr('x', m.l - 8).attr('y', 4).attr('text-anchor', 'end')
    .attr('fill', C.dim).attr('font-size', 12).text(r => r.cycle);
  g.append('text').attr('x', m.l).attr('y', 24).attr('fill', C.faint).attr('font-size', 10.5)
    .text(r => `predicted ${r.seats_median.toFixed(0)}, actual ${r.seats_actual} · ` +
               `${r.seats_actual >= r.seats_p10 && r.seats_actual <= r.seats_p90 ? 'inside' : 'OUTSIDE'} the 80%`);
  hoverable(g, r =>
    `<b>${r.cycle}</b>, 7 days out<br>predicted ${r.seats_median.toFixed(0)} ` +
    `(80%: ${r.seats_p10}–${r.seats_p90})<br>actual <b>${r.seats_actual}</b><br>` +
    `<span class="tip-dim">outcome sat at the ${(r.seats_pit * 100).toFixed(0)}th percentile</span>`);

  const ax = s.append('g').attr('transform', `translate(0,${H - m.b + 6})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('d')).tickSizeOuter(0));
  ax.selectAll('text').attr('fill', C.muted).attr('font-size', 10);
  ax.selectAll('line,path').attr('stroke', C.line);
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 3).attr('text-anchor', 'middle')
    .attr('fill', C.faint).attr('font-size', 10.5).text('Democratic House seats');

  const rms = Math.sqrt(d3.mean(final, r => (r.seats_median - r.seats_actual) ** 2));
  host.append(caption(
    `The bluntest check there is: run the whole model on a past election and see what it said. The ` +
    `bar is the range the model gave 80% of its draws to, the tick is what it called most likely, ` +
    `and the gold dot is what actually happened. Each cycle was replayed through this same engine ` +
    `with its own calibration removed first, and scored against all 435 districts rather than only ` +
    `the ones somebody polled. Typical miss <b>${rms.toFixed(1)}</b> seats. ` +
    `<b>Three cycles is far too few to call this settled</b> — and 2020 is a presidential year ` +
    `being judged by a midterm model.`));
}

function caption(html) {
  const p = document.createElement('p');
  p.className = 'chart-note';
  p.innerHTML = html;
  return p;
}

// ---- 4. the other two chambers -------------------------------------------
//
// The three charts above are House replays, and for a long time they were the
// whole of what this page showed about the model's error. That implied the other
// two chambers had never been checked. They had:
//
//   * engine/backtest/senate_prior.py measured the Senate prior ratio against 97
//     real Senate races over three cycles, and did NOT adopt its own answer --
//     three cycles of Senate maps cannot separate 1.46 from the 1.625 shipped.
//     A measurement that fails to overturn the assumption is still a measurement,
//     and hiding it is how a page comes to look better tested than it is.
//   * engine/backtest/governor_sensitivity.py asked whether the governor sigma is
//     worth fitting before fitting it, found the data does not exist in a usable
//     shape, and swept the whole range of ignorance instead.
//
// Neither is a reliability curve, because neither could honestly be one: ~100
// races across three cycles that share a national error apiece is nowhere near
// the sample the House curve rests on. They are the checks the evidence supports.

export function senateRatio(host, { fit }) {
  host.replaceChildren();
  const cycles = fit.per_cycle;
  const W = 330, H = 240, m = { t: 14, r: 14, b: 46, l: 44 };
  const lo = Math.min(0.6, ...cycles.map(c => c.ratio)) - 0.15;
  const hi = Math.max(2.4, ...cycles.map(c => c.ratio)) + 0.15;
  const x = d3.scaleLinear().domain([lo, hi]).range([m.l, W - m.r]);
  const y = d3.scalePoint().domain([...cycles.map(c => String(c.cycle)), 'pooled'])
    .range([m.t + 14, H - m.b - 10]).padding(0.5);
  const s = svg(host, W, H, 'Measured Senate prior ratio, by cycle and pooled');

  // The shipped value first, because everything else is read against it.
  s.append('line').attr('x1', x(fit.shipped_value)).attr('x2', x(fit.shipped_value))
    .attr('y1', m.t).attr('y2', H - m.b).attr('stroke', C.accent).attr('stroke-width', 2);
  s.append('text').attr('x', x(fit.shipped_value) + 5).attr('y', m.t + 8)
    .attr('fill', C.accent).attr('font-size', 10.5).attr('font-weight', 600)
    .text(`shipped ${fit.shipped_value}`);

  // Pooled estimate and its CLUSTERED standard error -- the plain se is 0.11 and
  // would draw a confident little bar; clustering on the cycle is what says the
  // effective sample here is three, not ninety-seven.
  const band = s.append('g');
  band.append('rect')
    .attr('x', x(fit.ratio - fit.clustered_se)).attr('y', y('pooled') - 7)
    .attr('width', x(fit.ratio + fit.clustered_se) - x(fit.ratio - fit.clustered_se))
    .attr('height', 14).attr('rx', 2)
    .attr('fill', C.dem).attr('fill-opacity', 0.22);
  band.append('line')
    .attr('x1', x(fit.ratio)).attr('x2', x(fit.ratio))
    .attr('y1', y('pooled') - 8).attr('y2', y('pooled') + 8)
    .attr('stroke', C.dem).attr('stroke-width', 2.5);

  const dots = s.selectAll('circle').data(cycles).join('circle')
    .attr('cx', c => x(c.ratio)).attr('cy', c => y(String(c.cycle))).attr('r', 4.5)
    .attr('fill', C.dem).attr('fill-opacity', 0.85)
    .attr('stroke', C.surface).attr('stroke-width', 2);
  hoverable(dots, c =>
    `<b>${c.cycle}</b> · ratio ${c.ratio.toFixed(2)}<br>` +
    `${c.n_senate} Senate races, ${c.n_house} House districts<br>` +
    `<span class="tip-dim">error width, Senate ${c.sigma_senate.toFixed(1)} vs House ` +
    `${c.sigma_house.toFixed(1)} · environment D${c.env > 0 ? '+' : ''}${c.env}</span>`);

  for (const [g, ax] of [
    [s.append('g').attr('transform', `translate(0,${H - m.b})`), d3.axisBottom(x).ticks(5)],
    [s.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y)],
  ]) {
    g.call(ax.tickSizeOuter(0));
    g.selectAll('text').attr('fill', C.muted).attr('font-size', 10.5);
    g.selectAll('line,path').attr('stroke', C.line);
  }
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 4)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5)
    .text('Senate prior error ÷ House prior error');

  const note = document.createElement('p');
  note.className = 'chart-note';
  note.innerHTML =
    `The model starts a Senate race with a wider ${term('sigma')} than a House district — `
    + `<b>${fit.shipped_value}×</b>. That multiplier was assumed. This is the attempt to measure it.`
    + `<table class="fx"><tbody>`
    + `<tr><th>Each dot</th><td>What one past cycle says the ratio should be</td></tr>`
    + `<tr><th>The bar</th><td>All three pooled: <b>${fit.ratio.toFixed(2)}</b> over `
    + `${fit.n_senate} Senate races and ${fit.n_house} House districts</td></tr>`
    + `<tr><th>Bar width</th><td>The ${term('clustered-se')} `
    + `(${fit.clustered_se.toFixed(2)}), not the plain one (${fit.se.toFixed(2)})</td></tr>`
    + `<tr><th>Verdict</th><td>The bar overlaps the shipped ${fit.shipped_value}. The measurement `
    + `cannot tell the two apart, so it was not adopted.</td></tr>`
    + `</tbody></table>`
    + `<p>Shown because a measurement that fails to overturn an assumption is still a measurement. `
    + `Fitted ${fit.fitted_on || ''}.</p>`;
  host.append(note);
}

export function governorSweep(host, { sweep }) {
  host.replaceChildren();
  const pts = sweep.points;
  const W = 330, H = 240, m = { t: 14, r: 16, b: 46, l: 44 };
  const x = d3.scaleLinear().domain(d3.extent(pts, p => p.ratio)).range([m.l, W - m.r]);
  const lo = Math.min(...pts.map(p => p.p10)), hi = Math.max(...pts.map(p => p.p90));
  const y = d3.scaleLinear().domain([lo - 1, hi + 1]).range([H - m.b, m.t]);
  const s = svg(host, W, H, 'Governor seat forecast against the unfitted prior ratio');

  s.append('g').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', C.line);

  // The 80% interval widens with the ratio and the median does not move at all,
  // which is the finding: the asserted number governs the width and not the answer.
  s.append('path').attr('fill', C.dem).attr('fill-opacity', 0.18)
    .attr('d', d3.area().x(p => x(p.ratio)).y0(p => y(p.p10)).y1(p => y(p.p90))(pts));
  s.append('path').attr('fill', 'none').attr('stroke', C.dem).attr('stroke-width', 2)
    .attr('d', d3.line().x(p => x(p.ratio)).y(p => y(p.expected))(pts));

  s.append('line').attr('x1', x(sweep.shipped_ratio)).attr('x2', x(sweep.shipped_ratio))
    .attr('y1', m.t).attr('y2', H - m.b).attr('stroke', C.accent).attr('stroke-width', 2);
  s.append('text').attr('x', x(sweep.shipped_ratio) + 5).attr('y', m.t + 8)
    .attr('fill', C.accent).attr('font-size', 10.5).attr('font-weight', 600)
    .text(`shipped ${sweep.shipped_ratio}`);

  const dots = s.selectAll('circle').data(pts).join('circle')
    .attr('cx', p => x(p.ratio)).attr('cy', p => y(p.expected)).attr('r', 3.5)
    .attr('fill', C.dem).attr('stroke', C.surface).attr('stroke-width', 1.5);
  hoverable(dots, p =>
    `ratio <b>${p.ratio}</b> · error width ${p.sigma.toFixed(2)}<br>` +
    `median ${p.median} · 80% ${p.p10}–${p.p90}<br>` +
    `<span class="tip-dim">expected ${p.expected.toFixed(2)} governorships</span>`);

  for (const [g, ax] of [
    [s.append('g').attr('transform', `translate(0,${H - m.b})`), d3.axisBottom(x).ticks(5)],
    [s.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickFormat(d3.format('d'))],
  ]) {
    g.call(ax.tickSizeOuter(0));
    g.selectAll('text').attr('fill', C.muted).attr('font-size', 10.5);
    g.selectAll('line,path').attr('stroke', C.line);
  }
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 4)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5)
    .text('assumed governor error ÷ House error');

  const note = document.createElement('p');
  note.className = 'chart-note';
  note.innerHTML =
    `This ${term('sigma')} could not be fitted — no source publishes statewide governor results in `
    + `the shape the fit needs — so it is asserted, and the model measures what rests on it.`
    + `<table class="fx"><tbody>`
    + `<tr><th>Range tested</th><td><b>×${(+sweep.range[0]).toFixed(2)}–${(+sweep.range[1]).toFixed(2)}</b>, `
    + `taken from how far the Senate figure moved across its own three cycles</td></tr>`
    + `<tr><th>Median</th><td><b>${sweep.median_values.join('/')}</b> governorships across the whole sweep</td></tr>`
    + `<tr><th>Expected count</th><td>shifts <b>${sweep.expected_span.toFixed(2)}</b> of a seat</td></tr>`
    + `<tr><th>The shaded band</th><td>widens — being wrong here makes the forecast less certain, `
    + `not differently centred</td></tr>`
    + `</tbody></table>`;
  host.append(note);
}
