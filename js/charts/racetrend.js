// One race over time: what was polled, what the model said, and how sure it is.
//
// This is the chart the race panel was missing. Everything above it in the
// drawer is arithmetic -- prior, blend, sigma, quantiles -- and arithmetic in
// rows cannot show the two things a reader actually asks about a single race:
// whether the polls agree with each other, and whether the model's estimate has
// been moving.
//
// THREE LAYERS, AND EACH ANSWERS A DIFFERENT QUESTION.
//
//   * POLLS are dots at the date they finished fieldwork and the margin they
//     reported. Area is the weight that poll carries in the average, so a single
//     recent live-caller and a six-month-old internal are visibly not the same
//     evidence. Nine polls at D+2 and one at D+2 are the same `poll_margin` and
//     a completely different state of knowledge, and only one of those is
//     visible in a number.
//
//   * THE ESTIMATE is the model's mu at each dated run, which is the honest
//     answer to "has this moved". It breaks wherever engine/history.py declined
//     to certify the join, the same rule the topline trend chart follows: a
//     changed map version moves every number for reasons that are not news.
//
//   * UNCERTAINTY is a fan from today to election day, not a band along the
//     history. The model's sigma is a claim about where this race LANDS, so
//     drawing it backwards over dates that have already happened would assert
//     something it never said. It widens to the full sigma at election day
//     because that is the only date it describes.
//
// A SUPERSEDED POLL IS DRAWN, HOLLOW. When a primary settles, the polling of the
// candidates who lost stops counting -- Maine carries 29 such readings behind 10
// live ones. Dropping them from the average is correct and dropping them from
// the picture is not: a reader looking at a race whose field changed in July
// should be able to see the field change.
import d3 from '../d3.js';
import { C, fmtMargin, hoverable, showTip, hideTip, svg } from './util.js';

const W = 680, H = 300, M = { t: 14, r: 16, b: 30, l: 44 };
const ELECTION = new Date('2026-11-03');

const parse = s => new Date(s + 'T00:00:00');

