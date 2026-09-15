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
// ORDER IS BY MEDIAN MARGIN, for every seat on the ballot including an
// independent's. Ordering by probability would tie every safe seat at 100% and
// leave the order inside those runs to chance.
//
// TWO LINES, WHICH ARE USUALLY ONE. Democrats reach their number counting seats
// from the left, Republicans theirs counting from the right, and each count skips
// the seats that party cannot win: a seat with an independent in its slot. With no
// such seat on the wrong side the two lines fall on the same seat, because the two
// numbers sum to one more than the chamber. Where one exists they separate, and a
// split falling between them is a chamber neither party controls. The Democratic
// line is the race the engine's `tipping.crossing` names, since that ranking also
// sets an independent's slot out of Democratic reach.
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

export function seatStrip(host, { races, size, heldD = 0, needs, chamber, chamberLabel,
                                  prob = r => r.win_prob, frozen = false, onPick }) {
  host.replaceChildren();

  // AN INDEPENDENT'S SEAT SITS WHERE ITS MARGIN PUTS IT. Nebraska is Osborn against
  // Ricketts at IND+3, so it belongs among the close seats -- the first version of
  // this sorted it past the safest Republican seat, which kept it off the
  // Democratic line by drawing a seat Ricketts trails as a safe Republican one.
  // What an independent's seat changes is not where it sits but whose count it
  // joins: none. `p` is a Democrat's chance (zero where the independent holds the
  // D slot), `ind` the independent's, and `slot` the frame's D-slot probability,
  // which is what the colour scale has always read.
  const onBallot = races
    .map(r => ({ r, key: r.locked ? (r.locked_party === 'D' ? 1e6 : -1e6) : (r.median_margin ?? 0) }))
    .sort((a, b) => b.key - a.key)
    .map(({ r }) => {
      const slot = r.locked ? (r.locked_party === 'D' ? 1 : 0) : prob(r);
      return {
        kind: 'race', race: r, slot,
        p: r.ind_slot === 'D' ? 0 : slot,
        ind: r.locked || !r.ind_slot ? null : r.ind_slot === 'D' ? slot : 1 - slot,
      };
    });
  // Whose seat a cell is most likely to be, and that chance.
  const favourite = d => (d.kind === 'held' ? [d.party, 1, d.party === 'D' ? C.dem : C.rep]
    : d.ind != null && d.ind >= 0.5 ? ['IND', d.ind, C.accent]
    : d.p >= 0.5 ? ['D', d.p, C.dem]
    : ['R', 1 - d.p - (d.ind ?? 0), C.rep]);
  const colourOf = d => (d.ind != null && d.ind >= 0.5 ? C.accent : seatColour(d.slot));
  const heldR = Math.max(0, size - heldD - onBallot.length);
  const seats = [
    ...Array.from({ length: heldD }, () => ({ kind: 'held', party: 'D', p: 1, slot: 1 })),
    ...onBallot,
    ...Array.from({ length: heldR }, () => ({ kind: 'held', party: 'R', p: 0, slot: 0 })),
  ];
  seats.forEach((s, i) => { s.rank = i + 1; });
  const n = seats.length;

  // Each party's line: the seat at which its own count, from its own end, reaches
  // its number. A seat it cannot win is passed over rather than counted.
  const canD = d => !(d.kind === 'held' && d.party === 'R') && d.race?.ind_slot !== 'D';
  const canR = d => !(d.kind === 'held' && d.party === 'D') && d.race?.ind_slot !== 'R';
  const lineAt = (need, can, fromRight) => {
    let k = 0;
    for (let i = 0; i < n; i++) {
      const d = seats[fromRight ? n - 1 - i : i];
      if (can(d) && ++k === need) return d.rank;
    }
    return null;
  };
  const dRank = lineAt(needs.D, canD, false);
  const rRank = lineAt(needs.R, canR, true);
  const dPivot = seats[dRank - 1], rPivot = seats[rRank - 1];
  const split = rRank < dRank;
  const lines = split ? [rRank, dRank] : [dRank];
  // The independents' seats that pull the lines apart: on the Democratic side of
  // the Democratic line, or the Republican side of the Republican one.
  const apart = seats.filter(d => (d.race?.ind_slot === 'D' && d.rank < dRank)
                               || (d.race?.ind_slot === 'R' && d.rank > rRank));

  const fav = { D: 0, R: 0, IND: 0 };
  for (const d of seats) fav[favourite(d)[0]]++;

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
  const name = d => (d.kind === 'race' ? d.race.race_id : 'not on the ballot');
  const s = svg(plot, W, H,
    `${chamberLabel}: ${n} seats ordered safest Democratic to safest Republican; `
    + (split
      ? `Republicans reach ${needs.R} at seat ${rRank}, ${name(rPivot)}; Democrats reach `
        + `${needs.D} at seat ${dRank}, ${name(dPivot)}`
      : `seat ${dRank} is ${name(dPivot)}`));
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
  // magnify seats nobody is voting on. Centred on both lines when they differ.
  const firstRace = heldD, lastRace = heldD + onBallot.length - 1;
  let lo = Math.max(firstRace, Math.min(...lines) - 1 - FOCUS_HALF);
  let hi = Math.min(lastRace, Math.max(...lines) - 1 + FOCUS_HALF);
  if (onBallot.length <= FOCUS_HALF * 2 + 1) { lo = firstRace; hi = lastRace; }

  s.append('rect').attr('x', x(lo)).attr('width', x(hi + 1) - x(lo))
    .attr('y', 0).attr('height', H).attr('fill', C.ink).attr('fill-opacity', 0.07);

  s.append('g').selectAll('rect').data(seats).join('rect')
    .attr('x', d => x(d.rank - 1))
    // A hairline of overlap, or 435 antialiased edges draw as a grey comb.
    .attr('width', cw + (n > 150 ? 0.4 : -0.6))
    .attr('y', (H - BAND) / 2).attr('height', BAND)
    .attr('fill', d => (d.kind === 'held' ? `url(#ss-hatch-${chamber}-${d.party})` : colourOf(d)));

  // Each line's seat, outlined and ticked above and below so it survives being one
  // pixel wide.
  for (const rank of lines) {
    const px = x(rank - 1), pw = Math.max(cw, 3);
    s.append('rect').attr('x', px - (pw - cw) / 2).attr('width', pw)
      .attr('y', (H - BAND) / 2 - 3).attr('height', BAND + 6)
      .attr('fill', 'none').attr('stroke', C.accent).attr('stroke-width', 2)
      .attr('vector-effect', 'non-scaling-stroke');
    s.append('line').attr('x1', px + cw / 2).attr('x2', px + cw / 2).attr('y1', 0).attr('y2', H)
      .attr('stroke', C.accent).attr('stroke-width', 1).attr('vector-effect', 'non-scaling-stroke');
  }

  // Hover and click read the seat under the pointer.
  const hit = s.append('rect').attr('width', W).attr('height', H)
    .attr('fill', 'transparent').style('cursor', 'pointer');
  const seatAt = e => seats[Math.max(0, Math.min(n - 1, Math.floor(d3.pointer(e)[0] / cw)))];
  const ctx = { dRank, rRank, split, needs };
  hit.on('pointermove', e => showTip(e, describe(seatAt(e), ctx)))
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
  const raceTag = d => (d.kind === 'race' ? ` · <b>${esc(d.race.race_id)}</b>` : '');
  if (heldD) top.append(lab(`${heldD} D not up`, 'held', 0, 'start'));
  if (heldR) top.append(lab(`${heldR} R not up`, 'held', n, 'end'));

  const bottom = document.createElement('div');
  bottom.className = 'ss-bottom';
  bottom.append(
    lab('← safest Democratic', 'end', 0, 'start'),
    lab('safest Republican →', 'end', n, 'end'));
  if (split) {
    // Adjacent seats, so one label above and one below, each anchored on the side
    // its party counts from, or they would print over each other.
    // Short, and the end labels give way on a phone (theme.css, .ss-split): two
    // line labels either side of the middle leave no room for them at 400px.
    box.classList.add('ss-split');
    top.append(lab(`D reach ${needs.D}${raceTag(dPivot)}`, 'pivot', dRank - 1, 'start'));
    bottom.append(lab(`R reach ${needs.R}${raceTag(rPivot)}`, 'pivot', rRank, 'end'));
  } else {
    top.append(lab(`seat ${dRank}${raceTag(dPivot)}`, 'pivot', dRank - 0.5, 'mid'));
  }
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
    const [side, shown, col] = favourite(d);
    b.className = `ss-cell${lines.includes(d.rank) ? ' pivot' : ''}`
      + `${d.rank > Math.max(...lines) ? ' past' : ''}`;
    b.style.setProperty('--seat', colourOf(d));
    b.innerHTML =
      `<span class="ss-id">${esc(r.race_id)}</span>`
      + `<span class="ss-line"><span class="ss-p" style="color:${col}">`
      + `${r.locked ? 'settled' : `${side} ${fmtPct(shown, 0)}`}</span>`
      + `<span class="ss-rank">${d.rank}</span></span>`;
    b.setAttribute('aria-label',
      `Seat ${d.rank}, ${r.race_id}, ${r.locked ? 'settled'
        : `${side === 'IND' ? 'independent' : side === 'D' ? 'Democrats' : 'Republicans'} `
          + `favoured at ${fmtPct(shown)}`}. `
      + 'Open the full working for this race.');
    b.addEventListener('pointerenter', e => showTip(e, describe(d, ctx)));
    b.addEventListener('pointerleave', hideTip);
    b.onclick = () => onPick && onPick(r);
    grid.append(b);
  }
  host.append(grid);

  // ---- what it says ------------------------------------------------------
  const note = document.createElement('p');
  note.className = 'chart-note';
  const ref = d => (d.kind === 'race'
    ? `<b>${esc(d.race.race_id)}</b> (${fmtMargin(d.race.median_margin)}, `
      + `<code>P(D) = ${fmtPct(d.p, 0)}</code>)`
    : 'a seat not on the ballot');
  const indName = d => esc((d.race.ballot || []).find(c => c.party === 'I')?.name || 'an independent');
  const list = a => (a.length === 1 ? a[0] : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
  // One clause per side, naming the side: an independent's seat inside the
  // Democratic run is not a Democratic seat, and one inside the Republican run is
  // not a Republican one.
  const gapReason = seatsApart => ['D', 'R'].map(side => {
    const here = seatsApart.filter(d => d.race.ind_slot === side);
    if (!here.length) return null;
    const party = side === 'D' ? 'Democratic' : 'Republican';
    return `${list(here.map(d => `<b>${esc(d.race.race_id)}</b> (${indName(d)})`))} `
      + `${here.length === 1 ? 'sits' : 'sit'} on the ${party} side of the strip but would not `
      + `be ${here.length === 1 ? `a ${party} seat` : `${party} seats`}`;
  }).filter(Boolean).join(', and ');
  note.innerHTML =
    (split
      ? `Republicans reach ${needs.R} at seat <b>${rRank}</b>, ${ref(rPivot)}: win it and every `
        + `seat to its right. Democrats reach ${needs.D} at seat <b>${dRank}</b>, ${ref(dPivot)}: `
        + `win it and every seat to its left. The two are ${dRank - rRank} seat`
        + `${dRank - rRank === 1 ? '' : 's'} apart because ${gapReason(apart)}. Democrats taking `
        + `seat ${rRank} but not seat ${dRank} leaves neither party at its number, and the `
        + `independents decide. `
      : `Seat <b>${dRank}</b> is ${ref(dPivot)}. Whoever wins it and every seat on their own `
        + `end of the strip has the chamber: ${needs.D} for Democrats`
        + `${needs.R === needs.D ? ' or Republicans' : `, ${needs.R} for Republicans`}. `)
    + `Democrats are favoured in <b>${fav.D}</b> of ${n} seats, Republicans in <b>${fav.R}</b>`
    + (fav.IND ? `, an independent in <b>${fav.IND}</b>` : '')
    + '. That is a count of favourites, not a forecast of the total: the expected number of seats '
    + 'sums every probability, including the long shots on each side, and is on the seat chart above.'
    + (frozen
      ? ' <span class="frozen">Colours are counted from your pinned simulations; the order is the '
        + 'unconditional forecast, because re-ordering needs each simulation’s margins.</span>'
      : '');
  host.append(note);
}

