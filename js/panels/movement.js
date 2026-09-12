// What moved the forecast since the previous run.
//
// The delta under each topline card used to say only how far the number went.
// This says what took it there, and every share is an exact re-run from the
// engine (engine/dashboard/movement.py), not a share of a linearisation.
//
// THREE THINGS ARE DELIBERATE.
//
//   * THE BAR CARRIES THE NUMBER'S OWN QUANTITY. Length is the size of that
//     cause's contribution and the side is its direction, which is exactly what
//     the figure beside it says. The watchlist shipped a bar that encoded a
//     different quantity from its own label and it looked right for months
//     (finding 41), so a bar here is drawn from the same field that is printed.
//
//   * DIRECTION IS NOT CARRIED BY HUE ALONE. Every row states its own sign and
//     names the party it favours; the colour repeats that, it does not carry it.
//
//   * A CAUSE THE ORDERINGS DISAGREE ABOUT IS NOT REPORTED AS A NUMBER. These
//     effects are not additive. Where the two orderings the engine runs give
//     materially different shares, the row says the causes cannot be separated
//     instead of printing the midpoint and implying a precision that is not
//     there.
import { C } from '../charts/util.js';

const LABEL = {
  environment: 'The national polling',
  polls: 'Polls in individual races',
  field: 'The ballot and the priors on it',
  uncertainty: 'Uncertainty, not the estimate',
};
const WHY = {
  environment: 'the generic-ballot average, which every unpolled race rides on',
  polls: 'new candidate polls, dropped matchups, changed weights',
  field: 'lean, incumbency, fundraising, a race becoming settled',
  uncertainty: 'the model widened or narrowed without the estimate moving',
};

const el = (t, cls, text) => {
  const n = document.createElement(t);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// Two decimals below a tenth. A cause worth a hundredth of a point is still a
// cause, and rounding it to an em dash told the reader nothing changed on a day
// when the only thing that DID change was this one.
const fmt = (v, unit) => {
  const d = Math.abs(v) < 0.1 ? 2 : 1;
  const n = `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
  return unit === 'seats' ? n : `${n} pts`;
};
const ZERO = 0.005;

export function movementPanel(host, { movement, chamber, chamberLabel }) {
  host.replaceChildren();
  if (!movement) return;

  if (!movement.available) {
    host.append(el('p', 'mv-none', movement.reason));
    return;
  }
  const ch = movement.chambers[chamber];
  if (!ch) return;

  // THE COMMONEST DAY IS THE QUIET ONE, and it has its own sentence. Most days no
  // new generic-ballot poll lands and no race poll moves, and the forecast still
  // drifts a little because the reading it rests on is a day older and the
  // national sigma widens for staleness. "Nothing arrived" is the finding on
  // those days, and four rows of dashes under a promise of explanation is not a
  // way of saying it.
  const movers = ch.components.filter(c => Math.abs(c.mid) >= ZERO);
  const inputsMoved = movers.some(c => c.cause !== 'uncertainty');
  const head = el('p', 'mv-lede');
  const dir = ch.total >= 0 ? 'Democrats' : 'Republicans';
  if (!movers.length) {
    head.innerHTML = `Nothing changed. No new polling arrived and no input moved, so the `
      + `${chamberLabel} forecast is the one published on <b>${movement.from}</b>.`;
  } else if (!inputsMoved) {
    head.innerHTML = `<b>No new polling arrived.</b> Not one generic-ballot reading and not one `
      + `race poll has moved since <b>${movement.from}</b>. The ${chamberLabel} number still `
      + `shifted <b>${fmt(ch.total, ch.unit)}</b>, and all of it is the forecast getting a day `
      + `older: a stale generic ballot widens the national error, which moves a probability `
      + `without moving a single estimate.`;
  } else {
    head.innerHTML = `The ${chamberLabel} number moved <b>${fmt(ch.total, ch.unit)}</b> toward `
      + `<b>${dir}</b> since <b>${movement.from}</b>. Each cause below is the model `
      + `re-run with only that input changed.`;
  }
  host.append(head);

  const rows = [...ch.components].sort((a, b) => Math.abs(b.mid) - Math.abs(a.mid));
  // THE SCALE HAS A FLOOR, so a quiet day looks like a quiet day. Scaled to the
  // largest cause alone, a day whose biggest mover was four hundredths of a point
  // drew a half-width bar and looked identical to a day that moved five points:
  // the axis rescales to flatter whatever it is given, and the reader has no way
  // to see it. One point of control is the floor, so bars are comparable BETWEEN
  // days and a small move is drawn small.
  const span = Math.max(...rows.map(r => Math.abs(r.mid)), Math.abs(ch.total), 1);

  const list = el('div', 'mv');
  for (const r of rows) {
    const row = el('div', 'mv-row');
    const negligible = Math.abs(r.mid) < ZERO;

    row.append(el('span', 'mv-k', LABEL[r.cause] || r.cause));

    const bar = el('span', 'mv-bar');
    const fill = el('i');
    const w = (Math.abs(r.mid) / span * 50).toFixed(1);
    fill.style.width = `${w}%`;
    fill.style[r.mid >= 0 ? 'left' : 'right'] = '50%';
    fill.style.background = r.mid >= 0 ? C.dem : C.rep;
    bar.append(fill);
    row.append(bar);

    const v = el('span', 'mv-v', negligible ? '—' : fmt(r.mid, ch.unit));
    if (!negligible) v.style.color = r.mid >= 0 ? C.dem : C.rep;
    row.append(v);

    const note = el('span', 'mv-note');
    if (negligible) {
      note.textContent = 'nothing here changed';
    } else if (!r.separable) {
      note.textContent = `between ${fmt(r.low, ch.unit)} and ${fmt(r.high, ch.unit)} `
        + '— not separable from the others';
      note.classList.add('mv-wide');
    } else {
      note.textContent = WHY[r.cause] || '';
    }
    row.append(note);

    row.title = `${LABEL[r.cause] || r.cause}: ${fmt(r.mid, ch.unit)} `
      + `(${fmt(r.low, ch.unit)} to ${fmt(r.high, ch.unit)} across the two orderings). `
      + `${WHY[r.cause] || ''}`;
    list.append(row);
  }
  host.append(list);

  const foot = el('p', 'mv-foot');
  foot.innerHTML = 'These causes are not additive, so the engine runs the swaps in both '
    + 'orders and each figure is the midpoint of the two. Where they disagree the row says '
    + 'so rather than picking one.';
  host.append(foot);
}
