// How one race gets its number.
//
// README explains this in prose and PLAN.md defends the choices; neither lets
// you watch it happen. This is the same arithmetic, stepped, on a district you
// choose — an explorable rather than an explanation.
//
// The final step draws the REAL simulated quantiles rather than a fitted normal
// curve. The model's idiosyncratic term is Student-t with 5 degrees of freedom
// and it is added to three shared normals, so a bell drawn over mu +- sigma
// would be a picture of a distribution this model deliberately does not use.
import d3 from '../d3.js';
import { C, svg, fmtMargin, fmtPct, chamberName } from '../charts/util.js';

// The seven steps are the same arithmetic in every chamber; only the noun for
// the thing being contested changes. It is taken from the race rather than
// written into the prose, which is how the panel stopped being House-only.
const NOUN = { house: 'district', senate: 'seat', governor: 'governorship' };
const noun = r => NOUN[r.chamber] || 'race';
// What the race IS, in one phrase. Built from a table rather than assembled out
// of the chamber name and the noun, which produced "a governor governorship".
const WHAT = { house: 'a House district', senate: 'a Senate seat',
               governor: 'a governorship' };
// "Governors" is the name of a chamber, not an adjective: `${chamberName(c)} races`
// lowercased gave "435 house races" and "36 governors races".
const FIELD = { house: 'House', senate: 'Senate', governor: 'governor' };

const STEPS = [
  { key: 'lean', title: 'Start with the seat',
    text: r => `${r.race_id} is ${WHAT[r.chamber] || 'a race'}. In the 2024 presidential election it
                voted <b>${fmtMargin(r.lean)}</b> against the country as a whole. Every race starts
                here: no polls, no candidates, one number for how this electorate voted when the
                same choice was put to everyone.` },
  { key: 'env', title: 'Add the national environment',
    text: (r, env, f) => `National polling puts this year at
                <b>D${env >= 0 ? '+' : ''}${env.toFixed(2)}</b>, after subtracting the
                ${f.environment.instrument_bias} points by which the generic ballot has historically
                flattered Democrats. A national swing does not land evenly — a safe seat has fewer
                voters left to change their minds — so each seat carries an elasticity:
                <code>${r.elasticity.toFixed(2)} × ${env.toFixed(2)} =
                ${(r.elasticity * env >= 0 ? '+' : '')}${(r.elasticity * env).toFixed(2)}</code>.` },
  { key: 'inc', title: 'Add incumbency',
    text: r => r.inc_adj
      ? `The sitting member is defending this ${noun(r)}: <b>${r.inc_adj >= 0 ? '+' : '−'}${Math.abs(r.inc_adj).toFixed(1)}</b>
         to the ${r.inc_adj >= 0 ? 'Democrats' : 'Republicans'}, the measured advantage of being the
         name voters already know. The same figure in every race — the model makes no claim about
         which incumbents are unusually strong.`
      : `No candidate on this ballot holds the seat, so nothing is added. The advantage belongs to
         the incumbent as a person, not to the party holding the seat, so an open seat gets none of
         it however safe it looks.` },
  { key: 'prior', title: 'That is the prior',
    text: (r, env, f) => {
      // Counted within the race's OWN chamber. Quoting the House's 360 unpolled
      // districts under a Senate race would be a true number about the wrong set.
      const unpolled = f.coverage.prior_only[r.chamber];
      const polled = f.coverage.poll_driven[r.chamber];
      return `<code>lean + swing + incumbency = ${fmtMargin(r.prior_mu)}</code> — the estimate
              before a single poll of this ${noun(r)} is looked at. For <b>${unpolled}</b> of the
              ${unpolled + polled} ${FIELD[r.chamber] || 'these'} races this cycle the working ends
              here, because no one polls them${r.n_polls ? '' : ', and this is one of them'}.`;
    } },
  { key: 'poll', title: 'Now the polls',
    text: r => r.n_polls
      ? `${r.n_polls} poll${r.n_polls > 1 ? 's' : ''} average${r.n_polls > 1 ? '' : 's'} to
         <b>${fmtMargin(r.poll_margin)}</b>. Each is corrected for its own pollster's measured lean,
         then weighted by that pollster's measured accuracy and by age — a poll 30 days old carries
         half the weight of today's. Net of all of it:
         <code>effective n = ${r.effective_n.toFixed(1)}</code> across
         ${r.effective_pollsters.toFixed(1)} ${r.effective_pollsters < 1.5 ? 'pollster' : 'distinct pollsters'}.`
      : `There are none, which is the normal case. The prior is the answer.` },
  { key: 'mu', title: 'Blend them',
    text: r => r.n_polls
      ? `<code>w = n/(n+3) = ${r.effective_n.toFixed(1)}/(${r.effective_n.toFixed(1)}+3) =
         ${r.poll_weight.toFixed(3)}</code> on the polls, and <code>1−w</code> on the prior. The 3
         is the prior's strength in the same units — worth about three polls, so a race with three
         polls lands halfway. The textbook alternative, weighting each source by its claimed
         precision, was tried and did worse on past elections: it assumes polls are unbiased and
         independent of each other, and they are neither.
         <code>μ = ${fmtMargin(r.mu)}</code>.`
      : `Nothing to blend, so the estimate stays at <code>μ = ${fmtMargin(r.mu)}</code>.` },
  // Every calibration quoted here comes out of the payload. Retyping them into
  // prose is how a page ends up confidently quoting a sigma the engine no longer
  // ships -- the numbers moved under exactly these sentences once already.
  { key: 'sigma', title: 'Spread it',
    text: (r, env, f) => `An estimate is not a forecast until it has a width. Four independent
                errors, added in quadrature:
                <code>√(${f.sigma.nat.toFixed(2)}² + ${f.sigma.reg.toFixed(2)}² +
                ${f.sigma.state.toFixed(2)}² + ${r.sigma_idio.toFixed(2)}²) =
                ±${r.sigma_total.toFixed(2)}</code> — national, then ${r.region}, then ${r.state},
                then this race
                alone${r.prior_stale ? `, the last widened ×${f.calibration.prior.stale_multiplier.toFixed(2)}
                for a prior carried across a redraw` : ''}. The first three are <em>shared</em>,
                which is what makes this a forecast of an election and not of 506 unrelated
                contests. Drawing it ${f.meta.n_sims.toLocaleString()} times gives the Democrat
                <b>${fmtPct(r.win_prob)}</b>.` },
];

