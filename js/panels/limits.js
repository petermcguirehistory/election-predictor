import { term } from '../glossary.js';
// What could be wrong.
//
// Two different things are collapsed together on most forecast sites and are
// kept apart here. The engine's own freshness ALARMS are computed each run and
// change as the data changes. The KNOWN LIMITATIONS are structural, established
// during the build, and will not clear on their own -- they clear when someone
// acquires data or changes the model.
//
// Both are on the page rather than behind a methodology link, because a reader
// who does not scroll to the methodology is exactly the reader who most needs
// to know how old the generic ballot is.
// A fact table, for the numbers that were being carried in sentences.
//
// "the data said 1.465 against the assumed 1.625, across 97 races and three
// cycles" is four figures and their relationships encoded as English, which a
// reader has to parse back into a table before it means anything. So it is a
// table. The prose above it then only has to say what the table is for.
const facts = rows => '<table class="fx"><tbody>'
  + rows.filter(Boolean).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')
  + '</tbody></table>';

// And a list, for claims that are not key/value pairs. Same argument: a paragraph
// carrying four separate facts has to be read in full before any one of them can
// be found.
const pts = items => `<ul class="pts">`
  + items.filter(Boolean).map(x => `<li>${x}</li>`).join('')
  + `</ul>`;

const ALARM = {
  generic_ballot_stale: d => ({
    title: `The generic ballot is ${d} days stale`,
    body: `National polling is the input this forecast leans on hardest, and the latest reading
           describes opinion as it was ${d} days ago. Two separate defects, both priced:`
      + pts([
          `<b>Lean</b> — the generic ballot has historically flattered Democrats. Subtracted before
           use.`,
          `<b>Age</b> — widens the error on every race at the measured drift rate,
           <code>0.32 &times; √days</code>. A reading four times older is twice as uncertain.`,
        ]),
  }),
  generic_ballot_beyond_corpus_support: d => ({
    title: `The generic ballot is ${d} days old — older than anything that could be checked`,
    body: `The widening above is <em>derived</em> from the drift rate, not fitted to how wrong
           stale readings have actually been, because there is no case to fit to.`
      + facts([
          ['Where the archive stops', '60 days before every election.'],
          ['Inside that window', 'The newest reading is never more than about a week old.'],
          ['Beyond it', `An extrapolation, and named as one. Probably cautious — opinion drifts
            less with no campaign running — but still an extrapolation.`],
        ]),
  }),
  stale_priors: (n, f) => ({
    title: `${n} districts carry priors from superseded maps`,
    body: `These districts are estimated from presidential results counted under lines they will
           not be contested on, so the district number points at a different set of voters.`
      + facts([
          ['Priced', `Error bars widened
            &times;${f.calibration.prior.stale_multiplier.toFixed(2)}, measured by replaying 2022
            with exactly this mistake introduced.`],
          ['Not priced', 'The central estimates. Those are still built on the wrong electorate.'],
          ['Status', `<em>Not currently firing</em> — every district is on its own 2026 lines. The
            machinery stays wired up for the next redraw that outruns the data.`],
        ]),
  }),
  unresolved_polls: n => ({
    title: `${n} polls could not be resolved to a two-party margin`,
    body: `A poll is usable once both names in it match a candidate in the race. These did not.`
      + facts([
          ['Not a candidate', 'A primary since lost, or a name speculated about that never filed.'],
          ['Three or more names', 'No single two-party margin to extract.'],
          ['No names supplied', 'The feed gave percentages without candidates.'],
          ['Same-party general', 'Both finalists share a party.'],
          ['No major-party opponent', 'One party has nobody on that ballot.'],
        ])
      + `<p>None of these is a race going unpolled. Each is a poll of something else.</p>`,
  }),
  thin_poll_average: (n, f) => {
    // Which races these are matters more than how many. Computed here rather
    // than written down, because the answer changes every run: the alarm counted
    // 69 on the run this sentence was written for, and the decisive ones were the
    // thin ones.
    // From the payload, not a second copy of the constant: this filter has to
    // select exactly the races the alarm counted, or the sentence reports a
    // different total from the number beside it.
    const thin = (f.coverage && f.coverage.min_effective_n) || 1.5;
    const races = (f.races || []).filter(r =>
      r.effective_n > 0.01 && r.effective_n <= thin);
    const live = races.filter(r => r.win_prob > 0.05 && r.win_prob < 0.95);
    // `tipping` is keyed by chamber and each chamber holds a `distribution`, not
    // a bare array. Flattened across chambers because this note is about the
    // whole board: the Senate's decisive seats are as much the point as the
    // House's.
    const share = new Map(Object.values(f.tipping || {})
      .flatMap(c => (c && c.distribution) || [])
      .map(t => [t.race_id, t.share]));
    const top = live.filter(r => share.has(r.race_id))
                    .sort((a, b) => share.get(b.race_id) - share.get(a.race_id))
                    .slice(0, 3);
    return {
      title: `${n} races rest on roughly one poll`,
      body: `Each of these carries an ${term('effective-n')} below `
        + `${thin.toFixed(1)} — so one new poll moves it noticeably.`
        + facts([
            ['How it is handled', `The ${term('poll-weight')} holds a single poll to about a `
              + `quarter, with the seat's ${term('prior')} carrying the rest, and the `
              + `${term('sigma')} is widened.`],
            ['Still competitive', `<b>${live.length}</b> of ${n}`],
            top.length && ['Among the decisive', `${top.map(r => `<b>${r.race_id}</b>`).join(', ')} `
              + `— some of the races most often the ${term('tipping-point')}`],
          ]),
    };
  },
  third_party_share: (n, f) => ({
    title: `${n} polled race${n === '1' ? '' : 's'} where a third candidate takes a large share`,
    body: `Every race is decided on the D-versus-R margin. In these a sizeable share of the
           polling goes to neither, so that margin remains the best estimate available while no
           longer describing the whole contest: ${(f.freshness.third_party_races || [])
             .map(r => `<b>${r.race_id}</b> ${r.third_pct.toFixed(0)}%`).join(', ')}.`,
  }),
  cross_feed_duplicate: n => ({
    title: `${n} polls share a race and fieldwork date with a poll from the other feed`,
    body: `Two feeds supply race polls and spell pollsters differently.`
      + facts([
          ['Merged automatically', `Same race, margin and sample size — on the same day, or up to
            a few weeks apart where one pollster name contains the other. The poll settles the
            question itself.`],
          ['These rows', `Same race and day, and one more thing in common — margin, sample size or
            a related name — but not all of them.`],
          ['What they could be', `One survey reported in two versions (likely voters and
            registered voters, say), or two polls that happen to share a detail.`],
          ['Not listed', `Same-day pairs from unrelated pollsters with a different margin
            <em>and</em> sample size. Nothing besides the date suggests one poll, so they count as
            two.`],
          ['Resolution', 'Both copies kept, and named rather than guessed at.'],
        ]),
  }),
  incumbency_feed_uncovered: n => ({
    title: `${n} federal race${n === '1' ? '' : 's'} with no ballot-feed answer on whether the `
      + `incumbent is running`,
    body: `The federal filing record says who <em>holds</em> a seat, not whether they are running
           for it — a retiring member still files. Only the ballot feed answers that.`
      + facts([
          ['House fallback', 'FEC filings — the reading that credits a retiring member.'],
          ['Senate fallback', 'No incumbency adjustment.'],
          ['At stake', 'The 2.5-point incumbency adjustment in each race named.'],
        ]),
  }),
  independent_priced: (n, f) => {
    const nb = (f.topline.senate && f.topline.senate.no_democrat_bound) || {};
    const priced = nb.priced || [];
    return {
      title: `${n} race${n === '1' ? '' : 's'} priced from polls of the independent rather `
        + `than the D-vs-R prior`,
      body: `${priced.map(r => `<b>${r}</b>`).join(' and ')}: one major party has no candidate, and
             the independent's polling agrees with itself closely enough to use.`
        + facts([
            ['Estimate', 'The polling average, in place of the prior for a candidate not running.'],
            ['Uncertainty', `Widened by the spread of past independent candidacies around their
              polls — seven since 1998. Too few to correct the mean, enough to size the error.`],
            ['Qualifies', `3+ polls, all within 10 points of each other, and an independent who
              says they would caucus with the Democrats.`],
          ]),
    };
  },
  governor_zero_poll_coverage: () => ({
    title: 'Governor races have no usable polls',
    body: `No governor poll could be matched to a two-party matchup this run.`
      + facts([
          ['Usual cause', `Candidate resolution. The FEC is a federal agency and holds no roster of
            state candidates, so a poll naming two people cannot be looked up there.`],
          ['Normal path', 'The race feed, which carries governor candidates by name.'],
          ['If it has stopped', `Every governor race runs on its prior alone, and the seat counts
            on this page should be read that way.`],
          ['Status', '<em>Not currently firing.</em>'],
        ]),
  }),
};

