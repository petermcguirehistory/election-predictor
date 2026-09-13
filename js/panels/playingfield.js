// How far the district field sits from the country it is drawn on.
//
// One statistic, drawn twice, because it has two readings and people arrive
// wanting different ones:
//
//   VERTICALLY   at the 218th seat the field sits 3.26 points right of the
//                nation. That is the popular-vote margin an election has to
//                clear to reach the median seat.
//   HORIZONTALLY 206 districts sit at or above the national vote and 218 are
//                needed. That is a 12-seat gap. That is what a MAP would have to
//                change.
//
// Both are the same distance measured along two axes of one curve, so the left
// chart shows the whole field and the right one zooms on the crossing and
// annotates the gap on both axes at once.
//
// Every number here is computed in engine/priors/structural.py and shipped in
// the payload. The build asserts it reproduces the run's own gate, which reaches
// the same statistic through the posterior join instead of the district files.

import d3 from '../d3.js';
import { C, svg, showTip, hideTip, hoverable } from '../charts/util.js';

// Lean is relative to the nation, so R+3.26 means "3.26 points more Republican
// than the country" -- not "Republicans won it by 3.26".
const rel = v => `${v >= 0 ? 'D' : 'R'}+${Math.abs(v).toFixed(2)}`;
const signed = v => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

// A set of claims, as a list. The same argument as `table` one line up: four
// facts in sequence inside a paragraph have to be parsed back out of the English
// before any one of them can be read on its own.
function pts(items) {
  return `<ul class="pts">${items.filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ul>`;
}

function table(cls, head, rows) {
  const t = el('table', cls);
  const tr = t.createTHead().insertRow();
  for (const h of head) {
    const th = document.createElement('th');
    th.textContent = h.label;
    if (h.num) th.className = 'num';
    tr.append(th);
  }
  const tb = t.createTBody();
  for (const r of rows) {
    const row = tb.insertRow();
    if (r._break) row.className = 'brk';
    for (const [i, c] of r.cells.entries()) {
      const td = row.insertCell();
      td.innerHTML = c;
      if (head[i].num) td.className = 'num';
    }
  }
  const wrap = el('div', 'scroll-x');
  wrap.append(t);
  return wrap;
}

