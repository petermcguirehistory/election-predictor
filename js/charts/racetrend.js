// One race, in two panels sharing a time axis.
//
// TOP: THE MARGIN, which is the quantity the model consumes. Every poll at the
// day its fieldwork ended, area carrying the weight it counts for, the model's
// estimate at each run, and an uncertainty fan to election day.
//
// BOTTOM: THE CANDIDATES, which is the quantity a reader judges it by. The
// margin alone cannot distinguish 40-40 from 50-50, and those are not the same
// race -- one of them has a fifth of the electorate somewhere else. One line per
// named candidate, so a primary that replaced the nominee shows up as one line
// stopping and another starting rather than as a footnote.
//
// FOUR RULES THE FIRST VERSION GOT WRONG OR DID NOT HAVE.
//
//   * THE ESTIMATE IS NOT ONE SERIES. Points from runs this model actually
//     produced are solid; points reconstructed later by asking today's model
//     about older polling are drawn thin and dashed. They answer different
//     questions, and a single line would assert a forecast history that does not
//     exist before 2026-08-22.
//
//   * THE FAN OPENS FORWARD. Sigma is a claim about where the race LANDS, so it
//     is drawn from today to election day and never backwards over dates that
//     have already happened.
//
//   * A SUPERSEDED POLL IS DRAWN, HOLLOW, and its candidate still gets a line
//     below. Maine carries 29 readings of two people who are no longer running;
//     excluding them from the average is right and hiding them is not.
//
//   * AN INDEPENDENT'S POLLING IS DRAWN AND MARKED AS UNUSED. Four races have a
//     major party missing, the engine drops every D-vs-R reading of them, and
//     the chart would otherwise show an empty race. Nebraska has been polled to
//     a tie four times against a model carrying the seat at D-18. That is the
//     largest disclosed assumption on this site and it belongs on the picture,
//     in a colour that is not the model's.
import d3 from '../d3.js';
import { C, fmtMargin, hoverable, svg } from './util.js';

const W = 680, PH = 218, SH = 132, GAP = 34;
const M = { t: 14, r: 92, b: 26, l: 44 };
const ELECTION = new Date('2026-11-03');
const parse = s => new Date(s + 'T00:00:00');
const SEP = '::';