// A function of the forecast, not a const: two of these entries quote numbers the
// payload ships and the topline card already renders live. Left as literals they
// would silently contradict the card the first time a calibration is re-run —
// which is the exact defect `pres_source_integrity` was written to catch, one
// layer up.
const STRUCTURAL = (f) => [
  { title: 'A district may ignore the national swing, but is never allowed to move against it',
    body: `Elasticity lets some districts respond more to a national swing than others, which is
           why a competitive seat moves further than a safe one.`
      + facts([
          ['Free fit', `Sends 4–6 of the most lopsided districts the <em>opposite</em> way to the
            country, and scores <em>better</em> on held-out error doing it: those seats are never
            in doubt, so a wrong answer in them barely registers.`],
          ['The cap', `Elasticity is capped at the point where the least responsive district still
            moves <em>with</em> the country.`],
          ['Cost', 'Accuracy on paper. Kept anyway, and re-checked on every run.'],
        ]) },
  ((pa, gov) => ({
    title: 'The governor error bar was assumed, never measured',
    body: `Every other uncertainty here was fitted to past results. This one is the House figure `
      + `multiplied by <b>${pa.bound ? pa.bound.shipped_ratio : '—'}</b>.`
      + facts([
          ['Senate, assumed', '1.625'],
          ['Senate, measured', '1.465 — 97 races, 3 cycles. Close enough to keep the assumption.'],
          ['Governors, assumed', `${pa.bound ? pa.bound.shipped_ratio : '—'}`],
          ['Governors, measured', 'No usable returns. The standard tidy series covers President, '
            + 'Senate and House only, and has no 2022 state file.'],
        ])
      + (pa.bound ? `<p>Unfitted, so the model prices being wrong about it instead. Re-run at `
          + `every ratio from <b>${(+pa.bound.range[0]).toFixed(2)}</b> to `
          + `<b>${(+pa.bound.range[1]).toFixed(2)}</b> — the spread the Senate figure showed across `
          + `its own three cycles:</p>`
          + facts([
              ['Median', `${pa.bound.median_values.join(' / ')} governorships at every point in that range`],
              ['Expected count', `moves ${pa.bound.expected_span} of a seat`],
            ])
          + `<p>Most of the ${gov.of} governor races have polls, so this number only governs the `
          + `handful that do not, and those are not close.</p>` : ''),
  }))(f.topline.governor.prior_asserted, f.topline.governor),
  { title: 'Governors have no control probability, by construction',
    body: `${f.topline.governor.of} governorships confer no collective majority, so there is no
           threshold to clear. A property of the office, not a gap in the model.`
      + facts([
          ['What is reported', 'How many are won, and the 80% range around it.'],
          ['What the payload ships', '<code>control_prob: null</code>, not a number with nothing '
            + 'behind it.'],
        ]) },
  { title: 'Only three past elections have been replayed',
    body: `2018, 2020 and 2022 — every cycle for which the model can assemble the inputs it needs.`
      + facts([
          ['What three supports', 'That the machinery runs end to end and produces sane intervals.'],
          ['What it does not', 'Any precise claim about how many seats the model typically misses by.'],
          ['And one of the three', '2020 is a presidential year, used to check a midterm model.'],
        ]) },
  { title: 'Polls are less accurate in lopsided races, and the model does not price that',
    body: `Measured across the archive of past polling:`
      + facts([
          ['Races inside 5 points', 'Polls miss the eventual margin by about <b>6.8</b> points.'],
          ['Races at 20–40 points', 'About <b>11.6</b>.'],
          ['What the model does', `Uses one error curve regardless, so it is slightly too confident
            about the races that look safest.`],
          ['Why it is deferred', `Building it in widens the safe races and leaves the close ones —
            the ones that decide control — almost unchanged.`],
        ]) },
  ((n) => ({
    title: `Two sources disagree about who is defending ${n} seat${n === 1 ? '' : 's'}`,
    body: `Whether an incumbent is on the ballot is worth <b>2.5 points</b> here, and no single
           source settles it.`
      + facts([
          ['FEC filings', `Say who <em>holds</em> a seat. A retiring member still files as the
            incumbent, so this cannot answer the question alone.`],
          ['Race feed', 'Has a column that does. The model follows that column.'],
          ['Disagreements', `<b>${n}</b> race${n === 1 ? '' : 's'}: the feed records a seat as
            incumbent-defended where no candidate on the ballot has filed as its incumbent, or the
            reverse.`],
          ['Resolution', `Reported, not resolved. Each of those races says so in its own panel and
            names who holds the seat. Picking a winner between the sources would hide that one of
            them is wrong.`],
        ]),
  }))(f.races.filter(r => r.chamber !== 'governor' && Array.isArray(r.ballot)
        && ((r.incumbent_running === 'incumbent') !== r.ballot.some(c => c.incumbent))).length),
];

