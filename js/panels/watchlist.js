// The races worth looking at, and the click-through to each one.
//
// WHICH QUANTITY RANKS THEM is the whole design of this panel, and it is not the
// same question in every chamber.
//
// Where there is a majority to hold, the right quantity already exists and is
// computed from the joint draws: the share of simulations in which this race
// casts the deciding vote (forecast.tipping). It is not "closeness" — a knife-
// edge race in a chamber nobody is contesting decides nothing — and it is not
// closeness times anything, because tipping share already contains closeness. A
// seat that is never in doubt is almost never the seat that tips.
//
// Governors have no such quantity, and inventing one would be the error this
// site refuses elsewhere: 36 governorships confer no collective majority, so no
// race among them can be the deciding one. What they do have is races that could
// go either way, so they are ranked by closeness and the panel states that it has
// changed the question.
import { C, fmtPct, fmtMargin } from '../charts/util.js';

// Candidate names are feed text. Escaped, like everywhere else they are shown.
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "Maria Elvira Salazar" -> "Salazar". The row has space for a surname and the
// drawer behind it has space for everything else.
const surname = n => String(n).trim().split(/\s+/).filter(w => !/^(Jr\.?|Sr\.?|I{2,}|IV)$/i.test(w)).pop();

// Who is actually on the ballot, in the order a reader scans: Democrat first,
// because every number on this page is stated from the Democratic side.
function faces(race) {
  const on = (race.ballot || []).slice()
    .sort((a, b) => (a.party === 'D' ? -1 : b.party === 'D' ? 1 : 0));
  if (!on.length) return '<span class="wl-noballot">ballot not established</span>';
  return on.slice(0, 2).map(c =>
    `<span class="wl-cand" style="color:${c.party === 'D' ? C.dem : c.party === 'R' ? C.rep : C.muted}">`
    + `${esc(surname(c.name))}</span>`).join('<span class="wl-v">v</span>');
}

const MODES = {
  // The chamber has control at stake, so the question is which race delivers it.
  tipping: {
    heading: 'Most often the deciding seat',
    metric: (r, ctx) => ctx.share.get(r.race_id) ?? 0,
    fmt: (v) => `${(v * 100).toFixed(2)}%`,
    unit: 'share of runs',
    // A length from the left, carrying the same share the number reports.
    bar: 'length',
    say: (ch, n, top) =>
      `Ranked by how often each race casts the vote that makes the majority, counted across every `
      + `simulation. The job is spread over <b>${n}</b> different ${ch} races and the busiest takes `
      + `<b>${(top * 100).toFixed(1)}%</b> of them, so this is a list and not one tipping-point `
      + `race.`,
    frozen: 'The ranking is frozen while a race is pinned: it needs each run’s margins, and the '
          + 'payload ships only who won. The win probabilities beside it are live.',
  },
  // No majority to deliver, so no deciding seat exists to rank by.
  closeness: {
    heading: 'Closest to a coin flip',
    metric: r => -Math.abs((r._p ?? r.win_prob) - 0.5),
    fmt: (v, r) => fmtMargin(r.median_margin),
    unit: 'median margin',
    // Diverging about a centre line, carrying the same median margin the number
    // reports. NOT the ranking quantity: see the note on `drawBar`.
    bar: 'diverging',
    say: () =>
      `A different question, because the one above has no answer here: 36 separate offices confer `
      + `no collective majority, so no governor’s race can be the seat that decides control. `
      + `Ranked instead by distance from an even chance. The bars are each race’s median margin `
      + `about a centre line, Democrats to the left, matching the swarm under Every race.`,
    frozen: null,
  },
};