export function raceTrend(host, { polls = [], history = [], race, sigma }) {
  const live = polls.filter(p => !(p.x || '').includes('s'));
  const hasPolls = polls.length > 0;
  const hasHist = history.length > 1;
  if (!hasPolls && !hasHist) return null;

  // Domain: the earliest thing we know about, through election day. Election day
  // is always included even when nothing is polled near it, because the fan is
  // about that date and a chart that stops in September hides the horizon the
  // uncertainty is measured over.
  const dates = [...polls.map(p => parse(p.d)), ...history.map(h => parse(h.a)), ELECTION];
  const x = d3.scaleUtc().domain([d3.min(dates), ELECTION]).range([M.l, W - M.r]);

  const mus = history.map(h => h.mu).filter(v => v != null);
  const sig = sigma || 0;
  const vals = [...polls.map(p => p.m), ...mus,
                ...(sig ? [(mus.at(-1) ?? 0) + 2 * sig, (mus.at(-1) ?? 0) - 2 * sig] : [])];
  const pad = Math.max(3, (d3.max(vals) - d3.min(vals)) * 0.15);
  const y = d3.scaleLinear().domain([d3.min(vals) - pad, d3.max(vals) + pad]).nice()
              .range([H - M.b, M.t]);

  const s = svg(host, W, H, `${race.race_id}: polls, the model's estimate, and its uncertainty`);

  // --- the tie line, which is the only rule that matters on this axis --------
  s.append('line').attr('x1', M.l).attr('x2', W - M.r)
    .attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', C.mid).attr('stroke-width', 1);
  s.append('text').attr('x', W - M.r).attr('y', y(0) - 5).attr('text-anchor', 'end')
    .attr('font-size', 10).attr('fill', C.faint).text('tie');

  // --- axes ------------------------------------------------------------------
  const xa = s.append('g').attr('transform', `translate(0,${H - M.b})`)
    .call(d3.axisBottom(x).ticks(5).tickSizeOuter(0));
  xa.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
  xa.selectAll('line,path').attr('stroke', C.line);

  const ya = s.append('g').attr('transform', `translate(${M.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(v => (v > 0 ? `D+${v}` : v < 0 ? `R+${-v}` : '0'))
            .tickSizeOuter(0));
  ya.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
  ya.selectAll('line,path').attr('stroke', C.line);

  // --- the uncertainty fan ---------------------------------------------------
  // Anchored at the newest estimate and opening to the full sigma on election
  // day. Two bands: 1 sigma and 2 sigma, the same intervals the rows beneath
  // this chart quote as 68% and 95%.
  const lastH = history.filter(h => h.mu != null).at(-1);
  if (sig && lastH) {
    const x0 = x(parse(lastH.a)), x1 = x(ELECTION), mu = lastH.mu;
    const fan = (k, opacity) => {
      const a = d3.area()
        .x(d => d.t).y0(d => y(mu - k * sig * d.f)).y1(d => y(mu + k * sig * d.f));
      const pts = d3.range(0, 1.001, 0.05).map(f => ({ t: x0 + (x1 - x0) * f, f: Math.sqrt(f) }));
      s.append('path').datum(pts).attr('d', a)
        .attr('fill', C.dem).attr('opacity', opacity).attr('pointer-events', 'none');
    };
    fan(2, 0.07);
    fan(1, 0.11);
    s.append('line').attr('x1', x1).attr('x2', x1).attr('y1', M.t).attr('y2', H - M.b)
      .attr('stroke', C.faint).attr('stroke-dasharray', '2,3').attr('stroke-width', 1);
    s.append('text').attr('x', x1 - 4).attr('y', M.t + 9).attr('text-anchor', 'end')
      .attr('font-size', 10).attr('fill', C.faint).text('election day');
  }

  // --- the estimate ----------------------------------------------------------
  // Split into runs of joinable points so an uncertified join is a gap rather
  // than a line nobody should read across.
  if (hasHist) {
    const segs = [];
    let cur = [];
    history.forEach((h, i) => {
      if (h.mu == null) { if (cur.length) segs.push(cur); cur = []; return; }
      if (i > 0 && !h.j && cur.length) { segs.push(cur); cur = []; }
      cur.push(h);
    });
    if (cur.length) segs.push(cur);
    const line = d3.line().x(d => x(parse(d.a))).y(d => y(d.mu));
    for (const seg of segs) {
      if (seg.length > 1) {
        s.append('path').datum(seg).attr('d', line).attr('fill', 'none')
          .attr('stroke', C.ink).attr('stroke-width', 1.75);
      }
      hoverable(
        s.append('g').selectAll('circle').data(seg).join('circle')
          .attr('cx', d => x(parse(d.a))).attr('cy', d => y(d.mu)).attr('r', 2.6)
          .attr('fill', C.ink),
        d => `<b>${d.a}</b><br>model estimate ${fmtMargin(d.mu)}`
           + (d.w != null ? `<br>win probability ${(d.w * 100).toFixed(1)}%` : '')
           + `<br>${d.n} poll${d.n === 1 ? '' : 's'} in the average`);
    }
  }

  // --- the polls -------------------------------------------------------------
  // Area, not radius, carries the weight: a poll counting four times another
  // should look four times as much, and radius would make it sixteen.
  const wmax = d3.max(live, p => p.w) || 1;
  const r = w => 2 + 5 * Math.sqrt(Math.max(w, 0) / wmax);
  const flag = p => (p.x || '');
  hoverable(
    s.append('g').selectAll('circle').data(polls).join('circle')
      .attr('cx', p => x(parse(p.d))).attr('cy', p => y(p.m))
      .attr('r', p => (flag(p).includes('s') ? 2.6 : r(p.w)))
      .attr('fill', p => (flag(p).includes('s') ? 'none' : (p.m >= 0 ? C.dem : C.rep)))
      .attr('stroke', p => (flag(p).includes('s') ? C.faint : 'none'))
      .attr('stroke-width', 1)
      .attr('opacity', p => (flag(p).includes('s') ? 0.75 : 0.85)),
    p => {
      const f = flag(p);
      const bits = [];
      if (f.includes('s')) bits.push(`<em>superseded — ${p.k} is no longer the matchup</em>`);
      else bits.push(`weight ${(p.w * 100).toFixed(0)}% of this race's polling`);
      if (f.includes('p')) bits.push('partisan sponsor, down-weighted');
      if (f.includes('i')) bits.push('campaign internal, down-weighted');
      if (f.includes('u')) bits.push('pollster carries no rating');
      if (Math.abs(p.h) > 0.005) bits.push(`house-effect correction ${p.h >= 0 ? '+' : ''}${p.h.toFixed(2)}`);
      return `<b>${p.p}</b><br>${p.d} · ${fmtMargin(p.m)}<br>${bits.join('<br>')}`;
    });

  return s;
}
