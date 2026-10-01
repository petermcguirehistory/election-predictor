// How it works: the fitted machinery, drawn whole.
//
// Every other tab shows what the model concludes. This one shows what it was
// fitted on -- the objects the drawer quotes one race at a time, at full size:
// the pipeline, all 499 pollster ratings, the polling error curve, and the
// sponsored-poll correction. Every number comes out of forecast.json `method`
// (engine/dashboard/method.py), which copies data/calibration/ rather than
// restating it, so a refit moves these charts with it.
import d3 from '../d3.js';
import { C, svg, hoverable, diverging, legendSwatch, fmtMargin, chamberName } from '../charts/util.js';

const lean = v => (Math.abs(v) < 0.05 ? '0' : `${v > 0 ? 'D' : 'R'}+${Math.abs(v).toFixed(1)}`);
const fmtN = n => n.toLocaleString('en-US');

// ---- the pipeline --------------------------------------------------------
//
// Two lanes that meet. The polls lane and the prior lane are separate estimates
// of the same margin, and the blend is where they meet -- drawing them as one
// chain would say the prior is computed FROM the polls, which is the one thing
// it is not. Each node links to the section that shows its fitted object.
export function pipeline(host, f) {
  host.replaceChildren();
  const m = f.method, env = f.environment;
  const ratedLive = m.pollsters.rows.filter(r => r[4] > 0).length;
  const sp = m.sponsor.tiers.with_lean;
  const W = 962, H = 236, NW = 148, NH = 64, STEP = 162;
  const yA = 34, yB = 138, yM = (yA + yB) / 2;
  const nodes = [
    { id: 'polls', col: 0, y: yA, t: 'Polls', href: '#s-pollsters',
      l: [`${fmtN(m.live.polls)} polls, ${m.live.races} races`, `${m.live.pollsters} pollster names`] },
    { id: 'correct', col: 1, y: yA, t: 'Correct each poll', href: '#s-pollsters',
      l: [`house effect: ${ratedLive} shops`, `sponsor: ±${sp.bias.toFixed(2)} pts`] },
    { id: 'average', col: 2, y: yA, t: 'Average', href: '#s-walkthrough',
      l: [`weight × ½^(age/${m.constants.poll_halflife_days}d)`, '→ effective n'] },
    { id: 'seat', col: 0, y: yB, t: 'The seat', href: '#s-walkthrough',
      l: ['2024 presidential lean', '+ incumbency, money'] },
    { id: 'env', col: 1, y: yB, t: 'The environment', href: '#s-scenario',
      l: [`generic ballot ${fmtMargin(env.margin_before_instrument_bias)}`,
          `− bias ${env.instrument_bias} → ${fmtMargin(env.margin)}`] },
    { id: 'prior', col: 2, y: yB, t: 'Prior', href: '#s-walkthrough',
      l: ['lean + e(lean) × env', '+ incumbency'] },
    { id: 'blend', col: 3, y: yM, t: 'Blend', href: '#s-walkthrough',
      l: [`w = n / (n + ${m.constants.prior_strength_k})`, 'polls · w, prior · (1−w)'] },
    { id: 'sim', col: 4, y: yM, t: 'Simulate', href: '#s-errorcurve',
      l: [`${fmtN(m.constants.n_sims)} joint draws`, 'nat + region + state + race'] },
    { id: 'count', col: 5, y: yM, t: 'Count', href: '#s-seats',
      l: ['seats in each draw', 'P(control) = share won'] },
  ];
  const at = Object.fromEntries(nodes.map(n => [n.id, n]));
  const x0 = n => 2 + n.col * STEP;
  const edges = [['polls', 'correct'], ['correct', 'average'], ['average', 'blend'],
                 ['seat', 'env'], ['env', 'prior'], ['prior', 'blend'],
                 ['blend', 'sim'], ['sim', 'count']];

  const s = svg(host, W, H, 'The model as a pipeline: polls and prior, blended, simulated, counted');
  s.append('defs').append('marker').attr('id', 'mt-arrow').attr('viewBox', '0 0 8 8')
    .attr('refX', 7).attr('refY', 4).attr('markerWidth', 7).attr('markerHeight', 7)
    .attr('orient', 'auto')
    .append('path').attr('d', 'M0,0 L8,4 L0,8 z').attr('fill', C.faint);

  s.append('g').selectAll('path').data(edges).join('path')
    .attr('d', ([a, b]) => {
      const A = at[a], B = at[b];
      const xa = x0(A) + NW, ya = A.y + NH / 2, xb = x0(B) - 3, yb = B.y + NH / 2;
      const mx = (xa + xb) / 2;
      return `M${xa},${ya} C${mx},${ya} ${mx},${yb} ${xb},${yb}`;
    })
    .attr('fill', 'none').attr('stroke', C.faint).attr('stroke-width', 1.5)
    .attr('marker-end', 'url(#mt-arrow)');

  // Lane labels: which estimate each row is building.
  s.append('text').attr('x', 2).attr('y', yA - 12).attr('font-size', 10).attr('fill', C.muted)
    .attr('letter-spacing', '.08em').text('POLL AVERAGE');
  s.append('text').attr('x', 2).attr('y', yB + NH + 20).attr('font-size', 10).attr('fill', C.muted)
    .attr('letter-spacing', '.08em').text('PRIOR — EVERY RACE, POLLED OR NOT');

  const g = s.append('g').selectAll('a').data(nodes).join('a')
    .attr('href', d => d.href)
    .attr('aria-label', d => `${d.t}: ${d.l.join(', ')}`)
    .attr('transform', d => `translate(${x0(d)},${d.y})`);
  g.append('rect').attr('width', NW).attr('height', NH).attr('rx', 4)
    .attr('fill', C.surface).attr('stroke', d => (d.id === 'blend' ? C.accent : C.line))
    .attr('stroke-width', 1.5);
  g.append('text').attr('x', 10).attr('y', 20).attr('font-size', 12).attr('font-weight', 600)
    .attr('fill', C.ink).text(d => d.t);
  g.each(function (d) {
    d3.select(this).selectAll('text.l').data(d.l).join('text').attr('class', 'l')
      .attr('x', 10).attr('y', (_, i) => 38 + i * 14).attr('font-size', 10)
      .attr('fill', C.dim).text(t => t);
  });
  return s;
}