// ---- the field curve ----------------------------------------------------
// Districts sorted most-Republican first. The area between the curve and the
// national vote is filled by sign, so the asymmetry of the two tails -- which is
// the whole reason the median sits right of the mean -- is visible without
// anybody being told to look for it.
function fieldChart(host, sf, { lo, hi, label, annotate }) {
  const { now, before, ids } = sf.curve;
  const n = now.length;
  const W = annotate ? 380 : 430, H = 300;
  const m = { t: 16, r: 16, b: 40, l: 48 };
  const slice = (a) => a.slice(lo - 1, hi);
  const yDom = d3.extent(annotate ? slice(now) : now.concat(before));
  const pad = (yDom[1] - yDom[0]) * 0.08;

  const x = d3.scaleLinear().domain([lo, hi]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([yDom[0] - pad, yDom[1] + pad]).range([H - m.b, m.t]);
  const s = svg(host, W, H, label);
  const rank = (_, i) => x(lo + i);

  s.append('g').selectAll('line').data(y.ticks(6)).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y)
    .attr('stroke', C.line);

  // Filled by sign against the national vote, not against zero margin.
  for (const [side, col] of [['above', C.dem], ['below', C.rep]]) {
    s.append('path')
      .attr('d', d3.area().x(rank)
        .y0(y(0))
        .y1(d => y(side === 'above' ? Math.max(0, d) : Math.min(0, d)))(slice(now)))
      .attr('fill', col).attr('fill-opacity', 0.28);
  }
  s.append('path').attr('d', d3.line().x(rank).y(y)(slice(now)))
    .attr('fill', 'none').attr('stroke', C.ink).attr('stroke-width', 1.6);

  if (!annotate) {
    s.append('path').attr('d', d3.line().x(rank).y(y)(slice(before)))
      .attr('fill', 'none').attr('stroke', C.muted).attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '4 3');
  }

  // The national vote itself. Everything on this chart is measured from it.
  s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', C.ink).attr('stroke-opacity', 0.55).attr('stroke-dasharray', '3 3');

  const need = sf.need;
  s.append('line').attr('x1', x(need)).attr('x2', x(need)).attr('y1', m.t).attr('y2', H - m.b)
    .attr('stroke', C.accent).attr('stroke-width', 1.4);

  if (annotate) {
    // The first district at or above the national vote. Derived from the shipped
    // curve rather than trusted from the summary, so the drawing and the numbers
    // beside it cannot disagree.
    const cross = now.findIndex(v => v >= 0) + 1;
    const bias = now[need - 1];

    s.append('path')
      .attr('d', d3.area().x((_, i) => x(need + i)).y0(y(0)).y1(y)(now.slice(need - 1, cross)))
      .attr('fill', C.accent).attr('fill-opacity', 0.22)
      .attr('stroke', C.accent).attr('stroke-opacity', 0.5);

    // the vertical reading: points
    s.append('line').attr('x1', x(need)).attr('x2', x(need))
      .attr('y1', y(0)).attr('y2', y(bias))
      .attr('stroke', C.accent).attr('stroke-width', 3);
    s.append('text').attr('x', x(need) - 7).attr('y', (y(0) + y(bias)) / 2 + 4)
      .attr('text-anchor', 'end').attr('fill', C.accent).attr('font-size', 11.5)
      .text(`${Math.abs(bias).toFixed(2)} pts`);

    // the horizontal reading: seats
    s.append('line').attr('x1', x(need)).attr('x2', x(cross))
      .attr('y1', y(0)).attr('y2', y(0))
      .attr('stroke', C.accent).attr('stroke-width', 3);
    s.append('text').attr('x', (x(need) + x(cross)) / 2).attr('y', y(0) - 8)
      .attr('text-anchor', 'middle').attr('fill', C.accent).attr('font-size', 11.5)
      .text(`${cross - need} seats`);
  }

  for (const [g, axis] of [
    [s.append('g').attr('transform', `translate(0,${H - m.b})`), d3.axisBottom(x).ticks(6)],
    [s.append('g').attr('transform', `translate(${m.l},0)`),
     d3.axisLeft(y).ticks(6).tickFormat(v => (v > 0 ? `+${v}` : `${v}`))],
  ]) {
    g.call(axis.tickSizeOuter(0));
    g.selectAll('text').attr('fill', C.muted).attr('font-size', 10.5);
    g.selectAll('line,path').attr('stroke', C.line);
  }
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 2)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5)
    .text('districts, most Republican first');
  s.append('text').attr('transform', `translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5)
    .text('points from the national vote');

  s.on('pointermove', (e) => {
    const r = Math.max(lo, Math.min(hi, Math.round(x.invert(d3.pointer(e)[0]))));
    showTip(e, `<b>${ids[r - 1]}</b> · rank ${r} of ${n}<br>` +
      `${rel(now[r - 1])} against the nation` +
      (r === need ? '<br><em>the median seat</em>' : ''));
  }).on('pointerleave', hideTip);
}

// ---- panel --------------------------------------------------------------
export function playingField(host, { structural }) {
  host.replaceChildren();
  if (!structural) {
    host.append(el('p', 'chart-note',
      'The structural-bias payload is missing — rebuild with <code>python -m engine.dashboard.build</code>.'));
    return;
  }
  const sf = structural;
  const now = sf.now, before = sf.before, pk = sf.packing;
  const cross = sf.curve.now.findIndex(v => v >= 0) + 1;

  // --- headline numbers ---------------------------------------------------
  const stats = el('div', 'stat-row pf-stats');
  for (const [n, l] of [
    [rel(now.bias), `where the ${sf.need}th district sits, against the country`],
    [`${now.above_national} / ${now.need}`,
     `districts at least as Democratic as the country, of the ${now.need} needed`],
    [`${now.gap} seats`, `short of an even map — ${sf.gap_points} points of margin in all`],
    [`${now.competitive}`,
     `districts within 5 points of the national vote, down from ${before.competitive}`],
  ]) {
    const d = el('div', 'stat');
    d.append(el('div', 'n', n), el('div', 'l', l));
    stats.append(d);
  }
  host.append(stats);

  // --- the two readings ---------------------------------------------------
  const cols = el('div', 'two-col');
  const left = el('div'), right = el('div');
  left.append(el('h3', null, 'The whole field'));
  right.append(el('h3', null, 'Where it is decided'));
  fieldChart(left, sf, { lo: 1, hi: now.districts, annotate: false,
    label: 'Every district ordered by how far it sits from the national vote, on the 2026 lines and on the 118th Congress lines' });
  fieldChart(right, sf, { lo: sf.need - 40, hi: sf.need + 40, annotate: true,
    label: 'The same curve around the median seat, with the gap measured in points and in seats' });
  cols.append(left, right);
  host.append(cols);

  const keys = el('div', 'keys');
  keys.innerHTML =
    `<span class="key"><i style="background:${C.ink}"></i>2026 lines</span>` +
    `<span class="key"><i style="background:repeating-linear-gradient(90deg,${C.muted} 0 4px,transparent 4px 7px)"></i>118th Congress lines</span>` +
    `<span class="key"><i style="background:${C.accent}"></i>the 218th seat</span>`;
  host.append(keys);

  host.append(el('h3', 'pf-h', 'Why the presidential result, and not past House results?'));
  host.append(el('p', null,
    `Because one ballot question was put to every voter in all 435 districts on the same day, so ` +
    `the number means the same thing everywhere.`));
  host.append(el('div', null, pts([
    `<b>House results are not comparable</b> — they turn on who ran, who was the incumbent, and ` +
      `who faced no opponent at all.`,
    `<b>The cost of using them</b> — computed on House results, this same statistic swings 13 ` +
      `points and changes sign twice in a decade, on maps that barely moved.`,
    `<b>The dashed line</b> — the same 2024 election counted under the old <b>118th Congress</b> ` +
      `lines. The national vote is identical by construction, so every difference between the two ` +
      `curves is the redrawing.`,
  ])));

  // --- what would close it ------------------------------------------------
  host.append(el('h3', 'pf-h', 'What would it take to even the map out?'));
  host.append(el('p', null,
    `The House is won at the ${sf.need}th seat of ${sf.seats}, so the map is even exactly when ` +
    `<code>districts above the national vote = ${sf.need}</code>. Today ` +
    `${now.above_national} are, leaving a gap of <b>${now.gap}</b>.`));
  host.append(el('div', null, pts([
    `<b>The table</b> — the ${now.gap} districts already closest to the line, with the shift each ` +
      `would need.`,
    `<b>Cheapest means cheapest in vote margin, and nothing else.</b> It carries no claim that any ` +
      `legislature, commission or court would draw them that way, or could.`,
  ])));
  host.append(table('plain', [
    { label: 'District' }, { label: '2024 margin', num: true },
    { label: 'Points needed', num: true },
  ], sf.gap_districts.map(g => ({
    cells: [`<b>${g.race_id}</b>`, rel(g.margin), signed(g.needs)],
  }))));

  // --- where it came from -------------------------------------------------
  const fromRedraws = sf.gap_added_by_redraws;
  host.append(el('h3', 'pf-h', 'How much of the gap is the mid-decade redraws?'));
  host.append(el('div', null, pts([
    `<b>Gap under the 118th lines</b> — ${before.gap} seats.`,
    `<b>Gap now</b> — ${now.gap} seats, of which <b>${fromRedraws}</b> is the ten mid-decade ` +
      `redraws.`,
    `<b>So undoing every mid-decade redraw</b> closes ${fromRedraws} of ${now.gap} and stops ` +
      `there. The other ${before.gap} were already in the maps drawn after the 2020 census.`,
  ])));
  host.append(el('p', 'chart-note',
    `Each state's count of districts at or above the national vote, before and after.`));
  host.append(table('plain', [
    { label: 'State' }, { label: 'Above the nation, 118th', num: true },
    { label: '2026', num: true }, { label: 'Change', num: true },
  ], sf.state_shift.map(r => ({
    cells: [r.state, String(r.before), String(r.after),
      `<span style="color:${r.delta > 0 ? C.dem : C.rep}">${r.delta > 0 ? '+' : '−'}${Math.abs(r.delta)}</span>`],
  }))));

  // A redraw does not reapportion, so both sides of this hold their district count
  // fixed and the comparison is like-for-like. The build refuses to ship it if
  // that ever stops being true.
  const cs = sf.competitive_split;
  const csNote = el('div', 'chart-note',
    `The redraws also removed seats from near the line. Districts within 5 points of the national ` +
    `vote:`);
  csNote.innerHTML += pts([
    `<b>The ten that redrew</b> — ${cs.redrawn.before.competitive} → ` +
      `<b>${cs.redrawn.after.competitive}</b>, across the same ${cs.redrawn.after.districts} ` +
      `districts either way. A redraw does not change how many seats a state has.`,
    `<b>The other forty</b> — ${cs.elsewhere.before.competitive} → ` +
      `${cs.elsewhere.after.competitive}, across ${cs.elsewhere.after.districts}.`,
  ]) + `<p>Which is why most of the cheapest seats in the table above sit outside the states that ` +
       `redrew: little is left near the line inside them.</p>`;
  host.append(csNote);

  // --- history ------------------------------------------------------------
  host.append(el('h3', 'pf-h', 'Is this map unusually tilted, historically?'));
  host.append(el('p', null,
    `Read this table <b>down a group, never across the whole of it</b>: "how far a district leans" ` +
    `is not measured the same way in every row.`));
  host.append(el('div', null, pts([
    `<b>Why the rules</b> — 538 rewrote its partisan-lean formula in 2021. ` +
      `${sf.history[1].label} against ${sf.history[2].label} reads as a ` +
      `${Math.abs(sf.history[2].bias - sf.history[1].bias).toFixed(1)}-point improvement on the ` +
      `same district lines. All of it is the change of definition.`,
    `<b>Rows are grouped by definition</b> and the groups ruled apart, so the safe comparison is ` +
      `visible rather than taken on trust.`,
    `<b>The benchmark for this cycle</b> — the last full post-census redraw, every multi-district ` +
      `state at once after the 2020 census, moved the median district <b>0.03 points</b>. Read ` +
      `this cycle's ten-state mid-decade round against that.`,
  ])));

  const hist = sf.history.map((h, i) => ({
    _break: i > 0 && h.vintage !== sf.history[i - 1].vintage,
    cells: [`<b>${h.label}</b>`, `${h.lines} lines`, rel(h.bias), String(h.above_national),
      `<span class="pf-vint">${h.vintage}</span>`],
  })).concat([
    { _break: true,
      cells: [`<b>2024 map</b>`, '118th lines', rel(before.bias), String(before.above_national),
        '<span class="pf-vint">this engine · 2024 pres by district</span>'] },
    { cells: [`<b>2026 map</b>`, '2026 lines', `<b>${rel(now.bias)}</b>`, String(now.above_national),
      '<span class="pf-vint">this engine · 2024 pres by district</span>'] },
  ]);
  host.append(table('plain', [
    { label: 'Field' }, { label: 'Lines' }, { label: 'Median district vs nation', num: true },
    { label: 'Above the nation', num: true }, { label: 'Measured as' },
  ], hist));
  host.append(el('p', 'chart-note',
    `The rules mark where the measure changes, so no trend line is drawn through them. The ` +
    `forecast-history chart on the Track record tab breaks at its own version changes for the ` +
    `same reason.`));

  // --- what is not drawable ----------------------------------------------
  host.append(el('h3', 'pf-h', 'How much of this is the map, and how much is where people live?'));
  host.append(el('p', null,
    `Mostly the second, which no redistricting round reaches. The tell is a gap between two ` +
    `averages that would agree on a symmetric field:`));
  host.append(el('div', null, pts([
    `<b>Mean district</b> — ${rel(pk.mean_lean)}. ` +
      `<b>Median district</b> — ${rel(pk.median_lean)}. ` +
      `<code>gap = ${Math.abs(pk.mean_lean - pk.median_lean).toFixed(2)} pts</code>, which is the ` +
      `shape of the distribution rather than any one map.`,
    `<b>The two tails are not the same size</b> — ${pk.dem_districts} Democratic-leaning ` +
      `districts average ${rel(pk.dem_mean_lean)} against ${pk.gop_districts} Republican-leaning ` +
      `at ${rel(pk.gop_mean_lean)}; ${pk.dem_over_30} run deeper than D+30 against ` +
      `${pk.gop_over_30} deeper than R+30.`,
    `<b>Why that tilts the median</b> — a seat is won at 50%, so any margin stacked beyond that in ` +
      `a district a party was always going to win is wasted. Democratic voters are concentrated in ` +
      `cities, so Democrats waste more, and the median district falls right of the mean.`,
    `<b>Efficiency gap</b> — the two parties' wasted votes differenced, over all votes cast: ` +
      `<b>${Math.abs(pk.efficiency_gap).toFixed(1)}% toward ` +
      `${pk.efficiency_gap < 0 ? 'Republicans' : 'Democrats'}</b> on these districts.`,
  ])));
  host.append(el('p', 'chart-note',
    `So the ${cross - sf.need}-seat gap above is the smaller half. The other route to the median ` +
    `seat is more votes, and the model prices that: ` +
    `<a href="#s-scenario">the sweep further down</a> puts the House at even odds near D+2.7.`));
}