export function walkthrough(host, { races, environment, initial, forecast,
                                    chambers = ['house'] }) {
  host.replaceChildren();
  const pool = races.filter(r => chambers.includes(r.chamber) && !r.locked && r.median_margin != null)
    .sort((a, b) => (b.n_polls - a.n_polls) || (Math.abs(a.win_prob - 0.5) - Math.abs(b.win_prob - 0.5)));
  let race = pool.find(r => r.race_id === initial) || pool[0];
  let step = 0;

  const bar = document.createElement('div');
  bar.className = 'wt-bar';
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Race to walk through');
  for (const r of pool.slice(0, 60)) {
    const o = document.createElement('option');
    o.value = r.race_id;
    o.textContent = `${r.race_id} — ${r.n_polls ? `${r.n_polls} poll${r.n_polls > 1 ? 's' : ''}` : 'prior only'}`;
    sel.append(o);
  }
  sel.value = race.race_id;
  const prev = document.createElement('button'); prev.className = 'chip'; prev.textContent = '‹ Back';
  const next = document.createElement('button'); next.className = 'chip'; next.textContent = 'Next ›';
  bar.append(sel, prev, next);

  const chart = document.createElement('div'); chart.className = 'wt-chart';
  const dots = document.createElement('div'); dots.className = 'wt-dots';
  const copy = document.createElement('div'); copy.className = 'wt-copy';
  host.append(bar, chart, dots, copy);

  function draw() {
    const env = environment.margin;
    const marks = {
      lean: race.lean,
      env: race.lean + race.elasticity * env,
      inc: race.prior_mu,
      prior: race.prior_mu,
      poll: race.poll_margin,
      mu: race.mu,
      sigma: race.mu,
    };
    const shown = STEPS.slice(0, step + 1);
    const vals = shown.map(s => marks[s.key]).filter(v => v != null);
    const q = race.quantiles;
    const span = Math.max(12, ...vals.map(v => Math.abs(v)),
                          step >= 6 && q ? Math.abs(q['5']) + 3 : 0,
                          step >= 6 && q ? Math.abs(q['95']) + 3 : 0);

    chart.replaceChildren();
    const W = 720, H = 150, m = { t: 40, r: 20, b: 34, l: 20 };
    // Democratic to the LEFT, matching the snake and the swarm. Every margin
    // axis on this page points the same way; only the seat-count axis, which is
    // a different quantity, runs the other direction.
    const x = d3.scaleLinear().domain([-span, span]).range([W - m.r, m.l]);
    const s = svg(chart, W, H, `${race.race_id}: ${STEPS[step].title}`);
    const midY = (m.t + H - m.b) / 2;

    // the real simulated spread, from quantiles, on the last step
    if (step === 6 && q) {
      for (const [a, b, op] of [['5', '95', 0.16], ['10', '90', 0.2], ['25', '75', 0.28]]) {
        s.append('rect').attr('x', x(q[b])).attr('width', x(q[a]) - x(q[b]))
          .attr('y', midY - 21).attr('height', 42).attr('rx', 3)
          .attr('fill', C.dem).attr('fill-opacity', op);
      }
    }

    s.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', midY).attr('y2', midY)
      .attr('stroke', C.line);
    s.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t - 12).attr('y2', H - m.b)
      .attr('stroke', C.ink).attr('stroke-opacity', 0.5);
    s.append('text').attr('x', x(0)).attr('y', m.t - 18).attr('text-anchor', 'middle')
      .attr('fill', C.muted).attr('font-size', 10).text('tie');

    // ghosts of the earlier steps, so the movement is legible
    shown.slice(0, -1).forEach(st => {
      const v = marks[st.key];
      if (v == null) return;
      s.append('circle').attr('cx', x(v)).attr('cy', midY).attr('r', 4)
        .attr('fill', C.faint).attr('fill-opacity', 0.55);
    });
    const from = shown.length > 1 ? marks[shown[shown.length - 2].key] : null;
    const to = marks[STEPS[step].key];
    if (from != null && to != null && Math.abs(to - from) > 0.05) {
      s.append('line').attr('x1', x(from)).attr('x2', x(to)).attr('y1', midY).attr('y2', midY)
        .attr('stroke', C.accent).attr('stroke-width', 2);
    }
    if (to != null) {
      s.append('circle').attr('cx', x(to)).attr('cy', midY).attr('r', 7)
        .attr('fill', to > 0 ? C.dem : C.rep).attr('stroke', C.surface).attr('stroke-width', 2);
      s.append('text').attr('x', x(to)).attr('y', midY - 16).attr('text-anchor', 'middle')
        .attr('fill', C.ink).attr('font-size', 12).attr('font-weight', 600).text(fmtMargin(to));
    }
    // the poll average sits alongside the prior rather than replacing it
    if (step >= 4 && race.poll_margin != null && STEPS[step].key !== 'poll') {
      s.append('circle').attr('cx', x(race.poll_margin)).attr('cy', midY).attr('r', 4.5)
        .attr('fill', 'none').attr('stroke', C.muted).attr('stroke-width', 1.5);
    }

    const ax = s.append('g').attr('transform', `translate(0,${H - m.b + 4})`)
      .call(d3.axisBottom(x).ticks(7)
        .tickFormat(v => (v === 0 ? '0' : `${v > 0 ? 'D' : 'R'}+${Math.abs(v)}`)).tickSizeOuter(0));
    ax.selectAll('text').attr('fill', C.muted).attr('font-size', 10);
    ax.selectAll('line,path').attr('stroke', C.line);

    dots.replaceChildren();
    STEPS.forEach((st, i) => {
      const b = document.createElement('button');
      b.className = `wt-dot${i === step ? ' on' : ''}${i < step ? ' done' : ''}`;
      b.setAttribute('aria-label', st.title);
      b.onclick = () => { step = i; draw(); };
      dots.append(b);
    });

    copy.innerHTML =
      `<div class="wt-step">Step ${step + 1} of ${STEPS.length}</div>` +
      `<h3>${STEPS[step].title}</h3><p>${STEPS[step].text(race, env, forecast)}</p>`;
    prev.disabled = step === 0;
    next.disabled = step === STEPS.length - 1;
  }

  sel.onchange = e => { race = pool.find(r => r.race_id === e.target.value); step = 0; draw(); };
  prev.onclick = () => { if (step > 0) { step--; draw(); } };
  next.onclick = () => { if (step < STEPS.length - 1) { step++; draw(); } };
  draw();
}