// ---- pollster ratings ----------------------------------------------------
//
// One dot per rated pollster. x is the house effect -- the lean the model
// subtracts from every poll that shop publishes -- on the page's margin axis,
// Democratic to the left. y is the weight. Area is the number of races the
// rating rests on, because a shop rated on 300 races and one rated on 3 are
// not the same kind of evidence, and the shrinkage toward zero is why the
// small ones crowd the middle.
//
// Shops polling 2026 are drawn in colour and the rest in grey: the 499 are the
// fit, the coloured ones are the part of it this year's forecast actually uses.
export function pollsterChart(host, f) {
  host.replaceChildren();
  const P = f.method.pollsters;
  const rows = P.rows.map(([name, house, weight, n, live]) => ({ name, house, weight, n, live }));
  const W = 680, H = 360, M = { t: 18, r: 18, b: 40, l: 46 };
  const span = Math.ceil(d3.max(rows, d => Math.abs(d.house)) + 0.5);
  const x = d3.scaleLinear().domain([span, -span]).range([M.l, W - M.r]);
  const [lo, hi] = P.weight_clip;
  const y = d3.scaleLinear().domain([lo - 0.05, hi + 0.05]).range([H - M.b, M.t]);
  const r = d3.scaleSqrt().domain([0, d3.max(rows, d => d.n)]).range([1.6, 11]);

  const s = svg(host, W, H, 'Every rated pollster: house effect against weight');
  const grid = s.append('g');
  for (const w of [lo, 1, hi]) {
    grid.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', y(w)).attr('y2', y(w))
      .attr('stroke', C.line).attr('stroke-dasharray', w === 1 ? null : '3,3');
  }
  grid.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', M.t).attr('y2', H - M.b)
    .attr('stroke', C.line);
  grid.append('text').attr('x', W - M.r).attr('y', y(hi) - 5).attr('text-anchor', 'end')
    .attr('font-size', 10).attr('fill', C.faint).text(`cap ×${hi}`);
  grid.append('text').attr('x', W - M.r).attr('y', y(lo) - 5).attr('text-anchor', 'end')
    .attr('font-size', 10).attr('fill', C.faint).text(`floor ×${lo}`);

  const ax = s.append('g').attr('transform', `translate(0,${H - M.b})`)
    .call(d3.axisBottom(x).ticks(9).tickFormat(lean).tickSizeOuter(0));
  const ay = s.append('g').attr('transform', `translate(${M.l},0)`)
    .call(d3.axisLeft(y).tickValues([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]).tickFormat(v => `×${v}`)
      .tickSizeOuter(0));
  for (const a of [ax, ay]) {
    a.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
    a.selectAll('line,path').attr('stroke', C.line);
  }
  s.append('text').attr('x', (M.l + W - M.r) / 2).attr('y', H - 6).attr('text-anchor', 'middle')
    .attr('font-size', 10).attr('fill', C.muted).text('house effect: the lean subtracted from each of its polls');

  // Live shops last, so they sit on top of the grey field.
  const order = rows.slice().sort((a, b) => (a.live > 0) - (b.live > 0) || b.n - a.n);
  hoverable(
    s.append('g').selectAll('circle').data(order).join('circle')
      .attr('cx', d => x(d.house)).attr('cy', d => y(d.weight)).attr('r', d => r(d.n))
      .attr('fill', d => (d.live ? diverging(Math.max(-1, Math.min(1, d.house / 5))) : C.faint))
      .attr('fill-opacity', d => (d.live ? 0.9 : 0.22))
      // The ring is what marks a live shop, not the fill: a live shop with no
      // lean is drawn at the diverging midpoint, which is grey.
      .attr('stroke', d => (d.live ? C.ink : 'none')).attr('stroke-opacity', 0.7)
      .attr('stroke-width', 1),
    d => `<b>${d.name}</b><br>house effect ${lean(d.house)}: each poll moved ${
      Math.abs(d.house).toFixed(2)} pts ${d.house > 0 ? 'toward R' : d.house < 0 ? 'toward D' : ''}`
       + `<br>weight ×${d.weight.toFixed(2)}<br>rated on ${d.n} races`
       + (d.live ? `<br><b>${d.live}</b> poll${d.live > 1 ? 's' : ''} in this forecast` : ''));

  // Direct labels for the shops carrying the most of this year's polling.
  const top = rows.filter(d => d.live).sort((a, b) => b.live - a.live).slice(0, 6);
  // Placed greedily top to bottom, each pushed below the last one it would
  // overlap; the centre of this chart is where the big shops crowd.
  const placed = [];
  for (const d of top.slice().sort((a, b) => y(a.weight) - y(b.weight))) {
    let ly = y(d.weight) + 3.5;
    const lx = x(d.house) + r(d.n) + 4, w = d.name.length * 5.6;
    for (const q of placed) {
      if (lx < q.x + q.w && q.x < lx + w && Math.abs(ly - q.y) < 12) ly = q.y + 12;
    }
    placed.push({ x: lx, y: ly, w });
    d.lx = lx; d.ly = ly;
  }
  s.append('g').selectAll('text').data(top).join('text')
    .attr('x', d => d.lx).attr('y', d => d.ly)
    .attr('paint-order', 'stroke').attr('stroke', C.bg).attr('stroke-width', 3)
    .attr('font-size', 10).attr('fill', C.ink).attr('pointer-events', 'none')
    .text(d => d.name.replace(/ \(.*\)$/, ''));

  const key = document.createElement('div');
  key.className = 'keys';
  key.append(legendSwatch('ringed: polling 2026, coloured by lean', diverging(0.6)),
             legendSwatch('rated, not polling 2026', C.faint),
             legendSwatch('area = races rated on', C.dim));
  host.append(key);
  return { live: rows.filter(d => d.live).length, n: rows.length };
}