// ---- the statewide field --------------------------------------------------
//
// The panel above measures district lines, which were drawn for this purpose and
// can be redrawn. This one measures state borders, which were not: two senators
// from Wyoming and two from California, one governor per state whatever its size.
//
// A separate panel rather than a chamber mode of the one above. A districting
// bias can be litigated; equal suffrage in the Senate is the one clause Article V
// places beyond amendment without a state's own consent. One chart with a switched
// unit would assert they are the same kind of fact.
//
// The headline is the tilt; the chart beside it is the MECHANISM, because the
// tilt is not a constant. Equal representation per state has no partisan sign of
// its own -- it favours whoever holds the small states, which is contingent and
// has changed sign before. Shown the tilt alone, a reader would reasonably read
// it as permanent.
export function statewideField(host, { statewide, houseBias = null }) {
  host.replaceChildren();
  if (!statewide) {
    host.append(el('p', 'chart-note',
      'The statewide structural payload is missing — rebuild with '
      + '<code>python -m engine.dashboard.build</code>.'));
    return;
  }
  const sw = statewide, ma = sw.malapportionment, st = sw.size_tilt;

  const stats = el('div', 'stat-row pf-stats');
  for (const [n, l] of [
    [rel(sw.bias), `where the ${sw.states_needed}th state sits, against the country`],
    [`${sw.above_national} / ${sw.states_needed}`,
     `states at least as Democratic as the country, of the ${sw.states_needed} needed for a majority`],
    [`${(ma.share_of_country * 100).toFixed(1)}%`,
     `of the country lives in the ${ma.smallest_states} smallest states — by themselves enough to hold the Senate`],
    [`${ma.ratio}×`, `as many people per senator in the largest state as in the smallest`],
  ]) {
    const d = el('div', 'stat');
    d.append(el('div', 'n', n), el('div', 'l', l));
    stats.append(d);
  }
  host.append(stats);

  const cols = el('div', 'two-col');
  const left = el('div'), right = el('div');
  left.append(el('h3', null, 'The whole field'));
  right.append(el('h3', null, 'Why it tilts'));
  stateCurve(left, sw);
  sizeScatter(right, sw);
  cols.append(left, right);
  host.append(cols);

  host.append(el('p', 'chart-note',
    `The 2024 presidential result by state, scored against the same national vote the district `
    + `section uses, so the two are directly comparable. Median state <b>${rel(sw.bias)}</b>`
    + (houseBias == null ? '' : `, median district <b>${rel(houseBias)}</b>`)
    + `. Two different facts, not two versions of one: the first is where the state borders `
    + `already were, the second is where the lines were drawn.`));

  // The cycle effect, which is not the structure and must not be read as it.
  if (sw.on_ballot) {
    const ob = sw.on_ballot;
    host.append(el('h3', 'pf-h', 'Does that tilt describe this year\'s Senate races?'));
    host.append(el('p', null,
      `No. The figure above is the standing structure across all fifty states; about a third of the `
      + `Senate is elected in any one year, and this year's third is not a random sample of it.`));
    host.append(el('div', null, pts([
      `<b>On the 2026 ballot</b> — ${ob.states} states, median lean `
        + `<b>${rel(ob.median_lean)}</b>.`,
      `<b>Against all fifty</b> — <code>${Math.abs(ob.vs_all_states).toFixed(2)} pts</code> more `
        + `Republican than the median state.`,
      `<b>At or above the national vote</b> — ${ob.above_national} of ${ob.states}.`,
      `<b>Scope</b> — a fact about which seats are up this cycle, not about the Senate. A different `
        + `number in 2028.`,
    ])));
  }

  host.append(el('h3', 'pf-h', 'Is this permanent?'));
  host.append(el('p', null, `The arrangement is. The partisan effect is not. Separating the two:`));
  host.append(el('div', null, pts([
    `<b>The arrangement</b> — equal representation in the Senate is the only provision of the `
      + `Constitution that Article V puts beyond amendment without the consent of the state being `
      + `changed. The <code>${ma.ratio}×</code> gap in people per senator between the largest state `
      + `and the smallest is not open to argument. Contrast the district section above: lines get `
      + `redrawn, and nine states redrew for this cycle alone.`,
    `<b>The partisan effect</b> — equal representation per state has no sign of its own. It favours `
      + `whoever holds the small states, which is contingent: it has changed sign before, and would `
      + `again if the small states changed.`,
  ])));
  host.append(el('p', 'chart-note',
    `The table below is the whole of the partisan effect — the half of this that is not `
    + `permanent.`));

  host.append(table('plain',
    [{ label: '' }, { label: 'Mean lean', num: true }, { label: 'States', num: true }],
    [
      { cells: [`<b>The 25 smallest states</b>`, rel(st.small_half_mean_lean), '25'] },
      { cells: [`<b>The 25 largest states</b>`, rel(st.large_half_mean_lean), '25'] },
      { _break: true,
        cells: [`<b>Spread</b>`, `<b>${Math.abs(st.spread).toFixed(2)} pts</b>`,
                `r = ${st.corr_log_size_lean.toFixed(3)}`] },
    ]));
  host.append(el('p', 'pf-vint',
    `<b>r</b> is the correlation between state size and state lean across all fifty: 0 means size `
    + `tells you nothing about lean, 1 means it tells you everything. Size is the state's House `
    + `delegation, which is its share of the country by construction — seats are apportioned from `
    + `the same census the districts are drawn from, so no separate population file can fall out of `
    + `step with the rest of the model.`));
}

