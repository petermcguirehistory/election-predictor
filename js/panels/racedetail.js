// How this particular race got its number.
//
// The arithmetic is reproduced from the payload's own columns, and it agrees
// with the engine exactly: prior_mu = lean_weight x lean + elasticity x environment
// + inc_adj + record_adj + fundraising_adj, and poll_weight = eff_n / (eff_n + 3).
//
// That formula is the panel's whole contract, and it went stale once: the
// fundraising term shipped after this was written and was absent here for ten
// days, which made the rows stop summing to the total on 129 races without
// anything failing.
//
// The eight locked races get a different panel entirely. Their mu is OVERRIDDEN
// to a sentinel, not blended -- a same-party general is settled, not forecast --
// so showing them a blend would be a fabrication. What they can honestly show is
// the ordinary prior the district would otherwise have had.
//
// THE BALLOT BLOCK sits above all of that, and it is the only part of the panel
// that is about people rather than arithmetic. Two things in it are deliberate:
//
//   * `incumbent` is a fact about a NAMED PERSON, settled against FEC filings by
//     engine/registry/ballot.py, and `incumbent_running` is the party-level claim
//     the model's 2.5-point bonus actually follows. They disagree in 16 races. The
//     block shows the first and the incumbency row shows the second, and where
//     they part company the row says so rather than either being quietly dropped.
//
//   * a race with no incumbent names who holds the seat anyway. "Open" is the
//     model's word for it; "Cornyn is not running" is what a reader wants, and it
//     is the difference between a seat the party is defending and one it is not.
import d3 from '../d3.js';
import { C, fmtMargin, fmtPct } from '../charts/util.js';
import { loadRaceDetail } from '../data.js';
import { raceTrend } from '../charts/racetrend.js';
import { varianceBar } from '../charts/variance.js';
import { seatHistory, pollsterTable, conditionalReadout } from '../charts/racepanels.js';

const row = (k, v, cls) =>
  `<div class="dt-row ${cls || ''}"><span class="dt-k">${k}</span><span class="dt-v">${v}</span></div>`;

// Candidate names are feed text, not engine output, so they are escaped rather
// than trusted. Nothing else in this panel is free text.
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PARTY_COLOUR = { D: C.dem, R: C.rep };
const PARTY_LABEL = { D: 'Democrat', R: 'Republican', I: 'Independent' };

// Who is on the ballot, who among them holds the seat, and -- when none of them
// does -- who does. The third is the one the payload cannot always answer: the
// FEC covers no state office, so a governor's seat can only be given a party.
//
// A race where nobody on the ballot has filed as the incumbent but the feed
// still records the seat as defended is NOT called open here, because the model
// did not treat it as open: it paid the incumbency bonus. The line says both.
// A margin in the frame's D-slot convention, labelled with who is actually ahead.
// Where an independent holds a missing party's slot the positive or negative side
// is theirs, and "D+3.0" for Osborn over Ricketts named a Democrat who is not on
// the ballot.
function slotMargin(race, m) {
  if (m == null) return fmtMargin(m);
  const pos = race.ind_slot === 'D' ? 'IND' : 'D';
  const neg = race.ind_slot === 'R' ? 'IND' : 'R';
  return `${m > 0 ? pos : neg}+${Math.abs(m).toFixed(1)}`;
}

