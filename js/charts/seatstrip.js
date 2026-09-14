// The seat strip: a whole chamber as one row of equal seats.
//
// What the seat histogram cannot say is WHICH seats. This lines every seat up from
// safest Democratic to safest Republican and colours each by its win probability,
// so the majority stops being a number and becomes a position with a race sitting
// on it.
//
// THE WHOLE CHAMBER, NOT ONLY THE BALLOT. The margin curve this replaced ranked the
// 35 Senate races and had to move its line to seat 17 to account for the 34
// Democratic holdovers it left out. Here the holdovers are drawn -- 34 at the
// Democratic end, and at the Republican end whatever `size` leaves over -- so the
// outlined seat is the 51st of 100 and needs no footnote to be read. Seats not on
// the ballot are hatched: they are counted, not forecast.
//
// ORDER IS BY MEDIAN MARGIN, the same key the engine's `tipping.crossing` uses, so the seat outlined here is the race the rest of the
// page names as the crossing. Ordering by probability would tie every safe seat at
// 100% and leave the order inside those runs to chance.
//
// Under a pin the COLOUR is re-read from the matching draws, because a win
// probability is a count of signs. The ORDER is not: it needs each draw's margin,
// which the payload does not carry, so it stays at the unconditional forecast and
// the note says so.
import d3 from '../d3.js';
import { C, svg, diverging, fmtMargin, fmtPct, showTip, hideTip } from './util.js';

const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// How many seats either side of the majority get drawn large. Forty-one House
// cells wrap to five or six rows at desktop width; wider, and the magnified strip
// stops being the part of the chamber in doubt.
const FOCUS_HALF = 20;

export const seatColour = p => diverging(Math.max(-1, Math.min(1, p * 2 - 1)));

