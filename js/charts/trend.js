// The forecast over time — and the breaks in it.
//
// A trend chart is the easiest place on this page to tell a lie by accident. The
// first two runs put House control at 67.1% and 50.2% two days apart; joining
// them says opinion moved seventeen points in a weekend, when what actually
// moved was the model — the 2026-line priors landed and the generic-ballot
// source changed between them. Every point here is a forecast made by a
// DIFFERENT forecaster from the one before it unless the run artifacts say
// otherwise, so the series is drawn segmented: solid only across edges the
// engine has certified comparable (engine/history.py), and broken where the
// method changed or where a run is too old to say.
//
// The break is drawn, not hidden. A gap with a marker and a reason is honest
// about what the series can support; a smooth line through it is not.

import d3 from '../d3.js';
import { C, fmtPct, svg, hoverable } from './util.js';

const CH = {
  house: { label: 'House', col: C.dem },
  senate: { label: 'Senate', col: C.accent },
  governor: { label: 'Governors', col: '#7fb08a' },
};

// Two different quantities, so two different panels rather than two lines on one
// axis. A chamber with a majority to hold has a probability of control and is
// plotted 0-100%; governors have no majority and are plotted as the seat median,
// because "how many" is the question they do answer. Drawing a count on a
// probability axis -- 20 governorships against a scale that tops out at 1 -- is
// the kind of chart that is wrong before anyone has read it.
const KIND = {
  prob: {
    get: (p, c) => p[c].control_prob,
    domain: () => [0, 1],
    tick: d3.format('.0%'),
    rule: 0.5,
    label: 'P(Democratic control)',
    title: 'Probability of Democratic control over successive runs',
    note: named => `${named} control`,
    say: (r, c) => `${CH[c].label} ${fmtPct(r[c].control_prob)} D control, ` +
                   `median ${r[c].median} seats`,
  },
  count: {
    get: (p, c) => p[c].median,
    domain: rows => {
      const vs = rows.flatMap(r => r._series.map(c => r[c].median));
      return [Math.min(...vs) - 2, Math.max(...vs) + 2];
    },
    tick: d3.format('d'),
    rule: null,
    label: 'Democratic governorships (median)',
    title: 'Median Democratic governorships over successive runs',
    // Not "Governors control": there is none to hold, which is the whole reason
    // this panel exists separately from the one above it.
    note: named => `${named}, the median number won,`,
    say: (r, c) => `${CH[c].label} median ${r[c].median}, ` +
                   `80% range ${r[c].p10}–${r[c].p90}`,
  },
};

export function trendChart(host, { history, chambers = Object.keys(CH) }) {
  host.replaceChildren();
  const pts = history?.points ?? [];
  // A chamber is drawn only where EVERY run recorded it. A series that starts
  // halfway along would be indistinguishable from one that moved.
  const show = chambers.filter(c => CH[c] && pts.every(p => p[c]));

  if (pts.length < 2) {
    const p = document.createElement('p');
    p.className = 'chart-note';
    p.innerHTML = `Only ${pts.length} run${pts.length === 1 ? '' : 's'} so far. A trend needs a `
      + `cadence, not a second point — the series starts once the model has been run on a `
      + `schedule for long enough that a change in it is news about the electorate rather than `
      + `about the build.`;
    host.append(p);
    return;
  }

  if (!show.length) {
    const p = document.createElement('p');
    p.className = 'chart-note';
    p.innerHTML = `No run in this history recorded a series for that chamber, so there is nothing `
      + `to draw. A series only appears once every published run carries it.`;
    host.append(p);
    return;
  }

  // Split by the quantity, not by the chamber name: a chamber belongs to the
  // count panel because its control probability is null, which is a fact the
  // payload states rather than one this file remembers.
  const groups = [
    ['prob', show.filter(c => pts[0][c].control_prob != null)],
    ['count', show.filter(c => pts[0][c].control_prob == null)],
  ].filter(([, cs]) => cs.length);

  for (const [kind, series] of groups) panel(host, pts, series, kind, history);
}

