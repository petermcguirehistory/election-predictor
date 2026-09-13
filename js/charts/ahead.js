// What is still to come before election day.
//
// Every other view on this page is about what the model knows now. This one is
// about the schedule it is working against: how many days are left, how often
// each feed has actually been speaking, and therefore how much more evidence
// there is to arrive.
//
// EXPECTED ARRIVALS, NOT A PROMISE. The count is days remaining divided by each
// feed's own median gap between readings, measured on this cycle. A feed that
// has published daily for 161 days is likely to keep doing so; it is not
// guaranteed to, which is the whole reason the alarm threshold exists and is
// drawn on the same axis. The two numbers belong together: one says what to
// expect, the other says how long to wait before concluding it has stopped.
import d3 from '../d3.js';
import { C, svg } from './util.js';

const W = 680, H = 132, M = { t: 26, r: 16, b: 30, l: 116 };
const ELECTION = new Date('2026-11-03');

export function ahead(host, { asof, cadence, sigma }) {
  host.replaceChildren();
  const feeds = Object.entries((cadence && cadence.feeds) || {});
  if (!feeds.length) return null;

  const now = new Date(asof + 'T00:00:00');
  const days = Math.round((ELECTION - now) / 864e5);
  const h = M.t + feeds.length * 26 + M.b;
  const x = d3.scaleUtc().domain([now, ELECTION]).range([M.l, W - M.r]);
  const s = svg(host, W, Math.max(H, h), 'Expected readings from each feed before election day');

  const ax = s.append('g').attr('transform', `translate(0,${Math.max(H, h) - M.b})`)
    .call(d3.axisBottom(x).ticks(5).tickSizeOuter(0));
  ax.selectAll('text').attr('font-size', 10).attr('fill', C.muted);
  ax.selectAll('line,path').attr('stroke', C.line);

  s.append('line').attr('x1', x(ELECTION)).attr('x2', x(ELECTION))
    .attr('y1', M.t - 12).attr('y2', Math.max(H, h) - M.b)
    .attr('stroke', C.accent).attr('stroke-dasharray', '3,3');
  s.append('text').attr('x', x(ELECTION)).attr('y', M.t - 16).attr('text-anchor', 'end')
    .attr('font-size', 10).attr('fill', C.accent).text(`election day · ${days} days`);

  feeds.forEach(([name, f], i) => {
    const yy = M.t + i * 26;
    const gap = f.gap_median || 1;
    const expect = Math.max(0, Math.floor(days / gap));

    s.append('text').attr('x', M.l - 10).attr('y', yy + 4).attr('text-anchor', 'end')
      .attr('font-size', 10.5).attr('fill', C.ink)
      .text(name.replace(/_/g, ' '));

    // The track, and a tick at each expected arrival. Capped so a daily feed
    // does not draw fifty-one overlapping marks and read as a solid bar.
    s.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', yy).attr('y2', yy)
      .attr('stroke', C.line).attr('stroke-width', 5).attr('stroke-linecap', 'round');
    const step = Math.max(gap, days / 34);
    const ticks = [];
    for (let d = step; d <= days; d += step) ticks.push(d);
    s.append('g').selectAll('line').data(ticks).join('line')
      .attr('x1', d => x(new Date(+now + d * 864e5)))
      .attr('x2', d => x(new Date(+now + d * 864e5)))
      .attr('y1', yy - 5).attr('y2', yy + 5)
      .attr('stroke', C.dem).attr('stroke-width', 1.4).attr('opacity', .75);

    // How long before silence becomes an alarm.
    const alarm = f.alarm_days;
    if (alarm) {
      const ax2 = x(new Date(+now + alarm * 864e5));
      s.append('line').attr('x1', ax2).attr('x2', ax2).attr('y1', yy - 10).attr('y2', yy + 10)
        .attr('stroke', C.rep).attr('stroke-width', 1).attr('stroke-dasharray', '2,2');
    }

    s.append('text').attr('x', W - M.r).attr('y', yy - 9).attr('text-anchor', 'end')
      .attr('font-size', 9.5).attr('fill', C.muted)
      .text(`~${expect} more · every ${gap}d`);
  });

  return { days, feeds: feeds.length };
}
