// Where the seats come from.
//
// Neither the seat histogram nor the snake answers "who has to lose a seat for
// this to happen". This does.
//
// The first version drew this as a two-by-two flow, and it was the wrong shape
// for the data: 400 of 435 seats stay put, so the chart was two enormous hold
// blocks with the flips as hairlines between them — it hid its own subject. The
// flips ARE the subject, so only they are drawn.
//
// Contributions are EXPECTED counts: each race adds its win probability, so a
// seat at 55% is 0.55 of a flip. Rounding to whole seats before summing throws
// away most of the signal in exactly the close races that decide control.
//
// Sixteen districts have no established incumbent party. They are shown as their
// own row rather than folded into one side — the model does not know who holds
// them, and a flip is defined against a holder.
import d3 from '../d3.js';
import { C, svg, fmtMargin, hoverable } from './util.js';

export function flows(host, { races, chamber = 'house', unit = 'districts', seat = 'seat',
                              topN = 10, onPick }) {
  host.replaceChildren();
  const rows = races.filter(r => r.chamber === chamber);
  const held = p => rows.filter(r => r.incumbent_party === p);
  const D = held('D'), R = held('R'), U = rows.filter(r => r.incumbent_party === 'UNK');

  const dGain = d3.sum(R, r => r.win_prob);          // R-held seats going D
  const rGain = d3.sum(D, r => 1 - r.win_prob);      // D-held seats going R
  const net = dGain - rGain;

  const wrap = document.createElement('div');
  wrap.className = 'flow-cols';

  const column = (title, list, key, colour) => {
    const box = document.createElement('div');
    const h = document.createElement('h3');
    h.innerHTML = title;
    box.append(h);

    const top = list.map(r => ({ r, p: key(r) })).filter(d => d.p > 0.01)
      .sort((a, b) => b.p - a.p).slice(0, topN);
    const W = 300, rowH = 21, m = { l: 66, r: 42, t: 4, b: 4 };
    const H = top.length * rowH + m.t + m.b;
    const x = d3.scaleLinear().domain([0, 1]).range([m.l, W - m.r]);
    const s = svg(box, W, H, title.replace(/<[^>]+>/g, ''));

    const g = s.selectAll('g').data(top).join('g')
      .attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`)
      .style('cursor', 'pointer')
      .on('click', (e, d) => onPick && onPick(d.r));
    g.append('rect').attr('x', m.l).attr('y', 3).attr('height', rowH - 8)
      .attr('width', d => x(d.p) - m.l).attr('rx', 2)
      .attr('fill', colour).attr('fill-opacity', 0.75);
    g.append('text').attr('x', m.l - 8).attr('y', rowH / 2 + 1).attr('text-anchor', 'end')
      .attr('fill', C.dim).attr('font-size', 11).text(d => d.r.race_id);
    g.append('text').attr('x', d => x(d.p) + 6).attr('y', rowH / 2 + 1)
      .attr('fill', C.muted).attr('font-size', 10.5)
      .text(d => `${(d.p * 100).toFixed(0)}%`);
    hoverable(g, d =>
      `<b>${d.r.race_id}</b> · ${d.r.state}<br>${(d.p * 100).toFixed(0)}% chance of flipping<br>` +
      `<span class="tip-dim">median ${fmtMargin(d.r.median_margin)} · ` +
      `${d.r.n_polls ? `${d.r.n_polls} poll${d.r.n_polls > 1 ? 's' : ''}` : 'prior only'}</span>`);
    return box;
  };

  wrap.append(
    column(`Democrats gain <b>${dGain.toFixed(1)}</b> <span class="fc-sub">of ${R.length} Republican-held ${unit}</span>`,
           R, r => r.win_prob, C.dem),
    column(`Republicans gain <b>${rGain.toFixed(1)}</b> <span class="fc-sub">of ${D.length} Democratic-held ${unit}</span>`,
           D, r => 1 - r.win_prob, C.rep),
  );

  const head = document.createElement('div');
  head.className = 'flow-net';
  head.innerHTML =
    `<span class="fn-n" style="color:${net >= 0 ? C.dem : C.rep}">${net >= 0 ? '+' : ''}${net.toFixed(1)}</span>` +
    `<span class="fn-l">net expected change in Democratic ${seat}s,<br>`
    + `from ${rows.length} ${chamber === 'house' ? 'districts' : `${unit} on the ballot`}</span>`;
  host.append(head, wrap);

  const note = document.createElement('p');
  note.className = 'chart-note';
  note.innerHTML =
    `The ${topN} likeliest flips each way. Each race contributes its probability, not a whole ` +
    `seat, so these are expected counts: no single run looks like this, because in one run each ` +
    `seat goes entirely one way.` +
    (U.length
      ? ` <b>${U.length}</b> ${unit} sit outside both columns — no party is recorded as holding ` +
        `them, and a flip is only defined against a holder. They still contribute ` +
        `<b>${d3.sum(U, r => r.win_prob).toFixed(1)}</b> expected Democratic ${seat}s to the net ` +
        `above.`
      : '');
  host.append(note);
}
