// Seats that could change hands, across every chamber at once.
//
// ONE QUANTITY RANKS THE LIST: the chance the party holding the seat loses it.
//
//   P(flip) = 1 − P(D)   Democratic-held
//   P(flip) = P(D)       Republican-held
//
// `win_prob` is stated from the non-Republican side of the ballot, so where an
// independent is the only challenger to a Republican (NE-SEN, AK-AL) it is the
// independent's chance, and where one is the only challenger to a Democrat (AZ-03)
// `1 − win_prob` is theirs. The formula holds in both; only the label for who
// gains changes, and that is read off the ballot.
//
// It is not closeness and not tipping share. A seat at 90% to flip is the surest
// flip on the board and the least interesting race to watch, which is why this is
// its own view and not a re-sort of "What to watch".
//
// Governors sit in the same list on purpose. A governorship confers no majority,
// but "does this office change party" is the same question for all three, asked
// of the same kind of number, and the reader asked for them side by side.
import { C, fmtPct, fmtMargin, chamberName } from '../charts/util.js';

const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PARTY = { D: 'Democratic', R: 'Republican', I: 'Independent' };
const COLOUR = { D: C.dem, R: C.rep, I: C.accent };
const SHORT = { house: 'House', senate: 'Senate', governor: 'Gov' };

// Four bands, each named by its bounds. Below the last the chance is under one in
// a hundred, and those seats are counted in a sentence rather than listed.
const TIERS = [
  { lo: 0.5, label: 'More likely than not', rule: 'P(flip) ≥ 50%' },
  { lo: 0.25, label: 'Serious chance', rule: '25% ≤ P(flip) < 50%' },
  { lo: 0.05, label: 'Plausible', rule: '5% ≤ P(flip) < 25%' },
  { lo: 0.01, label: 'Long shot', rule: '1% ≤ P(flip) < 5%', closed: true },
];

// Who takes the seat if the holder loses. Read off the ballot: the other major
// party if it is on it, an independent if one is the only challenger.
function gainer(race) {
  const on = new Set((race.ballot || []).map(c => c.party));
  const other = race.incumbent_party === 'D' ? 'R' : 'D';
  if (on.has(other) || !on.size) return other;
  return on.has('I') ? 'I' : other;
}

function holderName(race) {
  const inc = (race.ballot || []).find(c => c.incumbent && c.party === race.incumbent_party);
  if (inc) return inc.name;
  if (race.incumbent_running === 'open') return null;
  return race.holder_name || null;
}

