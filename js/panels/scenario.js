// The generic-ballot bias, as something you can move.
//
// README calls the instrument-bias correction "the model's most leveraged
// single number", worth about 9 points of House control per point, fitted on 13
// cycles with a standard error of 0.83 and per-cycle errors running -1.9 to
// +6.2. Anyone doubting the headline should start here, so here is the place to
// doubt it: every stop on this slider is a real posterior rebuild and a real
// 20,000-draw resimulation, done at build time, not an interpolation.
//
// Common random numbers across the sweep, so moving the slider shows the effect
// of the environment and not Monte Carlo noise.
import d3 from '../d3.js';
import { term } from '../glossary.js';
import { C, svg, showTip, hideTip } from '../charts/util.js';

const STYLE = {
  house:    { label: 'House', dash: null, width: 2, opacity: 1 },
  senate:   { label: 'Senate', dash: '5 3', width: 2, opacity: 0.75 },
  governor: { label: 'Governors', dash: null, width: 2, opacity: 1 },
};

// Draw one x-shared chart: `series` are the chambers on it, `get` reads the
// quantity, `y` scales it. Two calls, because the sweep produces two different
// quantities -- a probability of control for the chambers that have one, and a
// seat count for governors, who do not. They cannot share an axis, and a second
// y-axis stuck on the same frame would invite exactly the comparison that is
// meaningless.
function curve(host, { rows, series, get, yDomain, yTicks, xLabel, yLabel, title,
                       fittedIdx, height = 210 }) {
  const W = 460, H = height, m = { t: 12, r: 14, b: xLabel ? 38 : 26, l: 52 };
  const x = d3.scaleLinear().domain(d3.extent(rows, r => r.bias)).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain(yDomain).range([H - m.b, m.t]);
  const s = svg(host, W, H, title);

  s.append('g').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y)
    .attr('stroke', C.line);
  // Even odds is a line on a probability axis and nothing on a count axis.
  if (yDomain[0] === 0 && yDomain[1] === 1) {
    s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0.5)).attr('y2', y(0.5))
      .attr('stroke', C.ink).attr('stroke-opacity', 0.45).attr('stroke-dasharray', '3 3');
  }

  for (const c of series) {
    const st = STYLE[c] || {};
    s.append('path').attr('d', d3.line().x(r => x(r.bias)).y(r => y(get(r, c)))(rows))
      .attr('fill', 'none').attr('stroke', C.dem).attr('stroke-width', st.width ?? 2)
      .attr('stroke-dasharray', st.dash).attr('stroke-opacity', st.opacity ?? 1);
  }

  s.append('line')
    .attr('x1', x(rows[fittedIdx].bias)).attr('x2', x(rows[fittedIdx].bias))
    .attr('y1', m.t).attr('y2', H - m.b)
    .attr('stroke', C.accent).attr('stroke-width', 1).attr('stroke-dasharray', '2 3');
  const cursor = s.append('line').attr('y1', m.t).attr('y2', H - m.b)
    .attr('stroke', C.accent).attr('stroke-width', 2);
  const dots = series.map((c, k) => s.append('circle')
    .attr('r', k === 0 ? 4.5 : 3.5)
    .attr('fill', k === 0 ? C.dem : C.surface)
    .attr('stroke', C.dem).attr('stroke-width', k === 0 ? 0 : 2));

  for (const [g, axis] of [
    [s.append('g').attr('transform', `translate(0,${H - m.b})`),
     d3.axisBottom(x).ticks(6).tickFormat(v => `${v > 0 ? '+' : ''}${v}`)],
    [s.append('g').attr('transform', `translate(${m.l},0)`),
     d3.axisLeft(y).ticks(5).tickFormat(yTicks)],
  ]) {
    g.call(axis.tickSizeOuter(0));
    g.selectAll('text').attr('fill', C.muted).attr('font-size', 10.5);
    g.selectAll('line,path').attr('stroke', C.line);
  }
  if (xLabel) {
    s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 2).attr('text-anchor', 'middle')
      .attr('fill', C.faint).attr('font-size', 10.5).text(xLabel);
  }
  s.append('text').attr('transform', `translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5)
    .text(yLabel);

  return { s, x, y, cursor, dots, series, get };
}

export function scenarioPanel(host, { scenarios, environment, chambers, onPick }) {
  // The fitted bias and its standard error come from the payload, never retyped.
  const fitted = scenarios.fitted_bias;
  const se = environment.instrument_bias_se;
  host.replaceChildren();
  const rows = scenarios.scenarios;
  const fittedIdx = rows.findIndex(r => r.fitted);
  let i = fittedIdx;

  // Which chambers the sweep actually recorded, split by the quantity it
  // recorded for them. Read off the payload rather than named here, so a sweep
  // that gains or loses a chamber needs no edit on this side.
  const present = (chambers || Object.keys(STYLE)).filter(c => rows[0][c]);
  const probCh = present.filter(c => rows[0][c].p != null);
  const countCh = present.filter(c => rows[0][c].p == null);

  const wrap = document.createElement('div');
  wrap.className = 'scenario';

  // --- the curves --------------------------------------------------------
  const chart = document.createElement('div');
  const panels = [];
  if (probCh.length) {
    panels.push(curve(chart, {
      rows, series: probCh, get: (r, c) => r[c].p, fittedIdx,
      yDomain: [0, 1], yTicks: d3.format('.0%'),
      xLabel: countCh.length ? null : 'assumed generic-ballot bias, points toward Democrats',
      yLabel: 'probability of Democratic control',
      title: 'Probability of Democratic control against assumed generic-ballot bias',
    }));
  }
  if (countCh.length) {
    const vs = rows.flatMap(r => countCh.map(c => r[c].median));
    panels.push(curve(chart, {
      rows, series: countCh, get: (r, c) => r[c].median, fittedIdx, height: 150,
      yDomain: [Math.min(...vs) - 1, Math.max(...vs) + 1], yTicks: d3.format('d'),
      xLabel: 'assumed generic-ballot bias, points toward Democrats',
      yLabel: 'Democratic governorships',
      title: 'Median Democratic governorships against assumed generic-ballot bias',
    }));
  }

  // --- control + readout --------------------------------------------------
  const ctl = document.createElement('div');
  ctl.className = 'scenario-ctl';
  const range = document.createElement('input');
  range.type = 'range'; range.min = 0; range.max = rows.length - 1; range.step = 1; range.value = i;
  range.setAttribute('aria-label', 'Assumed generic-ballot bias');
  const reset = document.createElement('button');
  reset.className = 'chip'; reset.textContent = 'Back to the fitted value';
  const read = document.createElement('div');
  read.className = 'scenario-read';
  ctl.append(range, reset);

  function paint() {
    const r = rows[i];
    for (const P of panels) {
      P.cursor.attr('x1', P.x(r.bias)).attr('x2', P.x(r.bias));
      P.series.forEach((c, k) =>
        P.dots[k].attr('cx', P.x(r.bias)).attr('cy', P.y(P.get(r, c))));
    }
    const fit = rows[fittedIdx];
    // One row per chamber the sweep recorded. A chamber with no control
    // probability shows its seat median as the headline number instead of a
    // percentage -- the same substitution the topline cards make, for the same
    // reason.
    const row = c => {
      const v = r[c], st = STYLE[c] || { label: c };
      if (v.p == null) {
        return `<div class="sc-row big"><span class="sc-k">${st.label} · D won</span>
          <span class="sc-v" style="color:${C.dem}">${v.median}</span>
          <span class="sc-sub">80% range ${v.p10}–${v.p90} · no control to win</span></div>`;
      }
      return `<div class="sc-row big"><span class="sc-k">${st.label} · D control</span>
        <span class="sc-v" style="color:${v.p >= 0.5 ? C.dem : C.rep}">
          ${(v.p * 100).toFixed(1)}%</span>
        <span class="sc-sub">median ${v.median} · ${v.p10}–${v.p90}</span></div>`;
    };
    read.innerHTML = `
      <div class="sc-row"><span class="sc-k">Assumed bias</span>
        <span class="sc-v">${r.bias > 0 ? '+' : ''}${r.bias.toFixed(2)} pts${r.fitted ? ' <em>fitted</em>' : ''}</span></div>
      <div class="sc-row"><span class="sc-k">Environment</span>
        <span class="sc-v">D${r.environment > 0 ? '+' : ''}${r.environment.toFixed(2)}</span></div>
      ${present.map(row).join('')}
      ${r.fitted || !r.house ? '' :
        `<div class="sc-delta">${r.house.p > fit.house.p ? '+' : ''}${((r.house.p - fit.house.p) * 100).toFixed(1)}
          points of House control against the fitted value.</div>`}`;
  }
  range.oninput = e => { i = +e.target.value; paint(); };
  reset.onclick = () => { i = fittedIdx; range.value = i; paint(); };

  for (const P of panels) {
    P.s.on('pointermove', e => {
      const r = rows[Math.max(0, Math.min(rows.length - 1,
        Math.round((P.x.invert(d3.pointer(e)[0]) - rows[0].bias) / scenarios.step)))];
      showTip(e, `bias ${r.bias > 0 ? '+' : ''}${r.bias.toFixed(2)}<br>` +
        present.map(c => `${(STYLE[c] || {}).label || c} <b>` +
          (r[c].p == null ? `${r[c].median}` : `${(r[c].p * 100).toFixed(1)}%`) + '</b>').join(' · '));
    }).on('pointerleave', hideTip);
  }

  wrap.append(chart, ctl, read);
  host.append(wrap);

  const key = document.createElement('div');
  key.className = 'keys';
  const swatch = c => (STYLE[c]?.dash
    ? `repeating-linear-gradient(90deg,${C.dem} 0 4px,transparent 4px 7px)`
    : C.dem);
  key.innerHTML =
    present.map(c => `<span class="key"><i style="background:${swatch(c)}"></i>` +
      `${(STYLE[c] || {}).label || c}` +
      (rows[0][c].p == null ? ' <em>seats won, lower panel</em>' : '') + '</span>').join('') +
    `<span class="key"><i style="background:${C.accent}"></i>fitted, +${fitted}</span>`;
  key.setAttribute('aria-label',
    'Curves show the probability of Democratic control, except governors, which show seats won');
  host.append(key);

  const note = document.createElement('p');
  note.className = 'chart-note';
  note.innerHTML =
    `Every stop is a full rebuild: each race's estimate recomputed at that `
    + `${term('generic-ballot')} correction, then fresh simulations. Not an interpolation between `
    + `two answers. Drag left to assume the generic ballot flatters Democrats less than history `
    + `says; right to assume it flatters them more.`
    + `<br><br>The fitted <b>+${fitted}</b> is an average over 13 cycles.`
    + `<table class="fx"><tbody>`
    + `<tr><th>Standard error</th><td>${se} — the long-run figure could sit from `
    + `+${(fitted - 2 * se).toFixed(1)} to +${(fitted + 2 * se).toFixed(1)}</td></tr>`
    + `<tr><th>Range across cycles</th><td>−1.9 to +6.2 — wider still</td></tr>`
    + `<tr><th>Why the slider spans that</th><td>A single election can miss the long-run average `
    + `by more than the long-run average is itself uncertain</td></tr>`
    + `</tbody></table>`;
  host.append(note);
  paint();
}
