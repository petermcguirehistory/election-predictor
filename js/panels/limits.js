import { term } from '../glossary.js';
import { alarmKind } from '../alarms.js';
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
        ]),
  }),
  ballot_poll_unresolved: n => ({
    title: `${n} poll${n === '1' ? '' : 's'} of the actual November matchup did not resolve`,
    body: `Each of these names both of the race's November nominees, and still could not be
           matched to a two-party margin — so it is left out of the average.`
      + facts([
          ['What it means', 'A fault in matching poll names to candidates, not a property of the '
            + 'poll.'],
          ['Past causes', pts([
            'An accented name split in two: <em>Luján</em> read as <em>LUJ</em>.',
            'A nominee missing from the federal filing roster because their filing status lagged '
              + 'the primary.',
          ])],
          ['Not counted here', `Polls of primary losers, hypothetical matchups and generic
            "Democrat v Republican" questions. Those are set aside correctly and are reported in
            the run log, not on this page.`],
        ]),
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
  third_party_share: (n, f) => {
    const rows = (f.freshness.third_party_races || []);
    return {
      title: `${n} polled race${n === '1' ? '' : 's'} where a third candidate takes a large share`,
      body: `Every race is decided on the D-versus-R margin. In these, a sizeable share of the
             polling goes to neither: ${rows.map(r => `<b>${r.race_id}</b> `
               + `${r.third_pct.toFixed(0)}%`).join(', ')}.`
        + (() => {
            // Which of them the model now simulates as three shares, from the races
            // themselves: a named candidate on the ballot polling 5%+ in the
            // questions that include them.
            const byId = new Map((f.races || []).map(r => [r.race_id, r]));
            const tw = rows.filter(r => byId.get(r.race_id)?.three_way);
            const not = rows.filter(r => !byId.get(r.race_id)?.three_way);
            return facts([
              tw.length && ['Simulated three-way', tw.map(r => `<b>${r.race_id}</b> `
                + `${r.on_ballot ? r.on_ballot.name : ''} wins `
                + `${((byId.get(r.race_id).ind_win_prob || 0) * 100).toFixed(1)}%`).join(', ')],
              tw.length && ['How', 'Head-to-head questions that leave them out are dropped; their '
                + 'share is drawn with the error measured on eight three-way Senate races, and '
                + 'the largest share wins.'],
              not.length && ['Still D minus R', `${not.map(r => `<b>${r.race_id}</b>`).join(', ')}: the `
                + 'other share is not a named candidate on the ballot, so no third outcome is drawn.'],
            ]);
          })(),
    };
  },
  cross_feed_duplicate: n => ({
    title: `${n} polls share a race and fieldwork date with a poll from the other feed`,
    body: `Two feeds supply race polls and spell pollsters differently.`
      + facts([
          ['Merged automatically', pts([
            'Same race, margin and sample size — on the same day, or within a few weeks where one '
              + 'pollster name contains the other.',
            'Same race, day and named matchup from a related pollster — one survey reported at two '
              + 'populations. The other feed\'s version is kept.',
          ])],
          ['These rows', `Same race and day, and one more thing in common — margin, sample size or
            a related name — but none of the rules above.`],
          ['What they could be', `One survey the rules could not identify, or two polls that
            happen to share a detail.`],
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
             the independent has been polled enough to price from.`
        + facts([
            ['Estimate', 'The polling average, in place of the prior for a candidate not running.'],
            ['Uncertainty', `Widened by the spread of past independent candidacies around their
              polls — seven since 1998. Too few to correct the mean, enough to size the error.`],
            ['Qualifies', '3+ polls, adding up to more than one effective poll. How closely '
              + 'they agree is not a test: across the six past races with a spread, it predicted nothing measurable.'],
            ['Sponsored polls', (() => {
              const t = (f.calibration && f.calibration.sponsor_bias || {}).tiers || {};
              return 'Corrected toward the sponsor\u2019s measured lean'
                + (t.with_lean != null ? ` \u2014 ${t.with_lean.toFixed(1)} pts for a shop whose lean `
                  + `is known, ${t.without_lean.toFixed(1)} for one with no record \u2014` : '')
                + ' so a race polled only by sponsors is not taken at their word.';
            })()],
            ['Counted as', 'Neither party\u2019s seat, when the independent wins. What they say '
              + 'they would caucus with is not used.'],
          ]),
    };
  },
  feed_stopped: (d, f, feed) => {
    const x = ((f.freshness && f.freshness.feeds) || {})[feed] || {};
    return {
      title: `${x.what || feed} has published nothing new for ${d} days`,
      body: 'Each feed is checked against its own publishing rhythm, fitted every run.'
        + facts([
            ['Supplies', x.used_for || '—'],
            ['Newest reading', x.newest || '—'],
            ['Effect', 'That input is carried forward from its last reading. The forecast is '
              + 'still produced; it is not produced from current information.'],
            ['Publishing', 'Stopped. This page is not republished while this fires unless '
              + 'someone overrides it.'],
          ]),
    };
  },
  feed_not_refetched: (d, f, feed) => {
    const x = ((f.freshness && f.freshness.feeds) || {})[feed] || {};
    return {
      title: `${x.what || feed} was last downloaded ${d} days ago`,
      body: 'A different fault from a feed going quiet: the source may be publishing, and this '
        + 'machine did not fetch it.'
        + facts([
            ['Supplies', x.used_for || '—'],
            ['Effect', `Everything from this feed is ${d} days behind.`],
          ]),
    };
  },
  house_zero_poll_coverage: () => ({
    title: 'House races have no usable polls',
    body: 'No House poll could be matched to a two-party matchup this run.'
      + facts([
          ['Effect', 'Every House race runs on its prior alone.'],
          ['Usual cause', 'Both race-poll feeds failing, or candidate matching failing wholesale.'],
        ]),
  }),
  senate_zero_poll_coverage: () => ({
    title: 'Senate races have no usable polls',
    body: 'No Senate poll could be matched to a two-party matchup this run.'
      + facts([
          ['Effect', 'Every Senate race runs on its prior alone.'],
          ['Usual cause', 'Both race-poll feeds failing, or candidate matching failing wholesale.'],
        ]),
  }),
  race_feed_union_empty: () => ({
    title: 'The second race-poll feed contributed nothing',
    body: 'Race polls come from two feeds, merged with duplicates removed. ElectIndex added no '
      + 'polls this run.'
      + facts([
          ['Possible causes', pts(['Its file is stale or empty.',
            'De-duplication matched every row against the other feed.'])],
          ['Effect', 'Races only it covers run on fewer polls, or on their prior.'],
        ]),
  }),
  ban_list_empty: () => ({
    title: 'The fabricated-data filter is empty',
    body: 'Polls from pollsters flagged for fabricating data are removed before anything else '
      + 'happens. The list of flagged pollsters came back with no entries.'
      + facts([
          ['Effect', 'Nothing was removed. Polls the filter would normally drop are in this '
            + 'forecast.'],
          ['Why an alarm', 'An empty list looks exactly like a clean feed from the outside.'],
        ]),
  }),
  banned_name_near_miss: n => ({
    title: `${n} pollster ${n === '1' ? 'name nearly matches' : 'names nearly match'} a flagged pollster`,
    body: 'The fabricated-data filter matches on names, and a respelled name slips past it.'
      + facts([
          ['These', 'Names close to a flagged pollster that the filter did not match.'],
          ['Effect', 'Their polls are in the forecast.'],
        ]),
  }),
  fundraising_absent: () => ({
    title: 'The fundraising term was not applied',
    body: 'The House prior adds a small adjustment for each side\'s share of fundraising, '
      + 'fitted on past cycles and strongest in districts the presidential lean calls close.'
      + facts([
          ['Effect', 'House priors rest on presidential lean, environment and incumbency alone.'],
          ['Usual cause', 'The filing data is missing or failed to load.'],
        ]),
  }),
  fundraising_share_level_out_of_range: () => ({
    title: "This cycle's fundraising level is outside the fitted cycles",
    body: 'The fundraising term is centred on each cycle\'s own average, so a level shift '
      + 'cancels out. A level this far outside the fitted cycles still says the data may be a '
      + 'different kind of thing.'
      + facts([
          ['Effect', 'The term is applied anyway.'],
        ]),
  }),
  prior_sigma_no_provenance: () => ({
    title: 'The prior error bar does not record what it was fitted against',
    body: 'The error bar on each race\'s prior is fitted, and the fit records the inputs it '
      + 'used so a later run can tell when they have changed.'
      + facts([
          ['Effect', 'Staleness in that fit cannot be detected.'],
        ]),
  }),
  prior_sigma_stale: n => ({
    title: `The prior error bar is stale against ${n} of its inputs`,
    body: 'The inputs it was fitted against have changed since, and nothing records the gap as '
      + 'known.'
      + facts([
          ['Effect', 'Prior-only races carry an error bar fitted on data that is no longer live.'],
          ['Fix', 'A refit.'],
        ]),
  }),
  prior_sigma_stale_acknowledgement: () => ({
    title: 'A deferred-refit note has outlived its reason',
    body: 'The prior error bar carries a note acknowledging it is stale, and it is no longer '
      + 'stale.'
      + facts([
          ['Effect', 'None on the numbers. The note would hide a future staleness.'],
        ]),
  }),
  independent_dispersion_unavailable: () => ({
    title: 'Independent-candidate races were not priced',
    body: 'Races with an independent and no candidate from one major party are priced from '
      + 'their own polling, with an error bar widened by how far past independents landed from '
      + 'their polls. That history could not be read this run.'
      + facts([
          ['Effect', 'Every such race keeps the D-vs-R prior.'],
        ]),
  }),
  independent_candidate_races: n => ({
    title: `${n} race${n === '1' ? '' : 's'} where an independent faces only one major party`,
    body: 'The model forecasts a Democratic slot against a Republican slot. Here one of those '
      + 'parties has nobody on the ballot.'
      + facts([
          ['Priced from polling', 'Where there are 3+ polls, adding up to more than one '
            + 'effective poll, the independent takes the missing party\'s slot.'],
          ['Otherwise', 'The race keeps its D-vs-R prior, which describes a candidate who is not '
            + 'running.'],
        ]),
  }),
  pres_source_margin_mismatch: n => ({
    title: `${n} district${n === '1' ? '' : 's'} where the presidential source contradicts itself`,
    body: 'Each row of the presidential-results source carries vote counts and the percentages '
      + 'computed from them. In these, the published margin does not match the counts.'
      + facts([
          ['Used', 'The margin derived from the counts.'],
          ['Effect', 'None, if the counts are right.'],
        ]),
  }),
  senate_no_democrat_seats: n => ({
    title: `${n} Senate seats have no Democrat on the ballot`,
    body: 'Each has a named independent against the Republican, and all of them have pledged to '
      + 'caucus with neither party. A win counts for neither party\u2019s seats; what it does to '
      + 'control depends on how they vote on organising the chamber.'
      + facts([
          ['Headline (sit out)', 'They vote with neither, as pledged. The party with more seats '
            + 'organises: <code>D controls \u21d4 D > R</code>, a tie to the Vice President\u2019s '
            + 'party. In a 50\u201349\u20131 Senate that is the 50.'],
          ['Toggle (free to choose)', 'They may side with either. A party needs its number '
            + '(51 D, 50 R); short of both, the independents decide, reported as its own outcome.'],
          ['Not modelled', 'Which side each would take. No fitted basis exists; the Who wins tab '
            + 'shows what each material seat\u2019s choice is worth.'],
        ]),
  }),
  governor_zero_poll_coverage: () => ({
    title: 'Governor races have no usable polls',
    body: `No governor poll could be matched to a two-party matchup this run.`
      + facts([
          ['Usual cause', `Candidate resolution. The FEC is a federal agency and holds no roster of
            state candidates, so a poll naming two people cannot be looked up there.`],
          ['Normal path', 'The race feed, which carries governor candidates by name.'],
          ['Effect', `Every governor race runs on its prior alone, and the seat counts on this
            page should be read that way.`],
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
            country.`],
          ['The cap', `Elasticity is capped at the point where the least responsive district still
            moves <em>with</em> the country.`],
          ['Cost', 'None measurable: scored on each past cycle with a fit on the others, the capped '
            + 'version is as accurate as the free one or better. Re-checked on every run.'],
        ]) },
  ((pf) => ({
    title: 'The governor prior is fitted, with gaps before 2022',
    body: `Fitted on ${pf ? pf.n : '—'} governor generals, ${pf ? pf.cycles.join('–') : ''}: the 538 `
      + `corpus, plus MEDSL's official returns for 2024 and for 2022 races nobody polled.`
      + facts([
          ['Missing', 'Unpolled governor races before 2022. None bears on a 2026 incumbent.'],
          ['Incumbents with a record', `${pf ? `${pf.with_record} of ${pf.incumbents}` : '—'} running this cycle.`],
          ['Who counts as incumbent', `The last race's winner, by name, on this ballot — the `
            + `definition the fit measured. A mid-term successor counts as open. It overrides the `
            + `race feed where they disagree`
            + (pf && pf.overrides.length ? ` (${pf.overrides.map(o => o.race_id).join(', ')})` : '')
            + '.'],
        ]),
  }))(f.topline.governor.prior_fitted),
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
    const k = alarmKind(a);
    const fn = ALARM[k.key];
    if (fn) alarms.push(fn(k.arg, forecast, k.sub));
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
