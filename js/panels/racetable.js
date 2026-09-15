// The fallback for every question the graphics do not answer, and the
// table view the accessibility pass requires: nothing above is available
// only as colour.
import { C, fmtMargin, scrollAffordance } from '../charts/util.js';

const COLS = [
  { k: 'competitive', label: 'Race', get: r => Math.abs(r.win_prob - 0.5), fmt: r => r.race_id },
  { k: 'state', label: 'State', get: r => r.state },
  // "D win" is a Democrat's chance, so where the D slot holds an independent it is
  // zero, and the independent's own chance is written beside it rather than
  // passed off as a Democrat's.
  { k: 'win_prob', label: 'D win', num: true,
    get: r => (r.ind_slot === 'D' ? 0 : r.win_prob),
    fmt: r => (r.ind_slot === 'D'
      ? `0% (IND ${(r.win_prob * 100).toFixed(1)}%)`
      : r.ind_slot === 'R' && r.win_prob < 0.5
        ? `${(r.win_prob * 100).toFixed(1)}% (IND ${((1 - r.win_prob) * 100).toFixed(1)}%)`
      : r.three_way && (r.ind_win_prob || 0) >= 0.005
        ? `${(r.win_prob * 100).toFixed(1)}% (IND ${(r.ind_win_prob * 100).toFixed(1)}%)`
        : `${(r.win_prob * 100).toFixed(1)}%`) },
  { k: 'median_margin', label: 'Median margin', num: true,
    get: r => r.median_margin ?? -1e9, fmt: r => (r.locked ? 'settled' : fmtMargin(r.median_margin)) },
  // "σ" told a reader who already knew what it was something they already knew.
  { k: 'sigma_total', label: '± points', num: true,
    get: r => r.sigma_total ?? -1, fmt: r => (r.sigma_total?.toFixed(1) ?? '—') },
  { k: 'n_polls', label: 'Polls', num: true, get: r => r.n_polls, fmt: r => r.n_polls || '—' },
  { k: 'incumbent', label: 'Incumbent', get: r => `${r.incumbent_party}/${r.incumbent_running}`,
    fmt: r => `${r.incumbent_party} · ${r.incumbent_running}` },
  { k: 'flags', label: 'Flags', get: r => '',
    fmt: r => [r.prior_stale ? 'superseded map' : '', r.locked ? 'same-party general' : '']
      .filter(Boolean).join(', ') || '—' },
];

// `races` arrives already filtered to the scope. The table used to carry its own
// chamber select, which was the second control on the page answering the same
// question as the scope strip above it -- and the two could disagree, leaving a
// reader looking at a Senate table under a House heading.
export function raceTable(host, { races, scopeLabel = 'races', onPick }) {
  host.replaceChildren();
  // Default to the races in doubt. Sorting by raw probability opens on 60 rows
  // of 0.0% safe seats, which is the least informative view available.
  let sort = { k: 'competitive', dir: 1 }, filter = '';

  const bar = document.createElement('div');
  bar.className = 'table-bar';
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = 'Filter by race, state…';
  search.setAttribute('aria-label', 'Filter races');
  const count = document.createElement('span'); count.className = 'table-count';
  bar.append(search, count);

  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const t = document.createElement('table'); t.className = 'races';
  wrap.append(t);
  host.append(bar, wrap);
  // Seven columns do not fit a phone and the wrap already scrolled; what it did
  // not do was say so, so the table simply looked cut off at MEDIAN MARGIN.
  scrollAffordance(wrap).style.setProperty('--fade-to', 'var(--surface)');

  function draw() {
    const q = filter.trim().toLowerCase();
    let rows = races.filter(r =>
      !q || r.race_id.toLowerCase().includes(q) || r.state.toLowerCase().includes(q));
    const col = COLS.find(c => c.k === sort.k);
    rows = rows.slice().sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    count.textContent = rows.length === races.length
      ? `${races.length} ${scopeLabel}`
      : `${rows.length} of ${races.length} ${scopeLabel}`;

    t.replaceChildren();
    const thead = t.createTHead().insertRow();
    for (const c of COLS) {
      const th = document.createElement('th');
      th.textContent = c.label;
      th.tabIndex = 0;
      th.setAttribute('role', 'button');
      if (sort.k === c.k) th.dataset.sort = sort.dir > 0 ? 'asc' : 'desc';
      const go = () => {
        sort = sort.k === c.k ? { k: c.k, dir: -sort.dir } : { k: c.k, dir: c.num ? -1 : 1 };
        draw();
      };
      th.onclick = go;
      th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      thead.append(th);
    }
    const tb = t.createTBody();
    for (const r of rows.slice(0, 600)) {
      const tr = tb.insertRow();
      tr.tabIndex = 0;
      tr.onclick = () => onPick && onPick(r);
      tr.onkeydown = e => { if (e.key === 'Enter') onPick && onPick(r); };
      for (const c of COLS) {
        const td = tr.insertCell();
        td.textContent = c.fmt ? c.fmt(r) : c.get(r);
        if (c.num) td.className = 'num';
        if (c.k === 'win_prob') {
          const indP = r.three_way ? (r.ind_win_prob || 0)
            : r.ind_slot === 'D' ? r.win_prob : r.ind_slot === 'R' ? 1 - r.win_prob : 0;
          td.style.color = indP >= 0.5 ? C.accent : r.win_prob >= 0.5 && r.ind_slot !== 'D' ? C.dem : C.rep;
        }
      }
    }
  }

  search.oninput = e => { filter = e.target.value; draw(); };
  draw();
}