// Fifty states ordered by lean, sized by delegation. Area carries population and
// position carries partisanship, so the chart shows the mismatch that IS the
// subject: a long row of small red cells against a few large blue ones.
function stateCurve(host, sw) {
  const n = sw.curve.lean.length;
  const W = 460, H = 250, m = { t: 16, r: 14, b: 42, l: 44 };
  const x = d3.scaleLinear().domain([1, n]).range([m.l, W - m.r]);
  const clamp = 45;
  const y = d3.scaleLinear().domain([-clamp, clamp]).range([H - m.b, m.t]);
  const s = svg(host, W, H, 'Every state ordered by how far it sits from the national vote');

  s.append('g').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', C.line);

  const rows = sw.curve.lean.map((v, i) => ({
    lean: Math.max(-clamp, Math.min(clamp, v)), raw: v,
    id: sw.curve.ids[i], cds: sw.curve.n_cds[i], rank: i + 1,
  }));
  const bw = (W - m.r - m.l) / n;
  const bars = s.selectAll('rect.s').data(rows).join('rect').attr('class', 's')
    .attr('x', d => x(d.rank) - bw / 2).attr('width', Math.max(1, bw - 1))
    .attr('y', d => Math.min(y(0), y(d.lean)))
    .attr('height', d => Math.abs(y(d.lean) - y(0)))
    .attr('fill', d => (d.lean >= 0 ? C.dem : C.rep)).attr('fill-opacity', 0.8);
  hoverable(bars, d =>
    `<b>${d.id}</b> · rank ${d.rank} of 50<br>${d.raw >= 0 ? 'D' : 'R'}+` +
    `${Math.abs(d.raw).toFixed(1)} vs the nation<br>` +
    `<span class="tip-dim">${d.cds} House seat${d.cds > 1 ? 's' : ''} — ` +
    `${(d.cds / 435 * 100).toFixed(1)}% of the country, 2% of the Senate</span>`);

  s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', C.ink).attr('stroke-opacity', 0.55);
  // The 26th state holds the 51st seat, so one line marks both readings.
  s.append('line').attr('x1', x(sw.states_needed)).attr('x2', x(sw.states_needed))
    .attr('y1', m.t).attr('y2', H - m.b).attr('stroke', C.accent).attr('stroke-width', 2);
  s.append('text').attr('x', x(sw.states_needed) + 5).attr('y', m.t + 9)
    .attr('fill', C.accent).attr('font-size', 10.5).attr('font-weight', 600)
    .text('26th state = 51st seat');

  axes(s, x, y, W, H, m, 'states, ordered most Republican to most Democratic');
}