export function seatStrip(host, { races, size, heldD = 0, majority, chamber, chamberLabel,
                                  prob = r => r.win_prob, frozen = false, onPick }) {
  host.replaceChildren();

  const onBallot = races
    .map(r => ({ r, key: r.locked ? (r.locked_party === 'D' ? 1e6 : -1e6) : (r.median_margin ?? 0) }))
    .sort((a, b) => b.key - a.key)
    .map(({ r }) => ({ kind: 'race', race: r, p: r.locked ? (r.locked_party === 'D' ? 1 : 0) : prob(r) }));
  const heldR = Math.max(0, size - heldD - onBallot.length);
  const seats = [
    ...Array.from({ length: heldD }, () => ({ kind: 'held', party: 'D', p: 1 })),
    ...onBallot,
    ...Array.from({ length: heldR }, () => ({ kind: 'held', party: 'R', p: 0 })),
  ];
  seats.forEach((s, i) => { s.rank = i + 1; });
  const n = seats.length;
  const pivot = seats[majority - 1];                 // the seat whose rank is the majority
  const leanD = onBallot.filter(s => s.p >= 0.5).length + heldD;

  // ---- the strip --------------------------------------------------------
  // No text inside the SVG. Its labels are HTML positioned in percentages, so the
  // strip scales to a phone without the chart-scroll floor forcing it wide: a
  // 435-seat strip at 360px is sub-pixel seats, and it still carries the shape of
  // the chamber, which is all the strip is for. The focus rows below carry names.
  const W = 1000, H = 44, BAND = 30;
  const x = d3.scaleLinear().domain([0, n]).range([0, W]);
  const cw = W / n;

  const box = document.createElement('div');
  box.className = 'ss';
  host.append(box);

  const top = document.createElement('div');
  top.className = 'ss-top';
  box.append(top);

  const plot = document.createElement('div');
  plot.className = 'ss-plot';
  box.append(plot);
  const s = svg(plot, W, H,
    `${chamberLabel}: ${n} seats ordered safest Democratic to safest Republican; `
    + `seat ${majority} is ${pivot.kind === 'race' ? pivot.race.race_id : 'not on the ballot'}`);
  s.attr('preserveAspectRatio', 'none').style('height', '44px');

  const defs = s.append('defs');
  for (const [party, col] of [['D', C.dem], ['R', C.rep]]) {
    const pat = defs.append('pattern').attr('id', `ss-hatch-${chamber}-${party}`)
      .attr('patternUnits', 'userSpaceOnUse').attr('width', 6).attr('height', 6)
      .attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 6).attr('height', 6).attr('fill', C.surface);
    pat.append('rect').attr('width', 2.2).attr('height', 6).attr('fill', col).attr('fill-opacity', 0.55);
  }

  // Focus window, on the ballot where possible: a window full of holdovers would
  // magnify seats nobody is voting on.
  const firstRace = heldD, lastRace = heldD + onBallot.length - 1;
  let lo = Math.max(firstRace, majority - 1 - FOCUS_HALF);
  let hi = Math.min(lastRace, majority - 1 + FOCUS_HALF);
  if (onBallot.length <= FOCUS_HALF * 2 + 1) { lo = firstRace; hi = lastRace; }

  s.append('rect').attr('x', x(lo)).attr('width', x(hi + 1) - x(lo))
    .attr('y', 0).attr('height', H).attr('fill', C.ink).attr('fill-opacity', 0.07);

  s.append('g').selectAll('rect').data(seats).join('rect')
    .attr('x', d => x(d.rank - 1))
    // A hairline of overlap, or 435 antialiased edges draw as a grey comb.
    .attr('width', cw + (n > 150 ? 0.4 : -0.6))
    .attr('y', (H - BAND) / 2).attr('height', BAND)
    .attr('fill', d => (d.kind === 'held' ? `url(#ss-hatch-${chamber}-${d.party})` : seatColour(d.p)));

  // The pivot seat, outlined and ticked above and below so it survives being one
  // pixel wide.
  const px = x(majority - 1), pw = Math.max(cw, 3);
  s.append('rect').attr('x', px - (pw - cw) / 2).attr('width', pw)
    .attr('y', (H - BAND) / 2 - 3).attr('height', BAND + 6)
    .attr('fill', 'none').attr('stroke', C.accent).attr('stroke-width', 2)
    .attr('vector-effect', 'non-scaling-stroke');
  s.append('line').attr('x1', px + cw / 2).attr('x2', px + cw / 2).attr('y1', 0).attr('y2', H)
    .attr('stroke', C.accent).attr('stroke-width', 1).attr('vector-effect', 'non-scaling-stroke');

  // Hover and click read the seat under the pointer.
  const hit = s.append('rect').attr('width', W).attr('height', H)
    .attr('fill', 'transparent').style('cursor', 'pointer');
  const seatAt = e => seats[Math.max(0, Math.min(n - 1, Math.floor(d3.pointer(e)[0] / cw)))];
  hit.on('pointermove', e => showTip(e, describe(seatAt(e), majority)))
    .on('pointerleave', hideTip)
    .on('click', e => { const d = seatAt(e); if (d.kind === 'race' && onPick) onPick(d.race); });

  // ---- labels on the strip ---------------------------------------------
  const pct = v => `${(v / n * 100).toFixed(3)}%`;
  const lab = (text, cls, at, align) => {
    const el = document.createElement('span');
    el.className = `ss-lab ${cls}`;
    el.innerHTML = text;
    el.style.left = pct(at);
    el.dataset.align = align;
    return el;
  };
  if (heldD) top.append(lab(`${heldD} D not up`, 'held', 0, 'start'));
  if (heldR) top.append(lab(`${heldR} R not up`, 'held', n, 'end'));
  top.append(lab(`seat ${majority}`
    + (pivot.kind === 'race' ? ` · <b>${esc(pivot.race.race_id)}</b>` : ''), 'pivot', majority - 0.5, 'mid'));

  const bottom = document.createElement('div');
  bottom.className = 'ss-bottom';
  bottom.append(
    lab('← safest Democratic', 'end', 0, 'start'),
    lab('safest Republican →', 'end', n, 'end'));
  box.append(bottom);

  // ---- the focus rows ----------------------------------------------------
  const focus = seats.slice(lo, hi + 1);
  const fh = document.createElement('h4');
  fh.className = 'ss-fh';
  fh.textContent = lo === firstRace && hi === lastRace
    ? `All ${focus.length} seats on the ballot, in strip order`
    : `Seats ${lo + 1}–${hi + 1}, nearest the majority, in strip order`;
  host.append(fh);

  const grid = document.createElement('div');
  grid.className = 'ss-grid';
  for (const d of focus) {
    const b = document.createElement('button');
    b.type = 'button';
    const r = d.race;
    const side = d.p >= 0.5 ? 'D' : 'R';
    const shown = side === 'D' ? d.p : 1 - d.p;
    b.className = `ss-cell${d.rank === majority ? ' pivot' : ''}${d.rank > majority ? ' past' : ''}`;
    b.style.setProperty('--seat', seatColour(d.p));
    b.innerHTML =
      `<span class="ss-id">${esc(r.race_id)}</span>`
      + `<span class="ss-line"><span class="ss-p" style="color:${side === 'D' ? C.dem : C.rep}">`
      + `${r.locked ? 'settled' : `${side} ${fmtPct(shown, 0)}`}</span>`
      + `<span class="ss-rank">${d.rank}</span></span>`;
    b.setAttribute('aria-label',
      `Seat ${d.rank}, ${r.race_id}, ${r.locked ? 'settled' : `${fmtPct(d.p)} chance Democrats win`}. `
      + 'Open the full working for this race.');
    b.addEventListener('pointerenter', e => showTip(e, describe(d, majority)));
    b.addEventListener('pointerleave', hideTip);
    b.onclick = () => onPick && onPick(r);
    grid.append(b);
  }
  host.append(grid);

  // ---- what it says ------------------------------------------------------
  const note = document.createElement('p');
  note.className = 'chart-note';
  const gap = leanD - majority;
  note.innerHTML =
    `Seat <b>${majority}</b> is `
    + (pivot.kind === 'race'
      ? `<b>${esc(pivot.race.race_id)}</b> (${fmtMargin(pivot.race.median_margin)}, `
        + `<code>P(D) = ${fmtPct(pivot.p, 0)}</code>)`
      : 'not on the ballot')
    + `. Democrats are favoured in <b>${leanD}</b> of ${n} seats, `
    + (gap === 0 ? `exactly the ${majority} a majority needs. `
      : `<b>${Math.abs(gap)}</b> ${gap > 0 ? 'more than' : 'short of'} the ${majority} a majority needs. `)
    + 'That is a count of favourites, not a forecast of the total: the expected number of seats '
    + 'sums every probability, including the long shots on each side, and is on the seat chart above.'
    + (frozen
      ? ' <span class="frozen">Colours are counted from your pinned simulations; the order is the '
        + 'unconditional forecast, because re-ordering needs each simulation’s margins.</span>'
      : '');
  host.append(note);
}

function describe(d, majority) {
  if (d.kind === 'held') {
    return `<b>Seat ${d.rank}</b> · ${d.party === 'D' ? 'Democratic' : 'Republican'} seat, `
      + `not on the ballot<br><span class="tip-dim">carries over to the next Congress</span>`;
  }
  const r = d.race;
  return `<b>${esc(r.race_id)}</b> · seat ${d.rank}${d.rank === majority ? ' (the majority)' : ''}<br>`
    + (r.locked ? 'settled — same-party general'
      : `D win ${fmtPct(d.p, 0)} · median ${fmtMargin(r.median_margin)}`
        + `<br><span class="tip-dim">${r.n_polls ? `${r.n_polls} poll${r.n_polls > 1 ? 's' : ''}` : 'prior only'}`
        + ` · held by ${r.incumbent_party === 'UNK' ? 'no recorded party' : r.incumbent_party}</span>`);
}