function panel(host, pts, series, kind, history) {
  const K = KIND[kind];
  const W = 700, H = 300, m = { t: 14, r: 16, b: 44, l: 46 };
  const parse = d3.utcParse('%Y-%m-%d');
  const rows = pts.map(p => ({ ...p, t: parse(p.asof), _series: series }));
  const x = d3.scaleUtc().domain(d3.extent(rows, r => r.t)).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain(K.domain(rows)).range([H - m.b, m.t]);
  const box = document.createElement('div');
  box.className = 'trend-panel';
  host.append(box);
  host = box;
  const s = svg(host, W, H, K.title);
  const show = series;

  // Edge state is keyed by the run it arrives at, so a point knows how it joins
  // to its predecessor.
  const state = new Map((history.edges ?? []).map(e => [e.to, e]));

  s.append('g').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', C.line);
  // The even-odds rule belongs on a probability axis and nowhere else. There is
  // no equivalent line on the count panel because there is no threshold.
  if (K.rule != null) {
    s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(K.rule)).attr('y2', y(K.rule))
      .attr('stroke', C.ink).attr('stroke-opacity', 0.45).attr('stroke-dasharray', '4 3');
  }
  s.append('text').attr('x', W - m.r).attr('y', y(0.5) - 5).attr('text-anchor', 'end')
    .attr('fill', C.muted).attr('font-size', 10.5).text('even odds');

  const line = d3.line().x(r => x(r.t)).y(r => y(r.v));

  for (const ch of show) {
    const { col } = CH[ch];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      const st = state.get(b.asof)?.state ?? 'unverifiable';
      const seg = [{ t: a.t, v: K.get(a, ch) }, { t: b.t, v: K.get(b, ch) }];
      s.append('path').attr('d', line(seg))
        .attr('fill', 'none').attr('stroke', col).attr('stroke-width', 2)
        .attr('stroke-opacity', st === 'comparable' ? 1 : 0.28)
        .attr('stroke-dasharray', st === 'comparable' ? null : '2 4');
    }
    const dots = s.selectAll(`circle.${ch}`).data(rows).join('circle').attr('class', ch)
      .attr('cx', r => x(r.t)).attr('cy', r => y(K.get(r, ch))).attr('r', 4)
      .attr('fill', col).attr('stroke', C.surface).attr('stroke-width', 1.5);
    hoverable(dots, r =>
      `<b>${r.asof}</b><br>${K.say(r, ch)}<br>`
      + `<span class="tip-dim">generic ballot D+${r.environment_margin.toFixed(2)}`
      + `${r.generic_ballot_age_days != null ? `, newest poll ${r.generic_ballot_age_days}d old` : ''}`
      + `</span>`);
  }

  // Mark every break on the axis with why it is there. This is the part of the
  // chart that is easy to leave out and is the reason the chart is trustworthy.
  const breaks = rows.slice(1).filter(r => (state.get(r.asof)?.state ?? 'unverifiable') !== 'comparable');
  const marks = s.selectAll('g.brk').data(breaks).join('g').attr('class', 'brk');
  marks.append('line')
    .attr('x1', r => x(r.t)).attr('x2', r => x(r.t)).attr('y1', m.t).attr('y2', H - m.b)
    .attr('stroke', C.faint).attr('stroke-dasharray', '2 4');
  // The reason for a break is the most important thing on this chart, and a
  // hairline rule is not a hover target -- it has no width to hit. The handlers
  // go on an invisible band instead, so the explanation is actually reachable.
  const hits = marks.append('rect')
    .attr('x', r => x(r.t) - 9).attr('y', m.t).attr('width', 18).attr('height', H - m.b - m.t)
    .attr('fill', 'transparent').style('cursor', 'help');
  // A break on the newest run sits on the right edge, where a centred label is
  // half outside the plot. Anchor away from whichever edge it is against.
  const anchor = r => (x(r.t) > W - m.r - 50 ? 'end' : x(r.t) < m.l + 50 ? 'start' : 'middle');
  marks.append('text')
    .attr('x', r => x(r.t) + (anchor(r) === 'end' ? -4 : anchor(r) === 'start' ? 4 : 0))
    .attr('y', m.t + 9).attr('text-anchor', anchor)
    .attr('fill', C.faint).attr('font-size', 10).text('method changed');
  // Same helper as every other mark on the page, so a break is reachable by
  // keyboard as well as by pointer rather than being hover-only.
  hoverable(hits, r => {
    const e = state.get(r.asof);
    return `<b>${e?.state === 'broken' ? 'The model changed here' : 'Not verifiable'}</b><br>`
      + (e?.reasons?.length
        ? e.reasons.map(v => `<span class="tip-dim">${v}</span>`).join('<br>')
        : '<span class="tip-dim">no reason recorded</span>')
      + '<br>The series is not joined across this run.';
  });

  for (const [g, ax] of [
    [s.append('g').attr('transform', `translate(0,${H - m.b})`),
      d3.axisBottom(x).tickValues(rows.map(r => r.t)).tickFormat(d3.utcFormat('%b %-d'))],
    [s.append('g').attr('transform', `translate(${m.l},0)`),
      d3.axisLeft(y).ticks(5).tickFormat(K.tick)],
  ]) {
    g.call(ax.tickSizeOuter(0));
    g.selectAll('text').attr('fill', C.muted).attr('font-size', 10);
    g.selectAll('line,path').attr('stroke', C.line);
  }
  s.append('text').attr('transform', `translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5)
    .text(K.label);

  const joinable = (history.edges ?? []).filter(e => e.state === 'comparable').length;
  const note = document.createElement('p');
  note.className = 'chart-note';
  const named = show.map(c => `<span style="color:${CH[c].col}">${CH[c].label}</span>`);
  const who = named.length > 1
    ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0];
  note.innerHTML =
    `${K.note(who)} across ${rows.length} published runs. ${joinable} of `
    + `${(history.edges ?? []).length} gaps between consecutive runs are drawn solid, meaning the `
    + `two ends were produced by the same model on the same sources and the movement between them `
    + `is news about the election. The rest are dashed: something in the build changed across `
    + `those, so part of the step is the model rather than the electorate, and there is no way to `
    + `say how much. <b>Hover a dashed break to see what changed.</b>`;
  host.append(note);
}