// Delegation size against lean. This is the mechanism, and drawing it as a
// scatter rather than reporting r alone is the point: r is 0.24 and looks weak,
// while the picture shows a floor of one- and two-seat states sitting far right
// of the nation, which is what actually does the work.
function sizeScatter(host, sw) {
  const W = 460, H = 250, m = { t: 16, r: 14, b: 42, l: 44 };
  const rows = sw.curve.lean.map((v, i) => ({
    lean: Math.max(-45, Math.min(45, v)), raw: v,
    id: sw.curve.ids[i], cds: sw.curve.n_cds[i],
  }));
  const x = d3.scaleLog().domain([0.9, 60]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([-45, 45]).range([H - m.b, m.t]);
  const s = svg(host, W, H, 'State delegation size against lean');

  s.append('g').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', C.line);
  s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', C.ink).attr('stroke-opacity', 0.55);

  const dots = s.selectAll('circle').data(rows).join('circle')
    .attr('cx', d => x(d.cds)).attr('cy', d => y(d.lean)).attr('r', 4)
    .attr('fill', d => (d.lean >= 0 ? C.dem : C.rep)).attr('fill-opacity', 0.8)
    .attr('stroke', C.surface).attr('stroke-width', 1);
  hoverable(dots, d =>
    `<b>${d.id}</b><br>${d.cds} House seat${d.cds > 1 ? 's' : ''}, 2 senators<br>` +
    `${d.raw >= 0 ? 'D' : 'R'}+${Math.abs(d.raw).toFixed(1)} vs the nation`);

  axes(s, x, y, W, H, m, 'House seats (log scale) — every state has 2 senators',
       d3.axisBottom(x).tickValues([1, 2, 5, 10, 20, 52]).tickFormat(d3.format('d')));
}

function axes(s, x, y, W, H, m, xLabel, xAxis) {
  for (const [g, ax] of [
    [s.append('g').attr('transform', `translate(0,${H - m.b})`), xAxis || d3.axisBottom(x).ticks(6)],
    [s.append('g').attr('transform', `translate(${m.l},0)`),
     d3.axisLeft(y).ticks(5).tickFormat(v => (v === 0 ? '0' : `${v > 0 ? 'D' : 'R'}+${Math.abs(v)}`))],
  ]) {
    g.call(ax.tickSizeOuter(0));
    g.selectAll('text').attr('fill', C.muted).attr('font-size', 10.5);
    g.selectAll('line,path').attr('stroke', C.line);
  }
  s.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 2)
    .attr('text-anchor', 'middle').attr('fill', C.faint).attr('font-size', 10.5).text(xLabel);
}