function ballotBlock(race) {
  const on = race.ballot || [];
  if (!on.length) return '';
  const heldBy = race.incumbent_party && race.incumbent_party !== 'UNK'
    ? race.incumbent_party : null;
  const held = heldBy ? ` (${heldBy})` : '';
  const openSeat = `Open seat${heldBy ? `, ${heldBy}-held` : ''}`;

  let html = '<ul class="dt-ballot">';
  for (const c of on) {
    html += `<li><span class="dt-chip" style="background:${PARTY_COLOUR[c.party] || C.muted}"></span>
      <span class="dt-name">${esc(c.name)}</span>
      <span class="dt-party">${PARTY_LABEL[c.party] || c.party}</span>
      ${c.incumbent ? '<span class="dt-inc">incumbent</span>' : ''}</li>`;
  }
  html += '</ul>';

  if (on.some(c => c.incumbent)) return html;

  const redrawn = race.boundary_stale
    ? ' The filing record names that member against this district number on its previous'
      + ' lines, and the district has since been redrawn.'
    : '';
  let note;
  if (race.holder_name && race.incumbent_running === 'incumbent') {
    note = `${esc(race.holder_name)}${held} holds the seat. The race feed records it as
      incumbent-defended and the model's adjustment follows that, but no candidate on this
      ballot has filed with the FEC as its incumbent.${redrawn}`;
  } else if (race.holder_name) {
    note = `Open seat — ${esc(race.holder_name)}${held} holds it and is not on the November
      ballot.${redrawn}`;
  } else if (race.chamber === 'governor') {
    note = `${openSeat} — governors are not federal offices, so no filing record here
      names the sitting governor.`;
  } else {
    note = `${openSeat} — nobody has filed with the FEC as its incumbent.`;
  }
  return `${html}<p class="dt-holder">${note}</p>`;
}

// What the INCUMBENCY ROW has to say beyond its own number. The adjustment is
// driven by a party column and the ballot block by names; they agree in 490 of
// 506 races, and the note exists for the sixteen where a reader would otherwise
// be looking at two claims and no way to tell which one moved the forecast.
function incumbencyNote(race, adj) {
  // Governors run on their own fitted prior, where the incumbent is the last
  // race's winner by name (engine/priors/governor.py), so the feed-versus-filing
  // notes below do not apply to them.
  if (race.chamber === 'governor') {
    return adj ? 'the last elected governor is running again; fitted on past governor races'
               : 'the last elected governor is not on this ballot';
  }
  const badged = (race.ballot || []).some(c => c.incumbent);
  const claimed = race.incumbent_running === 'incumbent';
  if (badged && adj) return '';
  if (badged && !claimed) {
    return 'the sitting member is on this ballot, but the race feed records the seat as '
         + 'open, so the model applied nothing';
  }
  if (badged) {
    // No race is in this state today. It is spelt out rather than folded into
    // the branch above, which would otherwise call a defended seat open.
    return `the seat is recorded as ${race.incumbent_party}-held, and the adjustment is `
         + 'defined only for a D or R incumbent';
  }
  if (claimed) return 'follows the race feed, not a named candidate — see above';
  return 'no incumbent running';
}