export function watchlist(host, { races, chamber, chamberLabel, tipping, sims, condition,
                                  topN = 6, onPick }) {
  host.replaceChildren();
  const dist = tipping?.distribution ?? null;
  const mode = MODES[dist ? 'tipping' : 'closeness'];
  const share = new Map((dist || []).map(d => [d.race_id, d.share]));

  // Win probability is re-read from the conditioned draws where a pin is set --
  // it is one of the quantities signs can give back. Attached to a copy so the
  // forecast's own race objects, which every other panel reads, are not mutated.
  const live = condition?.ok && condition.pinned;
  const rows = races.map(r => ({
    ...r, _p: live ? (sims.winProb(r.race_id, condition.idx) ?? r.win_prob) : r.win_prob,
  }));

  const ctx = { share };
  const ranked = rows
    .filter(r => !r.locked)                 // a settled same-party general is not a race to watch
    .sort((a, b) => mode.metric(b, ctx) - mode.metric(a, ctx))
    .slice(0, topN);

  if (!ranked.length) {
    host.append(Object.assign(document.createElement('p'), {
      className: 'chart-note', textContent: 'No races to rank in this chamber.' }));
    return;
  }

  const h = document.createElement('h3');
  h.className = 'wl-h';
  h.textContent = mode.heading;
  host.append(h);

  // THE BAR CARRIES THE SAME QUANTITY AS THE NUMBER BESIDE IT. That is the whole
  // rule, and it was broken in closeness mode: the bar was normalised closeness
  // while the number next to it was the median margin -- two quantities sharing
  // one row of a grid. They agreed on ordering only because every governor race
  // carries the same asserted sigma, so probability-closeness and margin-
  // closeness rank identically; one polled governor race, or any chamber with a
  // spread of sigmas, would have pulled them apart and the bar would have
  // contradicted the number it sits next to.
  const span = mode.bar === 'diverging'
    ? Math.max(...ranked.map(r => Math.abs(r.median_margin ?? 0))) || 1
    : Math.max(...ranked.map(r => Math.abs(mode.metric(r, ctx)))) || 1;

  const drawBar = r => {
    if (mode.bar === 'diverging') {
      const m = r.median_margin ?? 0;
      const w = (Math.abs(m) / span * 50).toFixed(1);
      // Democrats left of centre, Republicans right, matching charts/beeswarm.js.
      const side = m >= 0 ? 'right:50%' : 'left:50%';
      return `<span class="wl-bar div"><i style="${side};width:${w}%;`
           + `background:${m >= 0 ? C.dem : C.rep}"></i></span>`;
    }
    const v = mode.metric(r, ctx);
    return `<span class="wl-bar"><i style="width:${(Math.abs(v) / span * 100).toFixed(1)}%;`
         + `background:${r._p >= 0.5 ? C.dem : C.rep}"></i></span>`;
  };

  const list = document.createElement('div');
  list.className = 'wl';

  for (const r of ranked) {
    const v = mode.metric(r, ctx);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wl-row';
    b.setAttribute('aria-label',
      `${r.race_id}, Democratic win probability ${fmtPct(r._p)}, ${mode.unit} `
      + `${mode.fmt(v, r)}. Open the full working for this race.`);
    b.innerHTML =
      `<span class="wl-id">${r.race_id}</span>` +
      `<span class="wl-who">${faces(r)}</span>` +
      `<span class="wl-p" style="color:${r._p >= 0.5 ? C.dem : C.rep}">${fmtPct(r._p, 0)}</span>` +
      drawBar(r) +
      `<span class="wl-v2">${mode.fmt(v, r)}</span>`;
    b.onclick = () => onPick && onPick(r);
    list.append(b);
  }
  host.append(list);

  const key = document.createElement('p');
  key.className = 'wl-key';
  key.innerHTML = `<span>D win</span><span>${mode.unit}</span>`;
  host.append(key);

  const note = document.createElement('p');
  note.className = 'chart-note';
  note.innerHTML = mode.say(chamberLabel, dist ? dist.length : 0, dist ? dist[0].share : 0)
    + (live && mode.frozen ? ` <span class="frozen">${mode.frozen}</span>` : '')
    + ` <b>Click any race for its full working.</b>`;
  host.append(note);
}
