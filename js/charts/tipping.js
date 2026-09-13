// How often each race actually delivered the majority-making seat.
//
// Computed by ranking all of a chamber's margins WITHIN each draw, which is why
// it cannot be recomputed in the browser from the sign-only payload and is
// frozen whenever a condition is pinned. 257 House races are the tipping point
// at least once; the top race takes only 2.35%, and that flatness is the point —
// control does not hinge on one seat.
import d3 from '../d3.js';
import { C, svg, hoverable } from './util.js';

// `distribution` is null for a chamber that has no control to deliver. Governors
// are the case, and the panel says so rather than being quietly left off the
// page: a missing chart reads as an oversight, a stated absence reads as a fact
// about the election.
export function tippingChart(host, { distribution, byId, topN = 14, frozen, chamber, onPick }) {
  host.replaceChildren();
  if (!distribution) {
    const p = document.createElement('p');
    p.className = 'chart-note';
    p.innerHTML = `Nothing to draw, and the absence is the answer: no race can be the deciding ` +
      `one where there is nothing collective to decide. The 36 governorships are separate offices ` +
      `and confer no majority. The ordering beside this one answers the question governors do ` +
      `have — how many Democrats win.`;
    host.append(p);
    return;
  }
  const rows = distribution.slice(0, topN);
  const W = 420, rowH = 22, m = { l: 76, r: 46, t: 6, b: 22 };
  const H = rows.length * rowH + m.t + m.b;
  const x = d3.scaleLinear().domain([0, d3.max(rows, d => d.share)]).range([m.l, W - m.r]);

  const s = svg(host, W, H,
    `Share of simulations in which each race delivered ${chamber || ''} control`.replace('  ', ' '));
  const g = s.selectAll('g').data(rows).join('g')
    .attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);

  // These bars name races and were the most obviously clickable thing on the
  // page that did nothing. `byId` was already here to colour them, so the race
  // object needed to open the drawer was in hand the whole time.
  if (onPick) {
    g.style('cursor', 'pointer')
      .on('click', (e, d) => { const r = byId.get(d.race_id); if (r) onPick(r); })
      .on('keydown', (e, d) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const r = byId.get(d.race_id);
        if (r) onPick(r);
      });
  }

  g.append('rect')
    .attr('x', m.l).attr('y', 3).attr('height', rowH - 8)
    .attr('width', d => x(d.share) - m.l)
    .attr('rx', 2)
    .attr('fill', d => {
      const r = byId.get(d.race_id);
      return r ? d3.interpolateLab(r.win_prob >= 0.5 ? C.dem : C.rep, C.surface)(0.25) : C.line;
    });

  g.append('text').attr('x', m.l - 8).attr('y', rowH / 2 + 1).attr('text-anchor', 'end')
    .attr('fill', C.dim).attr('font-size', 11.5).attr('font-family', 'inherit')
    .text(d => d.race_id);
  g.append('text').attr('x', d => x(d.share) + 6).attr('y', rowH / 2 + 1)
    .attr('fill', C.muted).attr('font-size', 11)
    .text(d => `${(d.share * 100).toFixed(2)}%`);

  // The hit area is the whole row. Appended last so it sits above the bar and
  // the labels, and transparent rather than absent -- a 2.3% bar is a few pixels
  // wide, which is not a target.
  g.append('rect')
    .attr('x', 0).attr('y', 0).attr('width', W).attr('height', rowH - 2)
    .attr('fill', 'transparent');

  hoverable(g, d => {
    const r = byId.get(d.race_id);
    return `<b>${d.race_id}</b><br>decides control in ${(d.share * 100).toFixed(2)}% of simulations` +
           (r ? `<br>D win probability ${(r.win_prob * 100).toFixed(0)}%` : '') +
           (onPick ? '<br><span class="tip-dim">click for this race\u2019s full working</span>' : '');
  });

  const note = document.createElement('p');
  note.className = 'chart-note';
  const top = distribution[0];
  note.innerHTML =
    `Each run re-orders the races by its own margins; whichever falls on the majority line is that ` +
    `run's deciding seat. The job is spread over <b>${distribution.length}</b> different races` +
    (top ? `, the busiest being <b>${top.race_id}</b> at <b>${(top.share * 100).toFixed(1)}%</b>`
         : '') +
    `. Hence a distribution, not a single tipping-point race. ` +
    (frozen ? `<span class="frozen">Frozen while a race is pinned: redoing this needs each run's ` +
              `margins, and the payload carries only who won.</span>` : '');
  host.append(note);
}
