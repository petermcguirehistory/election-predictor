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
const ALARM = {
  generic_ballot_stale: d => ({
    title: `The generic ballot is ${d} days stale`,
    body: `National polling is the input this forecast leans on hardest, and the latest reading
           describes opinion as it was ${d} days ago. Two separate problems, both priced. Its
           <em>lean</em> — the generic ballot has historically flattered Democrats — is subtracted.
           Its <em>age</em> widens the error on every race, at the rate opinion has actually been
           measured to drift: 0.32 points per square root of a day, so a reading four times older
           is twice as uncertain.`,
  }),
  generic_ballot_beyond_corpus_support: d => ({
    title: `The generic ballot is ${d} days old — older than anything that could be checked`,
    body: `The widening above is <em>derived</em> from how fast opinion drifts, not fitted to how
           wrong stale readings have actually been, because there is no historical case to fit to:
           the archive of past polling stops 60 days before every election, and inside that window
           the newest reading is never more than about a week old. Beyond that the correction is an
           extrapolation. It is probably on the cautious side — opinion moves less when there is no
           campaign running — but it is an extrapolation, and it is named as one.`,
  }),
  stale_priors: (n, f) => ({
    title: `${n} districts carry priors from superseded maps`,
    body: `These districts are being estimated from presidential results counted under lines they
           will not actually be contested on, which means the district number is pointing at a
           different set of voters. Their error bars are widened
           ×${f.calibration.prior.stale_multiplier.toFixed(2)} to cover what that has been measured
           to cost — by replaying 2022 with exactly that mistake deliberately introduced — but the
           central estimates are still built on the wrong electorate. <em>Not currently firing:</em>
           every district is on its own 2026 lines. The machinery is kept wired up for the next
           redraw that outruns the data.`,
  }),
  unresolved_polls: n => ({
    title: `${n} polls could not be resolved to a two-party margin`,
    body: `A poll is only usable once both names in it are matched to a party. Most of these polled
           somebody who is not a candidate in the race — a primary that has since been lost, or a
           name that was speculated about and never filed — so there is no contest for the number
           to describe. A handful test three or more names at once and have no single two-party
           margin to extract. The rest are rows the feed supplied without candidate names,
           same-party contests where both finalists share a party, and the races where one major
           party has nobody on the ballot at all. All are dropped rather than guessed at, and none
           of them is a race going unpolled: every one of these is a poll of something else.`,
  }),
  thin_poll_average: (n, f) => {
    // Which races these are matters more than how many. Computed here rather
    // than written down, because the answer changes every run: the alarm counted
    // 69 on the run this sentence was written for, and the decisive ones were the
    // thin ones.
    const races = (f.races || []).filter(r =>
      r.effective_n > 0.01 && r.effective_n <= 1.5);
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
      body: `After weighting for age, pollster lean and pollster accuracy, each of these races is
             worth fewer than one and a half independent readings — so a single new poll can move
             any of them noticeably. The model already widens their error bars for exactly this
             reason, and holds a single poll to about a quarter of the weight, with the seat's own
             history carrying the rest. That is the honest response to thin polling and it is not a
             substitute for having more of it.
             <b>${live.length} of these ${n} are still competitive</b>${top.length ? `, and they
             include some of the races most likely to be the one that decides control:
             ${top.map(r => `<b>${r.race_id}</b>`).join(', ')}` : ''}. Where this model is least
             certain and where it matters most are not independent of each other.`,
    };
  },
  third_party_share: (n, f) => ({
    title: `${n} polled race${n === '1' ? '' : 's'} where a third candidate takes a large share`,
    body: `The model decides every race on the margin between the Democrat and the Republican. In
           these, a sizeable share of the polling goes to somebody who is neither, so that margin
           is still the best estimate available but is no longer a description of the whole
           contest: ${(f.freshness.third_party_races || [])
             .map(r => `<b>${r.race_id}</b> ${r.third_pct.toFixed(0)}%`).join(', ')}.`,
  }),
  cross_feed_duplicate: n => ({
    title: `${n} polls share a race and fieldwork date with a poll from the other feed`,
    body: `Two feeds supply race polls and they spell pollsters differently. Where the poll itself
           settles the question — same race, same day, same margin, same sample size, and a name
           that contains the other — the two are merged and counted once. These are the ones left
           over, where the evidence is only the name and the date. Some are one shop written two
           ways; others are genuinely two pollsters who finished fieldwork on the same day and
           disagree about the result, which is not double counting at all. Guessing between them
           would be worse than naming them, so the run names them.`,
  }),
  incumbency_hand_list_stale: n => ({
    title: `${n} races where the ballot feed overruled the hand-kept incumbency list`,
    body: `The federal filing record says who holds a seat and not whether they are running for it
           — a retiring senator still files. That fact has to come from somewhere else, and it used
           to come from a list kept by hand. A hand-kept list is not wrong when it is written; it
           rots. So the ballot feed is authoritative and the list is kept only to be checked
           against it, which is how six Republican-held Senate seats were caught being credited an
           incumbency bonus for a senator who is not on the ballot. These are the remaining
           disagreements. The feed wins every one of them, so nothing here changes a number — it
           records that the older source has drifted.`,
  }),
  governor_zero_poll_coverage: () => ({
    title: 'Governor races have no usable polls',
    body: `No governor poll could be matched to a two-party matchup this run. The usual cause is
           candidate resolution: the FEC is a federal agency and holds no roster of state
           candidates, so a poll naming two people cannot be looked up there. The race feed carries
           governor candidates by name and normally covers this; if it has stopped, every governor
           race is running on its prior alone, and the seat counts on this page should be read that
           way. <em>Not currently firing.</em>`,
  }),
};