// ---- polling error curve -------------------------------------------------
//
// What a single poll misses the result by, as a function of how long before the
// election it was taken. Two lines per chamber:
//
//   one poll  √(σ_nat² + σ_reg² + V_race(d) + V_house(d) + V_noise(d))
//   floor     √(σ_nat² + σ_reg² + V_race(d))
//
// The gap between them is what averaging can remove -- pollster lean and
// sampling noise shrink with more, and more distinct, pollsters. The floor is
// what it cannot: the race moving after fieldwork, and the error every poll of
// the year shares. Drawn from the de-biased fit, the one that applies to a poll
// whose pollster has a rating. Past the corpus's last horizon the curve is
// extrapolated (dashed) up to the cap the engine stops at, then held flat.
export function errorCurves(host, f) {
  host.replaceChildren();
  const E = f.method.error_curve;
  const V = E.variants.debiased, Vraw = E.variants.raw;
  const shared = E.sigma_nat ** 2 + E.sigma_reg ** 2;
  const at = (c, k, d) => Math.max(0, c[k].a + c[k].b * Math.min(d, E.cap_days));
  const one = (c, d) => Math.sqrt(shared + at(c, 'v_race', d) + at(c, 'v_house', d) + at(c, 'v_noise', d));
  const floor = (c, d) => Math.sqrt(shared + at(c, 'v_race', d));
  const days = d3.range(0, Math.ceil(E.cap_days) + 1);
  const chambers = ['house', 'senate', 'governor'].filter(c => V[c]);
  const ymax = Math.ceil(d3.max(chambers, c => one(V[c], E.cap_days)) + 0.5);

  const grid = document.createElement('div');
  grid.className = 'three-col';
  host.append(grid);
  const W = 300, H = 210, M = { t: 14, r: 12, b: 32, l: 34 };
  const out = {};
  for (const ch of chambers) {
    const c = V[ch];
    const box = document.createElement('div');
    const h = document.createElement('h3'); h.textContent = chamberName(ch);
    box.append(h); grid.append(box);
    const x = d3.scaleLinear().domain([0, E.cap_days]).range([M.l, W - M.r]);
    const y = d3.scaleLinear().domain([0, ymax]).range([H - M.b, M.t]);
    const s = svg(box, W, H, `${chamberName(ch)}: polling error by days before the election`);

    s.append('rect').attr('x', x(E.corpus_max_days)).attr('y', M.t)
      .attr('width', x(E.cap_days) - x(E.corpus_max_days)).attr('height', H - M.b - M.t)
      .attr('fill', C.surface);
    const ax = s.append('g').attr('transform', `translate(0,${H - M.b})`)
      .call(d3.axisBottom(x).ticks(4).tickSizeOuter(0));
    const ay = s.append('g').attr('transform', `translate(${M.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat(v => `±${v}`).tickSizeOuter(0));
    for (const a of [ax, ay]) {
      a.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
      a.selectAll('line,path').attr('stroke', C.line);
    }
    s.append('text').attr('x', W - M.r).attr('y', H - 4).attr('text-anchor', 'end')
      .attr('font-size', 10).attr('fill', C.muted).text('days before the election');

    // The reducible part, as a band between the two lines.
    s.append('path').datum(days)
      .attr('d', d3.area().x(d => x(d)).y0(d => y(floor(c, d))).y1(d => y(one(c, d))))
      .attr('fill', C.dem).attr('fill-opacity', 0.16);
    for (const [fn, col, w] of [[one, C.dem, 2], [floor, C.ink, 1.5]]) {
      for (const [a, b, dash] of [[0, E.corpus_max_days, null],
                                   [E.corpus_max_days, E.cap_days, '4,3']]) {
        s.append('path').datum(days.filter(d => d >= a && d <= b))
          .attr('d', d3.line().x(d => x(d)).y(d => y(fn(c, d))))
          .attr('fill', 'none').attr('stroke', col).attr('stroke-width', w)
          .attr('stroke-dasharray', dash);
      }
    }
    const L = E.cap_days;
    s.append('text').attr('x', x(L) - 2).attr('y', y(one(c, L)) - 6).attr('text-anchor', 'end')
      .attr('font-size', 10).attr('fill', C.dem).text('one poll');
    s.append('text').attr('x', x(L) - 2).attr('y', y(floor(c, L)) + 13).attr('text-anchor', 'end')
      .attr('font-size', 10).attr('fill', C.ink).text('floor');

    const t = E.days_left;
    if (t >= 0 && t <= E.cap_days) {
      s.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', M.t).attr('y2', H - M.b)
        .attr('stroke', C.accent).attr('stroke-dasharray', '3,3');
      s.append('text').attr('x', x(t) + 4).attr('y', M.t + 10).attr('font-size', 10)
        .attr('fill', C.accent).text('today');
    }

    // Hover: a column per day, reading every component at that horizon.
    const hit = s.append('g').selectAll('rect').data(days.filter(d => d % 2 === 0)).join('rect')
      .attr('x', d => x(d) - (x(2) - x(0)) / 2).attr('width', x(2) - x(0))
      .attr('y', M.t).attr('height', H - M.b - M.t).attr('fill', 'transparent');
    hoverable(hit, d => `<b>${chamberName(ch)}, ${d} days out</b>`
      + `<br>one poll ±${one(c, d).toFixed(2)}, floor ±${floor(c, d).toFixed(2)}`
      + `<br>race drift √${at(c, 'v_race', d).toFixed(1)} = ±${Math.sqrt(at(c, 'v_race', d)).toFixed(2)}`
      + `<br>pollster lean ±${Math.sqrt(at(c, 'v_house', d)).toFixed(2)}`
      + ` (±${Math.sqrt(at(Vraw[ch], 'v_house', d)).toFixed(2)} uncorrected)`
      + `<br>sampling ±${Math.sqrt(at(c, 'v_noise', d)).toFixed(2)}`
      + (d > E.corpus_max_days ? '<br><em>extrapolated past the corpus</em>' : ''));

    out[ch] = { one: one(c, t), floor: floor(c, t), n_polls: c.n_polls, n_races: c.n_races,
                house_raw: Math.sqrt(at(Vraw[ch], 'v_house', t)),
                house_deb: Math.sqrt(at(c, 'v_house', t)) };
  }
  return out;
}

// ---- sponsored polls -----------------------------------------------------
//
// One dot per cycle: how far a sponsored poll sat from the same race's
// nonpartisan polls, toward its sponsor, after its pollster's own house effect
// was removed. The band is the pooled estimate ± one clustered standard error.
// Shown per cycle because a pooled number alone cannot say whether the lean is
// a steady property or one bad year; twelve dots on the same side of zero can.
export function sponsorChart(host, f) {
  host.replaceChildren();
  const S = f.method.sponsor;
  const pts = Object.entries(S.by_cycle).map(([c, v]) => ({ c: +c, v }));
  const W = 680, H = 210, M = { t: 16, r: 18, b: 30, l: 46 };
  const [c0, c1] = d3.extent(pts, d => d.c);
  const x = d3.scaleLinear().domain([c0 - 1, c1 + 1]).range([M.l, W - M.r]);
  const ext = d3.extent(pts, d => d.v);
  const y = d3.scaleLinear().domain([Math.min(-1, ext[0] - 0.5), Math.max(3, ext[1] + 0.5)])
    .range([H - M.b, M.t]);
  const s = svg(host, W, H, 'Lean of sponsored polls toward their sponsor, by cycle');

  const p = S.pooled;
  s.append('rect').attr('x', M.l).attr('width', W - M.r - M.l)
    .attr('y', y(p.bias + p.se)).attr('height', y(p.bias - p.se) - y(p.bias + p.se))
    .attr('fill', C.accent).attr('fill-opacity', 0.18);
  s.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', y(p.bias)).attr('y2', y(p.bias))
    .attr('stroke', C.accent).attr('stroke-width', 1.5);
  s.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', C.ink).attr('stroke-opacity', 0.5);

  const ax = s.append('g').attr('transform', `translate(0,${H - M.b})`)
    .call(d3.axisBottom(x).tickValues(pts.map(d => d.c)).tickFormat(d3.format('d')).tickSizeOuter(0));
  const ay = s.append('g').attr('transform', `translate(${M.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(v => (v > 0 ? `+${v}` : `${v}`)).tickSizeOuter(0));
  for (const a of [ax, ay]) {
    a.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
    a.selectAll('line,path').attr('stroke', C.line);
  }
  hoverable(
    s.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', d => x(d.c)).attr('cy', d => y(d.v)).attr('r', 5)
      .attr('fill', d => (d.v >= 0 ? C.accent : C.faint))
      .attr('stroke', C.surface).attr('stroke-width', 2),
    d => `<b>${d.c}</b><br>${d.v >= 0 ? '+' : ''}${d.v.toFixed(2)} pts toward the sponsor`);
  const key = document.createElement('div');
  key.className = 'keys';
  key.append(legendSwatch('one cycle', C.accent),
             legendSwatch(`pooled +${p.bias.toFixed(2)} ± ${p.se.toFixed(2)}`, C.accent,
                          `${fmtN(p.polls)} polls, ${p.races} races`, true));
  host.append(key);
  return { positive: pts.filter(d => d.v > 0).length, n: pts.length };
}