// The two feeds disagree about case: ElectIndex publishes "Troy Jackson" and
// VoteHub resolves through the FEC master, which shouts "GRAHAM, LUCAS". Drawn
// verbatim they read as two different kinds of thing on one chart. Surname only,
// title-cased, with the internal capital of a McCoy or an O'Brien kept.
const surname = full => {
  const raw = String(full || '').split(',')[0].trim().split(/\s+/).pop() || '';
  return raw.replace(/[A-Za-z']+/g, w =>
    (w.length > 2 && w === w.toUpperCase()
      ? w[0] + w.slice(1).toLowerCase()
      : w));
};

export function raceTrend(host, { polls = [], history = [], independent, race, sigma }) {
  const live = polls.filter(p => !(p.x || '').includes('s'));
  const indPolls = (independent && independent.polls) || [];
  if (!polls.length && history.length < 2 && !indPolls.length) return null;

  const dates = [...polls.map(p => parse(p.d)), ...history.map(h => parse(h.a)),
                 ...indPolls.map(p => parse(p.d)), ELECTION];
  const x = d3.scaleUtc().domain([d3.min(dates), ELECTION]).range([M.l, W - M.r]);

  const mus = history.map(h => h.mu).filter(v => v != null);
  const sig = sigma || 0;
  const lastH = history.filter(h => h.mu != null).at(-1);
  const vals = [...polls.map(p => p.m), ...indPolls.map(p => p.m), ...mus,
                ...(sig && lastH ? [lastH.mu + 2 * sig, lastH.mu - 2 * sig] : [])];
  const pad = Math.max(3, (d3.max(vals) - d3.min(vals)) * 0.12);
  const yTop = M.t, yBot = M.t + PH;
  const y = d3.scaleLinear().domain([d3.min(vals) - pad, d3.max(vals) + pad]).nice()
              .range([yBot, yTop]);

  // The candidate panel is built BEFORE the canvas, because whether it has
  // anything in it decides how tall the canvas is. A race with no usable
  // two-party polling -- every no-Democrat seat, and every unpolled one -- was
  // otherwise reserving 166px for an empty panel and leaving a hole under the
  // chart the size of the chart.
  // KEYED ON THE CANONICAL SURNAME, NOT THE RAW NAME. The two feeds spell the
  // same person differently -- ElectIndex publishes "Susan Collins", VoteHub
  // resolves through the FEC master and gets "COLLINS, SUSAN" -- so keying on the
  // string made one candidate into two series, and the older-spelled half then
  // failed the "still being polled" test and was labelled `Collins - out` while
  // she was on the ballot. Same fix, and the same reasoning, as the posterior's
  // matchup key: surnames are enough to identify a candidate within one race.
  const byCand = new Map();
  const push = (key, row) => byCand.set(key, [...(byCand.get(key) || []), row]);
  for (const p of polls) {
    if (p.dp != null && p.dn) {
      push('D' + SEP + surname(p.dn).toLowerCase(),
           { d: p.d, v: p.dp, party: 'D', name: p.dn });
    }
    if (p.rp != null && p.rn) {
      push('R' + SEP + surname(p.rn).toLowerCase(),
           { d: p.d, v: p.rp, party: 'R', name: p.rn });
    }
  }
  const cands = [...byCand.values()].map(v => v.sort((a, b) => (a.d < b.d ? -1 : 1)))
                                    .sort((a, b) => b.length - a.length);
  const H = M.t + PH + (cands.length ? GAP + SH : 0) + M.b;

  const s = svg(host, W, H, race.race_id + ': polling, the model estimate, and its uncertainty');

  // ---- panel 1: the margin -------------------------------------------------
  s.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', C.mid).attr('stroke-width', 1);
  s.append('text').attr('x', W - M.r + 4).attr('y', y(0) + 3)
    .attr('font-size', 10).attr('fill', C.faint).text('tie');

  const ya = s.append('g').attr('transform', `translate(${M.l},0)`)
    .call(d3.axisLeft(y).ticks(4)
            .tickFormat(v => (v > 0 ? `D+${v}` : v < 0 ? `R+${-v}` : '0')).tickSizeOuter(0));
  ya.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
  ya.selectAll('line,path').attr('stroke', C.line);

  if (sig && lastH) {
    const x0 = x(parse(lastH.a)), x1 = x(ELECTION), mu = lastH.mu;
    const fan = (k, op) => {
      const a = d3.area().x(d => d.t).y0(d => y(mu - k * sig * d.f)).y1(d => y(mu + k * sig * d.f));
      s.append('path')
        .datum(d3.range(0, 1.001, 0.05).map(f => ({ t: x0 + (x1 - x0) * f, f: Math.sqrt(f) })))
        .attr('d', a).attr('fill', C.dem).attr('opacity', op).attr('pointer-events', 'none');
    };
    fan(2, 0.07); fan(1, 0.11);
    s.append('line').attr('x1', x1).attr('x2', x1).attr('y1', yTop).attr('y2', yBot)
      .attr('stroke', C.faint).attr('stroke-dasharray', '2,3');
    s.append('text').attr('x', x1 + 4).attr('y', yTop + 9)
      .attr('font-size', 10).attr('fill', C.faint).text('election');
  }

  if (history.length > 1) {
    const segs = [];
    let cur = [];
    history.forEach((h, i) => {
      if (h.mu == null) { if (cur.length > 1) segs.push(cur); cur = []; return; }
      const prev = cur[cur.length - 1];
      const brk = cur.length && (!h.j || h.r !== prev.r);
      if (i > 0 && brk) {
        segs.push(cur);
        // Carry the boundary point into the next segment when the STYLE changes,
        // so solid and dashed meet rather than leaving a gap the data does not
        // have. An uncertified join is a real gap and is left as one.
        cur = (h.r !== prev.r && h.j) ? [prev] : [];
      }
      cur.push(h);
    });
    if (cur.length > 1) segs.push(cur);
    const line = d3.line().x(d => x(parse(d.a))).y(d => y(d.mu));
    for (const seg of segs) {
      const recon = seg[seg.length - 1].r;
      s.append('path').datum(seg).attr('d', line).attr('fill', 'none')
        .attr('stroke', C.ink).attr('stroke-width', recon ? 1 : 1.9)
        .attr('opacity', recon ? 0.5 : 1)
        .attr('stroke-dasharray', recon ? '3,3' : null);
    }
    hoverable(
      s.append('g').selectAll('circle').data(history.filter(h => h.mu != null)).join('circle')
        .attr('cx', d => x(parse(d.a))).attr('cy', d => y(d.mu))
        .attr('r', d => (d.r ? 1.6 : 2.6)).attr('fill', C.ink)
        .attr('opacity', d => (d.r ? 0.5 : 1)),
      d => `<b>${d.a}</b>${d.r ? ' <em>(reconstructed)</em>' : ''}<br>`
         + `estimate ${fmtMargin(d.mu)}`
         + (d.w != null ? `<br>win probability ${(d.w * 100).toFixed(1)}%` : '')
         + `<br>${d.n} poll${d.n === 1 ? '' : 's'} in the average`
         + (d.r ? '<br><em>today model, given only the polls that existed then</em>' : ''));
  }

  const wmax = d3.max(live, p => p.w) || 1;
  const rad = w => 2 + 5 * Math.sqrt(Math.max(w, 0) / wmax);
  const sup = p => (p.x || '').includes('s');
  hoverable(
    s.append('g').selectAll('circle').data(polls).join('circle')
      .attr('cx', p => x(parse(p.d))).attr('cy', p => y(p.m))
      .attr('r', p => (sup(p) ? 2.6 : rad(p.w)))
      .attr('fill', p => (sup(p) ? 'none' : (p.m >= 0 ? C.dem : C.rep)))
      .attr('stroke', p => (sup(p) ? C.faint : 'none')).attr('stroke-width', 1)
      .attr('opacity', p => (sup(p) ? 0.75 : 0.85)),
    p => {
      const f = p.x || '', bits = [];
      if (sup(p)) bits.push(`<em>superseded &mdash; ${p.k} is no longer the matchup</em>`);
      else bits.push(`weight ${(p.w * 100).toFixed(0)}% of this race polling`);
      if (p.dp != null) bits.push(`${p.dn} ${p.dp}% &middot; ${p.rn} ${p.rp}%`
        + (p.tp ? ` &middot; other ${p.tp}%` : ''));
      if (p.n) bits.push(`n = ${p.n.toLocaleString()}`);
      if (f.includes('p')) bits.push('partisan sponsor, down-weighted');
      if (f.includes('i')) bits.push('campaign internal, down-weighted');
      if (f.includes('u')) bits.push('pollster carries no rating');
      return `<b>${p.p}</b><br>${p.d} &middot; ${fmtMargin(p.m)}<br>${bits.join('<br>')}`;
    });

  if (indPolls.length) {
    hoverable(
      s.append('g').selectAll('path').data(indPolls).join('path')
        .attr('transform', p => `translate(${x(parse(p.d))},${y(p.m)})`)
        .attr('d', d3.symbol().type(d3.symbolDiamond).size(46))
        .attr('fill', 'none').attr('stroke', C.accent).attr('stroke-width', 1.4),
      p => `<b>${p.p}</b><br>${p.d} &middot; ${independent.name} ${fmtMargin(p.m)}`
         + `<br><em>not used by the forecast &mdash; no major-party opponent to price it against</em>`);
    // Beside the newest diamond, not pinned to the top corner where it landed on
    // top of the axis label and the tie marker.
    const lastInd = indPolls[indPolls.length - 1];
    s.append('text').attr('x', x(parse(lastInd.d)) + 8).attr('y', y(lastInd.m) + 3)
      .attr('font-size', 9.5).attr('fill', C.accent)
      .text(independent.name.split(' ').pop());
  }

  // ---- panel 2: the candidates ---------------------------------------------
  const sTop = yBot + GAP, sBot = sTop + SH;
  if (cands.length) {
    const shares = cands.flat().map(c => c.v);
    const ys = d3.scaleLinear()
      .domain([Math.max(0, d3.min(shares) - 6), Math.min(100, d3.max(shares) + 6)]).nice()
      .range([sBot, sTop]);

    const ysa = s.append('g').attr('transform', `translate(${M.l},0)`)
      .call(d3.axisLeft(ys).ticks(4).tickFormat(v => `${v}%`).tickSizeOuter(0));
    ysa.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
    ysa.selectAll('line,path').attr('stroke', C.line);

    const xa = s.append('g').attr('transform', `translate(0,${sBot})`)
      .call(d3.axisBottom(x).ticks(5).tickSizeOuter(0));
    xa.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
    xa.selectAll('line,path').attr('stroke', C.line);

    const dm = ys.domain();
    if (dm[0] <= 50 && dm[1] >= 50) {
      s.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', ys(50)).attr('y2', ys(50))
        .attr('stroke', C.line).attr('stroke-dasharray', '2,4');
      s.append('text').attr('x', W - M.r + 4).attr('y', ys(50) + 3)
        .attr('font-size', 9).attr('fill', C.faint).text('50%');
    }

    const line = d3.line().x(d => x(parse(d.d))).y(d => ys(d.v));
    const newest = polls.reduce((a, p) => (p.d > a ? p.d : a), '');
    for (const cv of cands) {
      const col = cv[0].party === 'D' ? C.dem : C.rep;
      // A candidate whose own newest reading is well behind the race's is one the
      // primary left behind. Faded, so the current pair reads first.
      const stale = cv[cv.length - 1].d < newest;
      const op = stale ? 0.42 : 0.9;
      if (cv.length > 1) {
        s.append('path').datum(cv).attr('d', line).attr('fill', 'none')
          .attr('stroke', col).attr('stroke-width', stale ? 1 : 1.5).attr('opacity', op);
      }
      hoverable(
        s.append('g').selectAll('circle').data(cv).join('circle')
          .attr('cx', d => x(parse(d.d))).attr('cy', d => ys(d.v)).attr('r', 2.2)
          .attr('fill', col).attr('opacity', op),
        d => `<b>${surname(d.name)}</b><br>${d.d} &middot; ${d.v}%`);
      cv.stale = stale; cv.col = col;
    }

    // NAMES GO IN THE MARGIN, NOT ON THE LINES. Labelled at each line's last
    // point they landed in the middle of the chart for every candidate a primary
    // had replaced, on top of the lines still running. Stacked down the right
    // gutter in final-value order, they collide with nothing and still read in
    // the order the lines finish.
    const legend = cands.map(cv => ({
      name: surname(cv[cv.length - 1].name), v: cv[cv.length - 1].v,
      col: cv.col, stale: cv.stale,
    })).sort((a, b) => b.v - a.v);
    let ly = sTop + 10;
    for (const e of legend) {
      const want = Math.max(ly, ys(e.v) + 3);
      ly = want + 12;
      s.append('text').attr('x', W - M.r + 4).attr('y', want)
        .attr('font-size', 9.5).attr('fill', e.col).attr('opacity', e.stale ? 0.55 : 1)
        .text(e.name + (e.stale ? ' \u00b7 out' : ''));
    }
    s.append('text').attr('x', M.l).attr('y', sTop - 9)
      .attr('font-size', 10).attr('fill', C.muted)
      .text('Each candidate share of the same polls');
  } else {
    const xa = s.append('g').attr('transform', `translate(0,${yBot})`)
      .call(d3.axisBottom(x).ticks(5).tickSizeOuter(0));
    xa.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
    xa.selectAll('line,path').attr('stroke', C.line);
  }

  return s;
}
