// How this particular race got its number.
//
// The arithmetic is reproduced from the payload's own columns, and it agrees
// with the engine exactly: prior_mu = lean + elasticity x environment + inc_adj,
// and poll_weight = eff_n / (eff_n + 3), both to 0.0.
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

export function raceDetail(host, { race, forecast, sims, condition, onPin, onClose }) {
  host.replaceChildren();
  if (!race) { host.hidden = true; host.dataset.race = ''; return; }
  host.hidden = false;
  host.dataset.race = race.race_id;

  const env = forecast.environment.margin;
  const sig = forecast.sigma;
  const box = document.createElement('div');
  box.className = 'drawer-inner';

  const close = document.createElement('button');
  close.className = 'drawer-close'; close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.onclick = onClose;

  const cond = condition.pinned && condition.ok ? sims.winProb(race.race_id, condition.idx) : null;

  let body = `<h3>${race.race_id} <span class="dt-state">${race.state} · ${race.chamber}</span></h3>`;
  body += ballotBlock(race);

  if (race.locked) {
    body += `<p class="dt-lead">Settled — a same-party general under top-two. Both candidates on
      the November ballot are ${race.locked_party === 'D' ? 'Democrats' : 'Republicans'}, so the
      seat is decided and the model does not forecast it. It is carried as a certain
      ${race.locked_party} hold.</p>`;
    body += row('2024 presidential margin', fmtMargin(race.pres_margin));
    body += row('District lean', fmtMargin(race.lean));
    body += row('Estimate it would otherwise carry', fmtMargin(race.prior_mu));
  } else {
    body += `<div class="dt-head">
        <div><span class="dt-big" style="color:${race.win_prob >= 0.5 ? C.dem : C.rep}">
          ${fmtPct(race.win_prob >= 0.5 ? race.win_prob : 1 - race.win_prob)}</span>
          <span class="dt-sub">${race.win_prob >= 0.5 ? 'D' : 'R'} favoured</span></div>
        <div><span class="dt-big">${fmtMargin(race.median_margin)}</span>
          <span class="dt-sub">median margin</span></div>
      </div>`;

    if (cond != null) {
      body += `<div class="dt-cond">Under the current pins (${condition.n.toLocaleString()} draws):
        D win <b>${fmtPct(cond)}</b>, against ${fmtPct(race.win_prob)} unconditional.</div>`;
    }

    // --- how mu was built ---
    const inc = race.inc_adj || 0;
    const elas = race.elasticity * env;
    body += `<h4>How the estimate was built</h4>`;
    // "District lean" was the label on all three chambers, including a statewide
    // Senate race that has no district.
    body += row(`${race.chamber === 'house' ? 'District' : 'State'} lean, 2024 presidential`,
                fmtMargin(race.lean));
    body += row(`National swing × this seat's responsiveness (${race.elasticity.toFixed(2)})`,
                `${elas >= 0 ? '+' : ''}${elas.toFixed(2)}`);
    const incNote = incumbencyNote(race, inc);
    body += row('Incumbency',
                (inc ? `${inc >= 0 ? '+' : ''}${inc.toFixed(1)}` : '—')
                + (incNote ? `<span class="dt-note">${incNote}</span>` : ''));
    body += row('Estimate before polls', fmtMargin(race.prior_mu), 'dt-sum');

    if (race.n_polls > 0) {
      body += row('Poll average', fmtMargin(race.poll_margin) +
        `<span class="dt-note">${race.n_polls} poll${race.n_polls > 1 ? 's' : ''}, worth about ` +
        `${race.effective_n.toFixed(1)} independent reading${race.effective_n < 1.5 ? '' : 's'} ` +
        `after weighting, across ${race.effective_pollsters.toFixed(1)} pollsters</span>`);
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
    const series = (detail.history || {})[wanted] || [];
    chartHost.replaceChildren();
    if (!polls.length && series.length < 2) {
      chartHost.innerHTML = '<p class="dt-note-block">No polling of this race, and only one '
        + 'run to compare against \u2014 there is nothing yet to plot. The estimate below is the '
        + 'seat\u2019s own history and the national environment, which is what the model uses '
        + 'when nobody has polled a race.</p>';
      return;
    }
    const h = document.createElement('h4');
    h.className = 'dt-h';
    h.textContent = polls.length ? 'The polling, and what the model made of it'
                                 : 'What the model has said about this race';
    chartHost.append(h);
    raceTrend(chartHost, { polls, history: series, race, sigma: race.sigma_total });
    const cap = document.createElement('p');
    cap.className = 'dt-chart-cap';
    const nLive = polls.filter(x => !(x.x || '').includes('s')).length;
    const nOld = polls.length - nLive;
    cap.innerHTML =
      (polls.length
        ? `Each dot is a poll, placed at the day its fieldwork ended. Area is how much that poll `
          + `counts toward the average \u2014 older polls, partisan sponsors and campaign internals `
          + `all count for less. `
          + (nOld ? `<b>${nOld}</b> hollow dot${nOld === 1 ? '' : 's'} are of a matchup that is no `
                    + `longer on the ballot; they are shown because the field changed, and counted `
                    + `for nothing. ` : '')
        : '')
      + `The dark line is the model\u2019s estimate at each daily run. The shaded fan is where it `
      + `expects the result to land on election day \u2014 the inner band about two thirds of the `
      + `time, the outer about nineteen times in twenty.`;
    chartHost.append(cap);
  });

  const varHost = box.querySelector('.dt-var');
  if (varHost && race.sigma_total) {
    varianceBar(varHost, { sigma: sig, race });
  }

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
    p.textContent = 'This race has the same winner in all 20,000 simulations, so it is not in the ' +
                    'conditioning payload and cannot be pinned.';
    box.append(p);
  }

  host.append(close, box);
}
