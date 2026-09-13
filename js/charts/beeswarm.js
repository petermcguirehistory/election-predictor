// Every district on one margin axis.
//
// Answers the question a topline cannot: how much is actually in play. The
// pile-up near zero is the competitive band, and colouring by poll coverage
// makes the model's thinnest claim visible -- only 24 of 435 House districts
// have a usable poll, and the crowd around the middle is almost all prior.
import d3 from '../d3.js';
import { C, svg, fmtMargin, hoverable } from './util.js';

export function beeswarm(host, { races, colorBy = 'polls', scopeLabel = 'races', onPick }) {
  host.replaceChildren();
  const rows = races.filter(r => r.median_margin != null);
  const W = 900, H = 250, m = { t: 14, r: 16, b: 40, l: 16 };
  const clamp = 45;
  // Democratic to the LEFT, so this reads the same way round as the snake
  // directly above it. A page that flips its party axis between two adjacent
  // charts makes the reader re-derive the orientation every time.
  const x = d3.scaleLinear().domain([-clamp, clamp]).range([W - m.r, m.l]);
  const s = svg(host, W, H, `${scopeLabel} by median margin`);

  // Competitive band, drawn first so dots sit over it.
  s.append('rect')
    .attr('x', x(5)).attr('width', x(-5) - x(5))
    .attr('y', m.t).attr('height', H - m.t - m.b)
    .attr('fill', C.accent).attr('fill-opacity', 0.07);

  const nodes = rows.map(r => ({
    r, x0: x(Math.max(-clamp, Math.min(clamp, r.median_margin))),
  }));
  const sim = d3.forceSimulation(nodes)
    .force('x', d3.forceX(d => d.x0).strength(1))
    .force('y', d3.forceY((H - m.b + m.t) / 2).strength(0.06))
    .force('collide', d3.forceCollide(3.6))
    .stop();
  for (let i = 0; i < 160; i++) sim.tick();

  const fill = d => {
    if (colorBy === 'polls') {
      return d.r.n_polls > 0 ? (d.r.median_margin > 0 ? C.dem : C.rep)
                             : d3.interpolateLab(d.r.median_margin > 0 ? C.dem : C.rep, C.surface)(0.62);
    }
    return d.r.median_margin > 0 ? C.dem : C.rep;
  };

  const dots = s.selectAll('circle').data(nodes).join('circle')
    .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', 3.1)
    .attr('fill', fill).attr('fill-opacity', 0.95)
    .style('cursor', 'pointer')
    .on('click', (e, d) => onPick && onPick(d.r));

  hoverable(dots, d =>
    `<b>${d.r.race_id}</b> · ${d.r.state}<br>median ${fmtMargin(d.r.median_margin)} · ` +
    `D win ${(d.r.win_prob * 100).toFixed(0)}%<br>` +
    `<span class="tip-dim">${d.r.n_polls ? `${d.r.n_polls} poll${d.r.n_polls > 1 ? 's' : ''}` : 'prior only'}</span>`);

  s.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t).attr('y2', H - m.b)
    .attr('stroke', C.ink).attr('stroke-width', 1).attr('stroke-opacity', 0.5);

  const axis = s.append('g').attr('transform', `translate(0,${H - m.b + 6})`)
    .call(d3.axisBottom(x).ticks(9).tickFormat(v => (v === 0 ? '0' : `${v > 0 ? 'D' : 'R'}+${Math.abs(v)}`)).tickSizeOuter(0));
  axis.selectAll('text').attr('fill', C.muted).attr('font-size', 11);
  axis.selectAll('line,path').attr('stroke', C.line);

  const n = rows.filter(r => Math.abs(r.median_margin) <= 5).length;
  // A div, not a p: the caption carries a <ul>, which a parser will not leave
  // inside a paragraph.
  const note = document.createElement('div');
  note.className = 'chart-note';
  // `races` minus `rows` are the settled same-party generals: no margin, so no
  // position on a margin axis. Counted out loud rather than silently dropped.
  const off = races.length - rows.length;
  note.innerHTML = `One dot per race, across ` +
    (off ? `<b>${rows.length}</b> of ${races.length} ${scopeLabel}. The other ` +
           `${off} ${off > 1 ? 'are' : 'is'} a settled same-party general — both November ` +
           `candidates in one party, so there is no two-party margin to plot`
         : `all <b>${races.length}</b> ${scopeLabel}`) +
    `.<ul class="pts">` +
    `<li><b>Shaded band</b> — within 5 points of a tie. <b>${n}</b> races sit in it; overturning ` +
    `anything wider takes a national polling miss.</li>` +
    `<li><b>Faded dots</b> — no usable poll. Forecast from the seat's own history.</li>` +
    `</ul>`;
  host.append(note);
}
