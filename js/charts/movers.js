// Small multiples: the decisive races, and how each has moved.
//
// The movement panel answers "why did the chamber move" at chamber level. This
// answers the question under it -- which races moved -- and the two are not the
// same: a chamber can sit still while the seats inside it trade places.
//
// ONE SHARED SCALE ACROSS ALL OF THEM, which is the whole point of small
// multiples and the thing that is usually got wrong. Scaling each card to its
// own range makes every race look equally eventful: a seat that wobbled half a
// point draws the same amplitude as one that swung six, and the grid becomes a
// wall of identical squiggles. A shared axis costs the quiet ones their detail
// and is the only version where comparing two cards means anything.
//
// The zero line is the only rule drawn. These are the races closest to a tie, so
// crossing it is the event the grid exists to show.
import d3 from '../d3.js';
import { C, fmtMargin, fmtPct, hoverable, svg } from './util.js';

const CW = 168, CH = 74, M = { t: 16, r: 8, b: 4, l: 8 };

export function movers(host, { movers: data, onPick }) {
  host.replaceChildren();
  const rows = (data && data.races) || [];
  if (!rows.length) return null;
  const runs = data.runs || [];

  // Shared, symmetric about the tie, covering every card.
  const lim = Math.max(2, d3.max(rows, r => d3.max(r.mu.filter(v => v != null), v => Math.abs(v))));
  const y = d3.scaleLinear().domain([-lim, lim]).range([CH - M.b, M.t]);
  const x = d3.scaleLinear().domain([0, Math.max(1, runs.length - 1)]).range([M.l, CW - M.r]);

  const grid = document.createElement('div');
  grid.className = 'mv-grid';
  host.append(grid);

  for (const r of rows) {
    const card = document.createElement('button');
    card.className = 'mv-card';
    card.dataset.race = r.race_id;

    const head = document.createElement('div');
    head.className = 'mv-head';
    const dir = r.move >= 0 ? 'D' : 'R';
    head.innerHTML = `<span class="mv-rid">${r.race_id}</span>`
      + `<span class="mv-now">${fmtMargin(r.now)}</span>`;
    card.append(head);

    const box = document.createElement('div');
    card.append(box);
    const s = svg(box, CW, CH, `${r.race_id}: forecast margin over time`);

    s.append('line').attr('x1', M.l).attr('x2', CW - M.r).attr('y1', y(0)).attr('y2', y(0))
      .attr('stroke', C.mid).attr('stroke-width', 1);

    const pts = r.mu.map((v, i) => ({ i, v })).filter(d => d.v != null);
    const line = d3.line().x(d => x(d.i)).y(d => y(d.v));
    s.append('path').datum(pts).attr('d', line).attr('fill', 'none')
      .attr('stroke', r.now >= 0 ? C.dem : C.rep).attr('stroke-width', 1.6);
    const last = pts[pts.length - 1];
    s.append('circle').attr('cx', x(last.i)).attr('cy', y(last.v)).attr('r', 2.6)
      .attr('fill', r.now >= 0 ? C.dem : C.rep);

    const foot = document.createElement('div');
    foot.className = 'mv-foot-row';
    foot.innerHTML =
      `<span class="mv-move ${r.move >= 0 ? 'd' : 'r'}">${r.move >= 0 ? '▲' : '▼'} `
      + `${Math.abs(r.move).toFixed(1)} to ${dir}</span>`
      + `<span class="mv-share">decides ${fmtPct(r.share, 1)}</span>`;
    card.append(foot);

    card.title = `${r.race_id} — ${fmtMargin(r.first)} then, ${fmtMargin(r.now)} now`;
    if (onPick) card.onclick = () => onPick(r.race_id);
    grid.append(card);
  }
  return { n: rows.length, lim };
}