// A function of the forecast, not a const: two of these entries quote numbers the
// payload ships and the topline card already renders live. Left as literals they
// would silently contradict the card the first time a calibration is re-run —
// which is the exact defect `pres_source_integrity` was written to catch, one
// layer up.
const STRUCTURAL = (f) => [
  { title: 'A district may ignore the national swing, but is never allowed to move against it',
    body: `The model lets some districts respond more to a national swing than others, which is
           why a competitive seat moves further than a safe one. Left to fit freely, that
           relationship sends four to six of the most lopsided districts the <em>opposite</em> way
           to the country — and it scores <em>better</em> on held-out error while doing it, because
           those seats are never in doubt and a wrong answer in them barely registers. So the
           relationship is capped at the point where the least responsive district still moves with
           the country rather than against it. The cap costs accuracy on paper and is kept anyway;
           it is re-checked on every run rather than taken on trust.` },
  ((pa, gov) => ({
    title: 'How uncertain a governor race is before polling was assumed, not measured',
    body: `Every other uncertainty in this model was fitted to past elections. This one is the
           House figure multiplied by <b>${pa.bound ? pa.bound.shipped_ratio : '—'}</b>, a number
           nobody has ever checked against results. The Senate's equivalent <em>was</em> checked —
           the data said 1.465 against the assumed 1.625, across 97 races and three cycles, close
           enough that the assumption was kept. No such test exists for governors: the returns
           needed for it are not published in a usable form, since the standard tidy series covers
           President, Senate and House only and has no 2022 state file at all.` +
          (pa.bound ? `<br><br>
           So instead of fitting it, the model asks what being wrong about it would cost. Re-running
           the forecast at every ratio from <b>${(+pa.bound.range[0]).toFixed(2)} to
           ${(+pa.bound.range[1]).toFixed(2)}</b> — the full spread the Senate figure showed across
           its own three cycles — leaves the median at
           ${pa.bound.median_values.join(' / ')} governorships at every single point, and moves the
           expected count by <b>${pa.bound.expected_span}</b> of a seat. That is not luck: most of
           the ${gov.of} governor races have polls, so this number only fully governs the handful
           that do not, and those are safe either way. The assumption is unverified; what it is
           worth is measured.` : ''),
  }))(f.topline.governor.prior_asserted, f.topline.governor),
  { title: 'Governors have no control probability, by construction',
    body: `${f.topline.governor.of} governorships confer no collective majority, so there is no
           threshold to clear and this page reports how many are won rather than a probability of
           winning. That is a property of the office, not a gap in the model — and the payload
           ships <code>control_prob: null</code> rather than a number with nothing behind it.` },
  { title: 'Only three past elections have been replayed',
    body: `2018, 2020 and 2022 — every cycle for which the model can assemble the inputs it needs.
           Three is enough to show the machinery runs end to end and produces sane intervals. It is
           nowhere near enough to say anything precise about how many seats it typically misses by,
           and one of the three, 2020, is a presidential year being used to check a model built for
           midterms.` },
  { title: 'Polls are less accurate in lopsided races, and the model does not price that',
    body: `Measured across the archive of past polling: in races inside 5 points, polls miss the
           eventual margin by
           about <b>6.8 points</b> on average; in races at 20–40 points they miss by about
           <b>11.6</b>. The model uses one error curve regardless, so it is slightly too confident
           about exactly the races that look safest. Building it in would widen those and leave the
           close races — the ones that decide control — almost unchanged, which is why it is real,
           measured, and deliberately left for a later cycle.` },
  ((n) => ({
    title: `Two sources disagree about who is defending ${n} seat${n === 1 ? '' : 's'}`,
    body: `Whether an incumbent is on the ballot is worth 2.5 points in this model, and no single
           source settles it. The FEC's filing record says who <em>holds</em> a seat — a retiring
           member still files as the incumbent — so it cannot answer the question on its own. The
           race feed has a column that does, and the model follows that column.
           <br><br>
           In <b>${n}</b> race${n === 1 ? '' : 's'} the two do not agree: the feed records a seat
           as incumbent-defended when nobody on the ballot has filed as its incumbent, or the
           reverse. The disagreement is reported rather than resolved — each of those races says so
           in its own panel, and names who actually holds the seat — because picking a winner
           between the sources would hide the fact that one of them is wrong.`,
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
      const p = document.createElement('p');
      p.innerHTML = it.body;
      d.append(sum, p);
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
      body: `The source has previously shown ${rr.reverted.join(', ')} on 2026 lines and this
             export puts ${rr.reverted.length > 1 ? 'them' : 'it'} back in agreement with the
             118th-Congress baseline. Districts redraw between censuses and un-redrawing is not
             a thing that happens mid-cycle, so a redraw disappearing is read as the source
             losing information rather than as news about the map. ` +
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
             Independent advanced there is no Democrat on the ballot and a D-vs-R margin is the
             wrong quantity. Forecast anyway, and named in every run rather than assumed away.`,
    });
  }

  const h1 = document.createElement('h3');
  h1.textContent = 'Live alarms — computed this run';
  const h2 = document.createElement('h3');
  h2.textContent = 'Structural limits — these do not clear on their own';
  host.append(h1, make(alarms, 'alarm'), h2, make(STRUCTURAL(forecast), 'structural'));
}