export function flipsPanel(host, { races, chambers, sims, condition, onPick }) {
  host.replaceChildren();
  const live = !!(condition?.ok && condition.pinned);
  const idx = live ? condition.idx : null;

  const held = races.filter(r => r.incumbent_party === 'D' || r.incumbent_party === 'R');
  const noHolder = races.filter(r => !(r.incumbent_party === 'D' || r.incumbent_party === 'R'));

  const rows = held.map(r => {
    const pD = live ? (sims.winProb(r.race_id, idx) ?? r.win_prob) : r.win_prob;
    return { r, pD, p: r.incumbent_party === 'D' ? 1 - pD : pD, to: gainer(r) };
  }).sort((a, b) => b.p - a.p || a.r.race_id.localeCompare(b.r.race_id));

  // ---- per chamber: the expectation, and the range the draws actually give ----
  const summary = document.createElement('div');
  summary.className = 'fl-sum';
  for (const ch of chambers) {
    const mine = rows.filter(x => x.r.chamber === ch);
    if (!mine.length) continue;
    const exp = mine.reduce((a, x) => a + x.p, 0);
    // Gains by WHO TAKES THE SEAT, not by who loses it. "Republican-held, lost"
    // was being counted as a Democratic gain, which put Osborn's Nebraska into the
    // Democratic net; an independent's win is theirs, and the net between the two
    // parties leaves it out.
    const to = party => mine.filter(x => x.to === party).reduce((a, x) => a + x.p, 0);
    const toD = to('D'), toR = to('R'), toI = to('I');
    const net = toD - toR;
    const likely = mine.filter(x => x.p >= 0.5).length;
    const range = flipRange(sims, mine, idx);
    const card = document.createElement('div');
    card.className = 'fl-card';
    card.innerHTML =
      `<div class="fl-ch">${chamberName(ch)}</div>`
      + `<div class="fl-n">${exp.toFixed(1)}</div>`
      + `<div class="fl-l">expected flips of ${mine.length} held seats</div>`
      + `<table class="fx fl-fx"><tbody>`
      + `<tr><th>→ Democrats</th><td style="color:${C.dem}">${toD.toFixed(1)}</td></tr>`
      + `<tr><th>→ Republicans</th><td style="color:${C.rep}">${toR.toFixed(1)}</td></tr>`
      + (toI >= 0.05
        ? `<tr><th>→ independents</th><td style="color:${C.accent}">${toI.toFixed(1)}</td></tr>` : '')
      + `<tr><th>Net</th><td style="color:${net >= 0 ? C.dem : C.rep}">`
      + `${net >= 0 ? 'D' : 'R'} +${Math.abs(net).toFixed(1)}</td></tr>`
      + `<tr><th>More likely than not</th><td>${likely}</td></tr>`
      + (range ? `<tr><th>80% of simulations</th><td>${range.p10}–${range.p90}</td></tr>` : '')
      + `</tbody></table>`;
    summary.append(card);
  }
  host.append(summary);

  // ---- which direction ---------------------------------------------------
  // A reader asking "what could Democrats pick up" wants the Republican seats and
  // nothing else. Not a chamber filter: the scope strip already is one, and a second
  // control answering the same question is how a heading and a list come to disagree.
  let dir = 'all';
  const bar = document.createElement('div');
  bar.className = 'table-bar fl-bar';
  const tg = document.createElement('div');
  tg.className = 'toggle';
  tg.setAttribute('role', 'group');
  tg.setAttribute('aria-label', 'Which seats to list');
  const count = document.createElement('span');
  count.className = 'table-count';
  for (const [v, l] of [['all', 'All held seats'], ['R', 'Republican-held'], ['D', 'Democratic-held']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l;
    b.dataset.dir = v;
    b.onclick = () => { dir = v; draw(); };
    tg.append(b);
  }
  bar.append(tg, count);
  host.append(bar);

  const listHost = document.createElement('div');
  host.append(listHost);

  // Remembered across redraws within this render, so flipping the direction does
  // not re-close a band the reader opened.
  const opened = new Set();

  function draw() {
    for (const b of tg.querySelectorAll('button')) {
      const on = b.dataset.dir === dir;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const pool = rows.filter(x => dir === 'all' || x.r.incumbent_party === dir);
    const floor = TIERS.at(-1).lo;
    const shown = pool.filter(x => x.p >= floor);
    count.textContent = `${shown.length} seats with at least a 1% chance of flipping, of ${pool.length}`;

    listHost.replaceChildren();
    TIERS.forEach((t, i) => {
      const hiBound = i ? TIERS[i - 1].lo : Infinity;
      const band = pool.filter(x => x.p >= t.lo && x.p < hiBound);
      if (!band.length) return;
      const det = document.createElement('details');
      det.className = 'fl-tier';
      det.open = t.closed ? opened.has(t.label) : !opened.has(`closed:${t.label}`);
      det.addEventListener('toggle', () => {
        if (t.closed) { if (det.open) opened.add(t.label); else opened.delete(t.label); }
        else if (det.open) opened.delete(`closed:${t.label}`); else opened.add(`closed:${t.label}`);
      });
      const sum = document.createElement('summary');
      sum.innerHTML = `<span class="fl-tl">${t.label}</span>`
        + `<code class="fl-rule">${t.rule}</code>`
        + `<span class="fl-tc">${band.length} seat${band.length === 1 ? '' : 's'}</span>`;
      det.append(sum);

      const list = document.createElement('div');
      list.className = 'fl-list';
      for (const x of band) list.append(row(x));
      det.append(list);
      listHost.append(det);
    });

    const below = pool.length - shown.length;
    const foot = document.createElement('p');
    foot.className = 'chart-note';
    foot.innerHTML =
      `<b>${below}</b> more held seat${below === 1 ? '' : 's'} flip in fewer than 1 in 100 `
      + 'simulations and are not listed.'
      + (noHolder.length
        ? ` <b>${noHolder.length}</b> race${noHolder.length === 1 ? ' has' : 's have'} no recorded `
          + `holding party (${noHolder.map(r => esc(r.race_id)).join(', ')}), and a flip is only `
          + 'defined against a holder, so they are left out.'
        : '')
      + (live
        ? ' <span class="frozen">Probabilities and ranges are counted from your pinned simulations. '
          + 'Median margins are the unconditional forecast.</span>'
        : '')
      + ' Click any row for that race’s full working.';
    listHost.append(foot);
  }

  function row({ r, p, to }) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fl-row';
    const from = r.incumbent_party;
    const name = holderName(r);
    const redrawn = r.boundary_stale;
    b.innerHTML =
      `<span class="fl-id"><span class="fl-chip">${SHORT[r.chamber] || r.chamber}</span>${esc(r.race_id)}</span>`
      + `<span class="fl-who">`
      + `<span class="fl-from" style="color:${COLOUR[from]}">${from}</span>`
      + `<span class="fl-name">${name ? esc(name) : 'open seat'}</span>`
      + `<span class="fl-arrow">→</span>`
      + `<span class="fl-to" style="color:${COLOUR[to]}">${to}</span>`
      + (redrawn ? '<span class="fl-tag">redrawn</span>' : '')
      + `</span>`
      + `<span class="fl-p">${fmtPct(p, 0)}</span>`
      + `<span class="fl-bar"><i style="width:${(p * 100).toFixed(1)}%;background:${COLOUR[to]}"></i></span>`
      + `<span class="fl-m">${r.locked ? 'settled' : fmtMargin(r.median_margin)}</span>`;
    b.setAttribute('aria-label',
      `${r.race_id}, ${chamberName(r.chamber)}, held by ${PARTY[from]}${name ? ` (${name})` : ', open seat'}, `
      + `${fmtPct(p, 0)} chance of flipping to ${PARTY[to]}. Open the full working for this race.`);
    b.onclick = () => onPick && onPick(r);
    return b;
  }

  draw();

  const key = document.createElement('p');
  key.className = 'fl-key';
  key.innerHTML = '<span>Race</span><span>Held by → gains if it flips</span>'
    + '<span>P(flip)</span><span></span><span>Median</span>';
  listHost.before(key);
}

// How many seats flip in one simulated election night, at the 10th and 90th
// percentile. Counted from the draws: a seat in the payload contributes its bit,
// and one that never varies (so never travels) contributes its fixed outcome in
// every draw. The expectation is the mean of this; the range is what a single
// night can look like, which no sum of probabilities can say.
function flipRange(sims, mine, idx) {
  if (!sims) return null;
  const n = idx ? idx.length : sims.m.n_sims;
  if (!n) return null;
  const counts = new Int16Array(n);
  let fixed = 0;
  for (const { r, p } of mine) {
    const c = sims.col.get(r.race_id);
    if (c === undefined) { if (p >= 0.5) fixed++; continue; }
    const flipOnD = r.incumbent_party === 'R' ? 1 : 0;
    for (let i = 0; i < n; i++) {
      if (sims.bit(idx ? idx[i] : i, c) === flipOnD) counts[i]++;
    }
  }
  const sorted = counts.sort();
  const q = t => sorted[Math.min(n - 1, Math.floor(t * n))] + fixed;
  return { p10: q(0.10), p90: q(0.90) };
}