export function limitsPanel(host, { forecast }) {
  host.replaceChildren();
  const make = (items, kind) => {
    const list = document.createElement('div');
    list.className = 'limits';
    for (const it of items) {
      const d = document.createElement('details');
      d.className = `limit ${kind}`;
      const sum = document.createElement('summary');
      sum.textContent = it.title;
      // A DIV, not a p. These bodies carry fact tables and lists, and a <table>
      // or <ul> inside a <p> is closed out of it by the parser -- which strands
      // the table outside the padding the panel sets on its body.
      const body = document.createElement('div');
      body.className = 'limit-body';
      body.innerHTML = it.body;
      d.append(sum, body);
      list.append(d);
    }
    return list;
  };

  const alarms = [];
  for (const a of forecast.freshness.alarms) {
    // Rendered from forecast.redraw_ratchet after this loop, because the states it
    // concerns are data in the payload and were only ever recoverable from the
    // alarm name by giving the alarm grammar a per-renderer exception.
    if (a.startsWith('redraw_reverted_')) continue;
    const m = a.match(/^(.*?)_(\d+)d?$/);
    const fn = ALARM[m ? m[1] : a];
    if (fn) alarms.push(fn(m ? m[2] : null, forecast));
  }
  const rr = forecast.redraw_ratchet;
  if (rr && (rr.reverted || []).length) {
    // Only claims that are true of ANY reverted state. The measurements that made
    // Missouri's case — how close to the baseline, what the hold was worth, the
    // second defect in the same export — are that incident's, not this template's,
    // and asserting them about the next state to revert would be fabrication.
    const held = new Set(rr.held || []);
    const h = rr.reverted.filter(x => held.has(x)), u = rr.reverted.filter(x => !held.has(x));
    alarms.push({
      title: `${rr.reverted.join(', ')}: the presidential source has dropped a redraw`,
      body: `The source has previously shown ${rr.reverted.join(', ')} on 2026 lines, and this
             export puts ${rr.reverted.length > 1 ? 'them' : 'it'} back in agreement with the
             118th-Congress baseline. Districts do not un-redraw mid-cycle, so a redraw
             disappearing is read as the source losing information, not as news about the map. ` +
            (h.length ? `<b>${h.join(', ')}</b> ${h.length > 1 ? 'are' : 'is'} held at the last
             export that showed the redraw, so those priors are that snapshot rather than this
             week's. ` : '') +
            (u.length ? `<b>${u.join(', ')}</b> ${u.length > 1 ? 'have' : 'has'} no stored
             snapshot, so this week's numbers stand and those priors are on 2024 lines. ` : '') +
            `A hold releases itself the moment the source publishes the redraw again.`,
    });
  }
  for (const r of forecast.electoral_systems.unresolved) {
    alarms.push({
      title: `${r}: the November ballot is not established`,
      body: `The second top-two slot was contested between a Democrat and an Independent. If the
             Independent advanced, there is no Democrat on the ballot and a D-vs-R margin is the
             wrong quantity. Forecast anyway, and named in every run rather than assumed away.`,
    });
  }

  const h1 = document.createElement('h3');
  h1.textContent = 'Live alarms — computed this run';
  const h2 = document.createElement('h3');
  h2.textContent = 'Structural limits — these do not clear on their own';
  host.append(h1, make(alarms, 'alarm'), h2, make(STRUCTURAL(forecast), 'structural'));
}