function describe(d, { dRank, rRank, split, needs }) {
  const at = split
    ? (d.rank === dRank ? ` (Democrats reach ${needs.D} here)`
      : d.rank === rRank ? ` (Republicans reach ${needs.R} here)` : '')
    : (d.rank === dRank ? ' (the majority)' : '');
  if (d.kind === 'held') {
    return `<b>Seat ${d.rank}</b>${at} · ${d.party === 'D' ? 'Democratic' : 'Republican'} seat, `
      + `not on the ballot<br><span class="tip-dim">carries over to the next Congress</span>`;
  }
  const r = d.race;
  return `<b>${esc(r.race_id)}</b> · seat ${d.rank}${at}<br>`
    + (r.locked ? 'settled — same-party general'
      : (d.ind != null ? `independent win ${fmtPct(d.ind, 0)} · ` : '')
        + `D win ${fmtPct(d.p, 0)} · median ${fmtMargin(r.median_margin)}`
        + (r.ind_slot === 'D' ? ' (the independent’s)' : '')
        + `<br><span class="tip-dim">${r.n_polls ? `${r.n_polls} poll${r.n_polls > 1 ? 's' : ''}` : 'prior only'}`
        + ` · held by ${r.incumbent_party === 'UNK' ? 'no recorded party' : r.incumbent_party}</span>`);
}