export function raceDetail(host, { race, forecast, sims, condition, onPin, onClose, rule }) {
  host.replaceChildren();
  if (!race) { host.hidden = true; host.dataset.race = ''; return; }
  host.hidden = false;
  host.dataset.race = race.race_id;

  const env = forecast.environment.margin;
  const sig = forecast.sigma;
  const box = document.createElement('div');
  box.className = 'drawer-inner';

  // WIDER, BECAUSE 420px IS NOT ENOUGH FOR A CHART. The drawer was sized for a
  // column of figures and now carries two time series and three panels; at its
  // default width every chart in it has to scroll to stay legible. The toggle is
  // remembered per reader in localStorage rather than in the hash: it is a
  // preference about this screen, not part of the view a link describes, and a
  // shared link should open the way the recipient likes it rather than the way
  // the sender does.
  const WIDE_KEY = 'drawer-wide';
  let wide = false;
  try { wide = localStorage.getItem(WIDE_KEY) === '1'; } catch { /* private window */ }
  host.classList.toggle('wide', wide);

  const grow = document.createElement('button');
  grow.className = 'drawer-grow';
  const label = () => {
    grow.textContent = wide ? '⇥' : '⇤';
    grow.title = wide ? 'Narrow this panel' : 'Widen this panel';
    grow.setAttribute('aria-label', grow.title);
    grow.setAttribute('aria-pressed', String(wide));
  };
  label();
  grow.onclick = () => {
    wide = !wide;
    host.classList.toggle('wide', wide);
    try { localStorage.setItem(WIDE_KEY, wide ? '1' : '0'); } catch { /* ignore */ }
    label();
    // The charts size themselves off the container, so they have to be told the
    // container moved. util.js is already listening for exactly this.
    dispatchEvent(new Event('resize'));
  };

  const close = document.createElement('button');
  close.className = 'drawer-close'; close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.onclick = onClose;

  const cond = condition.pinned && condition.ok ? sims.winProb(race.race_id, condition.idx) : null;

  let body = `<h3>${race.race_id} <span class="dt-state">${race.state} · ${race.chamber}</span></h3>`;
  body += ballotBlock(race);

  if (race.locked) {
    body += `<p class="dt-lead">Settled — a same-party general under top-two. Both November
      candidates are ${race.locked_party === 'D' ? 'Democrats' : 'Republicans'}, so the seat is
      decided rather than forecast, and carried as a certain ${race.locked_party} hold.</p>`;
    body += row('2024 presidential margin', fmtMargin(race.pres_margin));
    body += row('District lean', fmtMargin(race.lean));
    body += row('Estimate it would otherwise carry', fmtMargin(race.prior_mu));
  } else {
    // WHOSE WIN IT IS. `win_prob` is the frame's D slot, and where an independent
    // stands in for a missing party (`ind_slot`) that slot -- or its opponent -- is
    // the independent, not a party. Labelling Osborn's 63% "D favoured" was the
    // race-level half of the error the Senate topline made.
    const indName = esc((race.ballot || []).find(c => c.party === 'I')?.name || 'Independent');
    const dSide = race.ind_slot === 'D' ? { tag: indName, col: C.accent } : { tag: 'D', col: C.dem };
    const rSide = race.ind_slot === 'R' ? { tag: indName, col: C.accent } : { tag: 'R', col: C.rep };
    // A three-way race has three chances, and the favourite is the largest of them.
    const pI = race.three_way ? (race.ind_win_prob || 0) : 0;
    const three = race.three_way
      ? [[race.win_prob, dSide], [Math.max(0, 1 - race.win_prob - pI), rSide],
         [pI, { tag: indName, col: C.accent }]].sort((a, b) => b[0] - a[0])[0]
      : null;
    const fav = three ? three[1] : race.win_prob >= 0.5 ? dSide : rSide;
    const favP = three ? three[0] : race.win_prob >= 0.5 ? race.win_prob : 1 - race.win_prob;
    body += `<div class="dt-head">
        <div><span class="dt-big" style="color:${fav.col}">
          ${fmtPct(favP)}</span>
          <span class="dt-sub">${fav.tag} favoured</span></div>
        <div><span class="dt-big">${slotMargin(race, race.median_margin)}</span>
          <span class="dt-sub">median margin</span></div>
      </div>`;

    if (race.three_way) {
      body += `<div class="dt-cond">Three-way: D <b>${fmtPct(race.win_prob)}</b> \u00b7 R `
        + `<b>${fmtPct(Math.max(0, 1 - race.win_prob - pI))}</b> \u00b7 ${indName} <b>${fmtPct(pI)}</b>. `
        + `Polled at ${race.ind_share.toFixed(0)}% in the questions that include them, and `
        + `simulated as a third share.</div>`;
    }
    if (cond != null) {
      body += `<div class="dt-cond">Under the current pins (${condition.n.toLocaleString()} draws):
        ${dSide.tag} win <b>${fmtPct(cond)}</b>, against ${fmtPct(race.win_prob)} unconditional.</div>`;
    }

    // --- how mu was built ---
    const inc = race.inc_adj || 0;
    const elas = race.elasticity * env;
    body += `<h4>How the estimate was built</h4>`;
    // "District lean" was the label on all three chambers, including a statewide
    // Senate race that has no district.
    const lw = race.lean_weight ?? 1;
    body += row(`${race.chamber === 'house' ? 'District' : 'State'} lean, 2024 presidential`
                + (lw !== 1 ? ` × ${lw.toFixed(2)}` : ''),
                fmtMargin(race.lean * lw)
                + (lw !== 1 ? `<span class="dt-note">${fmtMargin(race.lean)} raw; governor races `
                  + `follow the state's presidential vote less than other offices</span>` : ''));
    body += row(`National swing × this seat's responsiveness (${race.elasticity.toFixed(2)})`,
                `${elas >= 0 ? '+' : ''}${elas.toFixed(2)}`);
    const incNote = incumbencyNote(race, inc);
    body += row('Incumbency',
                (inc ? `${inc >= 0 ? '+' : ''}${inc.toFixed(1)}` : '—')
                + (incNote ? `<span class="dt-note">${incNote}</span>` : ''));

    // FUNDRAISING WAS IN THE SUM AND NOT IN THE PANEL. Workstream J shipped on
    // 2026-09-02 and this walkthrough was written before it, so for the 129
    // races it touches the rows above added up to something other than the total
    // printed beneath them — NJ-05 showed three numbers summing to +10.18 above
    // a stated +16.59. A panel whose only job is to reproduce the arithmetic
    // cannot be missing a term of it.
    //
    // Shown only where it is non-zero, which is the honest rendering of a term
    // that is tapered away wherever the lean is already decisive: a row reading
    // "0.0" on four hundred safe seats would suggest the model looked at money
    // there and found none, when it did not look.
    // The governor's own previous margin, and the lean discount that comes with
    // having one. Zero for every other office, so shown only where it is not.
    const rec = race.record_adj || 0;
    if (Math.abs(rec) > 0.005) {
      body += row("Governor's own record",
                  `${rec >= 0 ? '+' : ''}${rec.toFixed(1)}`
                  + `<span class="dt-note">their last margin, and a smaller weight on lean once `
                  + `they have one</span>`);
    }
    const fund = race.fundraising_adj || 0;
    if (Math.abs(fund) > 0.005) {
      body += row('Fundraising',
                  `${fund >= 0 ? '+' : ''}${fund.toFixed(2)}`
                  + `<span class="dt-note">applied only where the lean is not already decisive, `
                  + `and measured as a share of this cycle rather than in dollars. Filings run to `
                  + `June; the fit is on full-cycle ones</span>`);
    }
    body += row('Estimate before polls', fmtMargin(race.prior_mu), 'dt-sum');

    if (race.n_polls > 0) {
      body += row('Poll average', fmtMargin(race.poll_margin) +
        `<span class="dt-note">${race.n_polls} poll${race.n_polls > 1 ? 's' : ''} → effective ` +
        `n = ${race.effective_n.toFixed(1)} after weighting, across ` +
        `${race.effective_pollsters.toFixed(1)} pollsters</span>`);
      if (race.house_adj) {
        body += row('Pollster-lean correction', `${race.house_adj >= 0 ? '+' : ''}${race.house_adj.toFixed(2)}` +
          `<span class="dt-note">${fmtPct(race.pollster_coverage, 0)} of the weight comes from pollsters with enough past results to correct</span>`);
      }
      body += row(`Weight on the polls, n/(n+3)`, race.poll_weight.toFixed(3));
      body += row('Blended estimate', fmtMargin(race.mu), 'dt-sum');
    } else {
      body += row('Polls', '—<span class="dt-note">none usable, so the estimate above stands</span>');
      body += row('Estimate', fmtMargin(race.mu), 'dt-sum');
    }

    // --- sigma ---
    body += `<h4>Where the uncertainty comes from</h4>`;
    body += row('National', sig.nat.toFixed(2) + '<span class="dt-note">shared by every race</span>');
    body += row('Regional', sig.reg.toFixed(2) + `<span class="dt-note">shared across the ${race.region}</span>`);
    body += row('State', sig.state.toFixed(2) + `<span class="dt-note">shared across ${race.state}</span>`);
    body += row('Race-specific', race.sigma_idio.toFixed(2) +
      (race.prior_stale ? `<span class="dt-note">widened ×${
        forecast.calibration.prior.stale_multiplier.toFixed(2)} — prior joined across a redraw</span>` : ''));
    body += row('Total uncertainty', `±${race.sigma_total.toFixed(2)}`, 'dt-sum');
    // Filled after innerHTML; see below. The four rows above are the numbers and
    // this is their shape.
    body += '<div class="dt-var"></div>';

    const q = race.quantiles;
    if (q) {
      body += `<h4>Simulated margin</h4>`;
      body += row('80% interval', `${fmtMargin(q['10'])} to ${fmtMargin(q['90'])}`);
      body += row('90% interval', `${fmtMargin(q['5'])} to ${fmtMargin(q['95'])}`);
    }
  }

  const flags = [
    race.prior_stale && 'prior from a superseded map',
    race.system_handling === 'unresolved' && 'November ballot not established',
    race.electoral_system !== 'standard' && `${race.electoral_system.replace('_', '-')} (${race.system_handling})`,
  ].filter(Boolean);
  if (flags.length) body += `<div class="dt-flags">${flags.join(' · ')}</div>`;

  box.innerHTML = body;

  // ---- the chart, mounted above the arithmetic -----------------------------
  // Placed after `body` is written and before the pin control, so it sits at the
  // top of the drawer where a reader looks first, and so the panel is already
  // complete and correct if the fetch never returns. The arithmetic below it is
  // the authority; this is the same numbers with their working shown.
  //
  // `race.race_id` is captured and re-checked when the fetch lands, because a
  // reader can open a second race inside the round trip and the answer to the
  // first would otherwise be drawn into the second one's drawer.
  const wanted = race.race_id;
  const chartHost = document.createElement('div');
  chartHost.className = 'dt-chart';
  chartHost.innerHTML = '<div class="dt-chart-wait">loading this race\u2019s polling\u2026</div>';
  // Before the first arithmetic row, which puts it under the heading and the
  // ballot and above the working.
  box.insertBefore(chartHost, box.querySelector('.dt-row'));

  loadRaceDetail().then(detail => {
    if (!detail || host.dataset.race !== wanted) return;
    const polls = (detail.polls || {})[wanted] || [];
    // The payload stores history as parallel arrays against one shared run list,
    // because the date, the join and whether a run is a reconstruction belong to
    // the run and repeating them inside all 506 races cost 150 KB gzipped. It is
    // widened back into rows here, once, where the chart wants them.
    const runs = detail.runs || [];
    const arr = (detail.history || {})[wanted];
    const series = !arr ? [] : runs.map((r, i) => ({
      a: r.a, j: r.j, r: r.r,
      mu: arr.mu[i], s: arr.s[i], w: arr.w[i], n: arr.n[i],
    })).filter(pt => pt.mu != null);
    chartHost.replaceChildren();
    if (!polls.length && series.length < 2) {
      chartHost.innerHTML = '<p class="dt-note-block">No polling of this race, and only one run '
        + 'to compare against, so there is nothing yet to plot. The estimate below is the '
        + 'seat\u2019s own history plus the national environment \u2014 what the model runs on '
        + 'where a race is unpolled.</p>';
      return;
    }
    const ind = (detail.independent || {})[wanted] || null;
    const past = (detail.past || {})[wanted] || null;

    // PRICED IS READ ONCE, HERE. The heading, the diamond tooltips, the caption
    // and the weight table all turn on it, and while the caption computed it and
    // the heading did not, a seat priced entirely from this polling was titled
    // "why none of it counts" directly above a caption saying the forecast prices
    // it from that polling. Both sentences shipped, on the race carrying the
    // largest single assumption on the site.
    const priced = Math.abs(race.independent_adj || 0) > 0;
    const h = document.createElement('h4');
    h.className = 'dt-h';
    h.textContent = polls.length ? 'The polling, and what the model made of it'
                 : ind && priced ? 'The polling this seat is priced from'
                 : ind ? 'What has been polled here, and why none of it counts'
                 : 'What the model has said about this race';
    chartHost.append(h);
    let full = false;
    const plot = document.createElement('div');
    chartHost.append(plot);
    const draw = () => {
      plot.replaceChildren();
      const r = raceTrend(plot, { polls, history: series, independent: ind, race,
                                  sigma: race.sigma_total, priced,
                                  asof: forecast.meta.asof, full });
      return r || {};
    };
    let meta = draw();
    // THE CAPTION WAS ONE 937-CHARACTER PARAGRAPH under a chart, which is the
    // shape of text people skip. The same sentences as short labelled lines:
    // each answers one question about one thing on the chart, and a reader
    // looking for what a hollow dot means can find it without reading the rest.
    const cap = document.createElement('dl');
    cap.className = 'dt-key';
    const nLive = polls.filter(x => !/[so]/.test(x.x || '')).length;
    const nOld = polls.length - nLive;
    const item = (k, v) => {
      cap.append(Object.assign(document.createElement('dt'), { textContent: k }),
                 Object.assign(document.createElement('dd'), { innerHTML: v }));
    };
    if (polls.length) {
      item('Each dot', 'A poll, at the day its fieldwork ended. Area is weight: age, a partisan '
        + 'sponsor and a campaign internal each reduce it.');
    }
    if (ind) {
      item('Amber diamonds', `Polls of <b>${ind.name}</b> against the one major-party nominee`
        + (priced ? ', which is what this seat is priced from.'
                  : ' \u2014 shown, not used.'));
    }
    if (nOld) {
      const nOmit = polls.filter(x => (x.x || '').includes('o')).length;
      item('Hollow dots', `<b>${nOld}</b> not counted: `
        + [nOld - nOmit && `${nOld - nOmit} of a matchup no longer on the ballot`,
           nOmit && `${nOmit} head-to-head${nOmit === 1 ? '' : 's'} leaving out the third candidate`]
          .filter(Boolean).join('; ') + '.');
    }
    if (series.length) {
      const recon = series.filter(pt => pt.r).length;
      item('The line', 'The model’s estimate at each run.'
        + (recon ? ' The faint dashed part is a <b>reconstruction</b> — today’s model asked what '
                 + 'it makes of the polling that existed then. It is not a record of what was '
                 + 'forecast at the time.' : ''));
    }
    item('The fan', 'Where the result is expected to land on election day: the inner band about '
      + 'two thirds of the time, the outer about 19 times in 20.');
    chartHost.append(cap);

    // The range control sits with the chart it changes.
    const bar = document.createElement('div');
    bar.className = 'dt-range';
    const note = document.createElement('span');
    const btn = document.createElement('button');
    btn.className = 'chip';
    const sync = () => {
      note.textContent = full
        ? 'Showing every poll on record.'
        : `Showing the last ${meta.windowDays || 92} days`
          + (meta.hidden ? `; ${meta.hidden} earlier poll${meta.hidden === 1 ? '' : 's'} not shown.` : '.');
      btn.textContent = full ? 'Last 3 months' : 'Full record';
      btn.hidden = !full && !meta.hidden;
    };
    btn.onclick = () => { full = !full; meta = draw(); sync(); };
    sync();
    bar.append(note, btn);
    chartHost.append(bar);

    // An independent's polling needs a sentence, not just a colour. It is the
    // only series on this page the forecast does not consume.
    if (ind) {
      // A div, not a p: this caption carries a <ul>, which a parser closes a
      // paragraph to escape.
      const n = document.createElement('div');
      n.className = 'dt-chart-cap dt-cap-warn';
      // No caucus claim. The ballot feed's said all of these independents would sit
      // with Democrats and the candidates who matter have said otherwise; the
      // forecast counts their win for neither party, and says only that.
      n.innerHTML = `The amber diamonds are <b>${ind.name}</b>, running as an independent. `
        + `A win would count for neither party. `
        + (ind.avg != null
            ? `Their polling averages <b>${slotMargin(race, ind.avg)}</b>`
              + (ind.spread != null ? ` across a ${ind.spread.toFixed(0)}-point spread` : '') + '. '
            : '')
        + (priced
            // Priced: engine/estimate/independents.py takes their polling as the
            // estimate, given enough of it, and widens it by how far comparable
            // independent candidacies have landed from their polls.
            ? `<b>The forecast prices this seat from that polling</b>, and widens it by how far `
              + `past independent candidacies have landed from their polls.`
            : `<b>The forecast does not use them</b>, for three reasons:`
              + `<ul class="pts">`
              + `<li>There is not enough of it: fewer than three polls, or one effective poll.</li>`
              + `<li>The error curve is fitted on Democrat-versus-Republican contests.</li>`
              + `<li>The prior describes a Democrat who is not on this ballot.</li>`
              + `</ul>`
              + `So the line and the fan above show a two-major-party contest, which is not the `
              + `contest on the ballot here.`);
      chartHost.append(n);

      // WHO POLLED IT, for a priced seat. These races carry none of the ordinary
      // `poll_weight` machinery -- n_polls is 0, effective_n is 0 -- so this
      // panel showed no weights at all while a 19-point move rested on two polls.
      // Same table as every other race, because the weights are now built the
      // same way; `h` is the house effect under the name the table reads.
      if (priced && ind.polls && ind.polls.length) {
        const th = document.createElement('h4');
        th.className = 'dt-h'; th.textContent = 'Who polled it';
        chartHost.append(th);
        pollsterTable(chartHost, { polls: ind.polls.map(x => ({ ...x, h: x.he })) });
        const d = ind.diag || {};
        const dc = document.createElement('p');
        dc.className = 'dt-chart-cap';
        // THE NUMBER THE TABLE IS FOR. A reader who sees two shops at 45% each
        // should be told what that means for how well the average is measured,
        // because for these races nothing else on the page says it.
        dc.innerHTML = (d.eff_n != null
            ? `Those weights come to <b>${d.eff_n.toFixed(1)} effective polls</b>`
              + (d.se != null ? `, and the average carries a standard error of `
                              + `<b>${d.se.toFixed(1)} points</b> on that basis` : '') + '. '
            : '')
          + `Recency, a partisan sponsor and the pollster\u2019s rating set the weight, as they `
          + `do for any other race, and a survey asked two ways counts once. `
          // THE DISCOUNT IS RELATIVE. Weights are normalised, so where every poll
          // has a sponsor the down-weighting cancels; South Dakota and Idaho are
          // all sponsored, and saying "down-weighted" there without this would
          // claim a correction the estimate does not get.
          + (ind.polls.every(x => (x.x || '').includes('p'))
              ? `<b>Every poll here has a partisan sponsor</b>, so down-weighting them changes `
                + `nothing: the average is the sponsors\u2019 average. `
              : '')
          + (d.house_adj != null && Math.abs(d.house_adj) >= 0.05
              ? `House effects shift the average by ${fmtMargin(-d.house_adj)}. ` : '')
          + `What they cannot correct for is an independent candidacy itself, which is what the `
          + `extra spread on this seat is for.`;
        chartHost.append(dc);
      }
    }

    // The seat's own record, which the prior encodes and never displays.
    if (past && past.length > 1) {
      const ph = document.createElement('h4');
      ph.className = 'dt-h'; ph.textContent = 'What this seat has actually done';
      chartHost.append(ph);
      seatHistory(chartHost, { past, race });
      const pc = document.createElement('p');
      pc.className = 'dt-chart-cap';
      pc.innerHTML = 'Each election on its own, never joined into a line: after redistricting a '
        + '2018 district and a 2026 district can share a name without sharing much territory. '
        + 'Hollow marks are uncontested, with no two-party margin to compare against.';
      chartHost.append(pc);
    }

    // Who did the polling, since `effective pollsters` names nobody.
    if (polls.some(x => !/[so]/.test(x.x || ''))) {
      const th = document.createElement('h4');
      th.className = 'dt-h'; th.textContent = 'Who polled it';
      chartHost.append(th);
      pollsterTable(chartHost, { polls });
    }
  });

  const varHost = box.querySelector('.dt-var');
  if (varHost && race.sigma_total) {
    varianceBar(varHost, { sigma: sig, race });
  }

  conditionalReadout(box, { race, sims, forecast, rule });

  if (sims.col.has(race.race_id)) {
    const b = document.createElement('button');
    b.className = 'chip dt-pin';
    const pinned = condition.pins?.find(p => p.race_id === race.race_id);
    b.textContent = pinned ? `Pinned ${pinned.party} — click to change` : 'Hold this race fixed';
    b.onclick = () => onPin(race);
    box.append(b);
  } else {
    const p = document.createElement('p');
    p.className = 'dt-note-block';
    p.textContent = `This race has the same winner in all ` +
                    `${sims.m.n_sims.toLocaleString()} simulations, so it is not in the ` +
                    `conditioning payload and cannot be pinned.`;
    box.append(p);
  }

  host.append(grow, close, box);
}
