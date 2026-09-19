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
    `Each dot: races in one probability band, sized by count. On the dashed line, a 70% call came ` +
    `true 70% of the time. <b>Below it: overconfident.</b>`));
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
    `<code>z = miss ÷ predicted σ</code>; honest ` +
    `intervals give <code>sd(z) = 1.0</code>. <b>Above it: too narrow.</b> ` +
    `<span style="color:${C.dem}">This model</span> against ` +
    `<span style="color:${C.rep}">its fixed-width predecessor</span>.`));
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
    `Bar: 80% of draws. Tick: most likely. Gold: what happened. Typical miss ` +
    `<b>${rms.toFixed(1)}</b> seats, over <b>three cycles</b> \u2014 too few to settle, and 2020 ` +
    `was a presidential year.`));
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
//   * engine/calibrate/fit_governor_prior.py fits the governor prior on 295 polled
//     governor generals in the 538 corpus. Until 2026-09-15 this card was a sweep
//     of an asserted sigma, on the belief that no governor returns were usable;
//     the corpus had carried them all along.
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

  // A div, not a p -- this note carries a fact table.
  const note = document.createElement('div');
  note.className = 'chart-note';
  note.innerHTML =
    `Senate ${term('sigma')} = House × <b>${fit.shipped_value}</b>, assumed. Measured:`
    + `<table class="fx"><tbody>`
    + `<tr><th>Dots</th><td>one cycle each</td></tr>`
    + `<tr><th>Pooled</th><td><b>${fit.ratio.toFixed(2)}</b>, ${fit.n_senate} Senate races, `
    + `${fit.n_house} House districts</td></tr>`
    + `<tr><th>Bar</th><td>${term('clustered-se')} ${fit.clustered_se.toFixed(2)}</td></tr>`
    + `<tr><th>Verdict</th><td>overlaps ${fit.shipped_value}; not adopted</td></tr>`
    + `</tbody></table>`;
  host.append(note);
}

// The governor prior against the form it replaced, held out by cycle. Grouped bars
// by the kind of race, because the gain is not even: it is largest exactly where
// the old form was most wrong, a governor running in a state that leans the other
// way (Scott in Vermont, Hogan in Maryland, Kelly in Kansas).
export function governorPrior(host, { fit }) {
  host.replaceChildren();
  const groups = [['all', 'all races'], ['incumbents', 'incumbent running'],
                  ['incumbent_against_lean', 'incumbent vs state lean'], ['open', 'open seat']];
  const forms = [['M0', 'lean + incumbency', C.faint], ['M2', 'fitted', C.dem]];
  const W = 330, rowH = 40, m = { t: 8, r: 34, b: 30, l: 150 };
  const H = groups.length * rowH + m.t + m.b;
  const max = Math.max(...groups.flatMap(([k]) => forms.map(([f]) => fit.loco_rmse[f][k])));
  const x = d3.scaleLinear().domain([0, max * 1.05]).range([m.l, W - m.r]);
  const s = svg(host, W, H, 'Held-out error of the governor prior, old form against fitted');
  groups.forEach(([k, label], i) => {
    const y0 = m.t + i * rowH;
    s.append('text').attr('x', m.l - 8).attr('y', y0 + rowH / 2 + 3).attr('text-anchor', 'end')
      .attr('fill', C.muted).attr('font-size', 10.5).text(label);
    forms.forEach(([f, name, col], j) => {
      const v = fit.loco_rmse[f][k], y = y0 + 6 + j * 14;
      const bar = s.append('rect').attr('x', m.l).attr('y', y).attr('height', 11)
        .attr('width', x(v) - m.l).attr('fill', col);
      hoverable(bar, () => `<b>${name}</b> · ${label}<br>misses by ${v.toFixed(1)} pts, held out`);
      s.append('text').attr('x', x(v) + 4).attr('y', y + 9).attr('fill', C.muted)
        .attr('font-size', 10).text(v.toFixed(1));
    });
  });
  s.append('g').attr('transform', `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).ticks(4).tickSizeOuter(0))
    .call(g => { g.selectAll('text').attr('fill', C.muted).attr('font-size', 10.5);
                 g.selectAll('line,path').attr('stroke', C.line); });
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 2).attr('text-anchor', 'middle')
    .attr('fill', C.faint).attr('font-size', 10.5).text('RMSE, points');

  const c = fit.coefficients;
  const note = document.createElement('div');
  note.className = 'chart-note';
  note.innerHTML =
    `<span style="color:${C.faint}">Grey</span>: lean + 2.5 for an incumbent, the old form. `
    + `<span style="color:${C.dem}">Blue</span>: fitted on ${fit.n} races, ${fit.cycles[0]}–${fit.cycles[1]}.`
    + `<table class="fx"><tbody>`
    + `<tr><th>Lean</th><td>×${c.lean.toFixed(2)}</td></tr>`
    + `<tr><th>Incumbent running</th><td>${c.inc >= 0 ? '+' : ''}${c.inc.toFixed(1)} pts</td></tr>`
    + `<tr><th>Their last margin</th><td>×${c.last.toFixed(2)}</td></tr>`
    // The lean discount that comes with having a record: every race with a last
    // margin runs its lean at lean + this, not at the lean row above alone.
    + (c.lean_x_has_last != null
      ? `<tr><th>Lean, where there is a last margin</th><td>×${(c.lean + c.lean_x_has_last).toFixed(2)} `
        + `(${c.lean.toFixed(2)} ${c.lean_x_has_last >= 0 ? '+' : '−'} ${Math.abs(c.lean_x_has_last).toFixed(2)})</td></tr>`
      : '')
    + `<tr><th>${term('sigma')}</th><td>±${fit.sigma.toFixed(1)}</td></tr>`
    + `</tbody></table>`;
  host.append(note);
}
