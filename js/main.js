// State store and composition.
//
// Every panel reads one store and re-renders on change, so a pinned race
// propagates everywhere at once rather than each chart holding its own copy of
// the condition.

import { loadAll, Sims } from './data.js';
import { C, fmtPct, fmtMargin, chamberName, SCOPES, scopeName, chambersFor,
         contestedThreshold } from './charts/util.js';
import { iconArray } from './charts/iconarray.js';
import { dotplot } from './charts/dotplot.js';
import { snake } from './charts/snake.js';
import { tippingChart } from './charts/tipping.js';
import { cartogram, choropleth, stateCartogram, stateChoropleth,
         cartogramModes } from './charts/cartogram.js';
import { beeswarm } from './charts/beeswarm.js';
import { raceTable } from './panels/racetable.js';
import { scenarioPanel } from './panels/scenario.js';
import { raceDetail } from './panels/racedetail.js';
import { correlationMatrix } from './charts/correlation.js';
import { hops, motionOK } from './charts/hops.js';
import { reliability, locoChart, seatMisses, senateRatio,
         governorSweep } from './charts/calibration.js';
import { trendChart } from './charts/trend.js';
import { flows } from './charts/flows.js';
import { limitsPanel } from './panels/limits.js';
import { playingField, statewideField } from './panels/playingfield.js';
import { walkthrough } from './panels/walkthrough.js';
import { watchlist } from './panels/watchlist.js';
import { movementPanel } from './panels/movement.js';
import { environmentStrip, houseLeverage } from './panels/environment.js';
import { sparkline } from './charts/sparkline.js';
import { baseline, series } from './history.js';
import { mountTabs } from './tabs.js';

const store = {
  data: null, pins: [], scope: 'house', mapMode: 'prob', vsup: true,
  detail: null, playing: false, layout: 'hex', tab: 'forecast',
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  // `changed` is the set of keys this update actually moved, or undefined on the
  // first render to mean "everything". Without it every panel re-rendered on every
  // store change: switching the seat chamber repainted 435 hexes, a 470-row table
  // and the correlation matrix, which is the most expensive thing on the page.
  emit(changed) { for (const fn of this._subs) fn(this, changed); },
  set(patch) {
    const changed = new Set();
    for (const [k, v] of Object.entries(patch)) if (!Object.is(this[k], v)) changed.add(k);
    Object.assign(this, patch);
    if (changed.size) this.emit(changed);
  },
  get selection() { return this.data.sims.select(this.pins); },
  get condition() {
    const floor = this.data.pins._meta.floor;
    const idx = this.selection;
    const n = idx ? idx.length : this.data.sims.m.n_sims;
    return { idx, n, floor, ok: n >= floor, pinned: this.pins.length > 0, pins: this.pins };
  },
};

// ---- permalinks ---------------------------------------------------------
// The conditioning panel exists so a reader can construct a scenario; without
// this they cannot hand it to anybody. Everything that changes what is on screen
// lives in the hash, so a link carries the view.
const HASH_KEYS = ['tab', 'scope', 'layout', 'mapMode', 'vsup'];
const HASH_DEFAULT = { tab: 'forecast', scope: 'house', layout: 'hex', mapMode: 'prob', vsup: true };

// The hash is the whole view, so reading it has to be TOTAL: a key that is
// absent means the default, never "leave whatever is there".
//
// This used to apply a key only when the hash carried one, which made the round
// trip lossy in one direction -- `writeHash` omits a key exactly when it holds
// its default, so every default the reader arrives at is written as an absence
// and then read back as "unchanged". Navigating from `#scope=senate&race=TX-SEN`
// to `#` left the page on the Senate with the drawer still open, and the drawer
// was the visible half: `detail` and `pins` have no HASH_DEFAULT entry, so they
// could only ever be set by a link and never cleared by one.
//
// Not reachable through the site's own chrome, because `writeHash` uses
// `replaceState` and leaves no history entries to go back through. It is
// reachable by editing the address bar, by a bookmark, and by anything that ever
// starts pushing state -- which is the kind of latent fault that surfaces as a
// mystery two features later.
function readHash(s) {
  const q = new URLSearchParams(location.hash.slice(1));
  const patch = { ...HASH_DEFAULT };
  for (const k of HASH_KEYS) {
    if (q.has(k)) patch[k] = k === 'vsup' ? q.get(k) !== '0' : q.get(k);
  }
  // A link can outlive the vocabulary it was written in. An unrecognised scope
  // falls back to the default rather than being carried: `chambersFor` would
  // return nothing for it and the reader would get a page of empty charts with
  // no clue why. An unrecognised tab is handled by `tabs.show`, which reports
  // the tab it actually settled on.
  if (!SCOPES.includes(patch.scope)) patch.scope = HASH_DEFAULT.scope;

  // Drop anything the payload cannot honour rather than failing the whole
  // link: a hash may outlive the run it was made against.
  const pins = q.has('pins')
    ? q.get('pins').split(',').filter(Boolean)
        .map(t => ({ race_id: t.split(':')[0], party: t.split(':')[1] === 'R' ? 'R' : 'D' }))
        .filter(p => s.data.pins[p.race_id] && s.data.pins[p.race_id].col >= 0)
    : [];
  // An empty result hands back the store's OWN array rather than a fresh one.
  // `store.set` compares with Object.is, so a new `[]` on every read would
  // report `pins` as changed every time the hash moved and repaint five panels
  // that did not move.
  patch.pins = pins.length || s.pins.length ? pins : s.pins;

  patch.detail = q.has('race')
    ? s.data.forecast.races.find(r => r.race_id === q.get('race')) || null
    : null;
  return patch;
}

function writeHash(s) {
  const q = new URLSearchParams();
  for (const k of HASH_KEYS) {
    if (s[k] !== HASH_DEFAULT[k]) q.set(k, s[k] === true ? '1' : s[k] === false ? '0' : s[k]);
  }
  if (s.pins.length) q.set('pins', s.pins.map(p => `${p.race_id}:${p.party}`).join(','));
  if (s.detail) q.set('race', s.detail.race_id);
  const h = q.toString();
  if (`#${h}` !== location.hash && !(h === '' && location.hash === '')) {
    history.replaceState(null, '', h ? `#${h}` : location.pathname);
  }
}

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls; if (text != null) n.textContent = text;
  return n;
};

function toggle(host, options, current, onChange, label) {
  const g = el('div', 'toggle');
  g.setAttribute('role', 'group');
  if (label) g.setAttribute('aria-label', label);
  for (const [v, l] of options) {
    const b = el('button', v === current ? 'on' : null, l);
    b.setAttribute('aria-pressed', String(v === current));
    b.onclick = () => onChange(v);
    g.append(b);
  }
  host.append(g);
}

// ---- scope ---------------------------------------------------------------
//
// One control at the top of the page says which races the page is about, and
// every section answers it in one of three ways. Which way, and WHY, is declared
// here rather than buried in each renderer, so the page's coverage can be read
// in one block -- and so the diagnostics panel can check that no section ships
// without saying what it is about. A chart whose subject is ambiguous is a chart
// that can be misread, and on a page carrying three chambers at once "which
// races is this?" is the ambiguity that actually bites.
//
//   follows  drawn per chamber; under `all`, one instance per chamber it supports
//   pooled   spans chambers, and filters down to the scope
//   fixed    can only ever be about certain chambers, and says so when the scope
//            asks for something it cannot give
const SECTION_SCOPE = {
  's-headline': { kind: 'fixed', can: ['house', 'senate', 'governor'],
    label: 'All three chambers',
    why: 'The card row is the whole board and always shows all three. The array beside it follows the scope.' },
  's-movement': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-seats': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-watch': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-path': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-map': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-flows': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-races': { kind: 'pooled' },
  's-scenario': { kind: 'fixed', can: ['house', 'senate', 'governor'],
    label: 'All three chambers',
    why: 'The sweep re-simulates every chamber at every stop.' },
  's-field': { kind: 'fixed', can: ['house'],
    why: 'Only the House has districts, so only the House has a districting tilt to measure. The '
       + 'Senate and governors have their own version in the next section — kept separate because '
       + 'a line somebody drew and a border nobody drew are different kinds of fact, not the same '
       + 'measurement on a different unit.' },
  's-statewide': { kind: 'fixed', can: ['senate', 'governor'],
    label: 'Senate · Governors',
    why: 'This measures the state borders, which decide the Senate and the governorships and have '
       + 'nothing to do with the House. The House version is the section above.' },
  's-correlation': { kind: 'pooled' },
  's-calibration': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-trend': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-walkthrough': { kind: 'pooled' },
  's-limits': { kind: 'fixed', can: ['house', 'senate', 'governor'],
    label: 'All three chambers' },
  's-coverage': { kind: 'pooled' },
  's-diag': { kind: 'fixed', can: ['house', 'senate', 'governor'],
    label: 'All three chambers' },
};

// Spelled out, because these land inside sentences rather than beside a label.
const NUMBER = { 1: 'one', 2: 'two', 3: 'three' };

const CHAMBER_NOUN = { house: 'districts', senate: 'seats', governor: 'governorships' };
const SEAT_NOUN = { house: 'seat', senate: 'seat', governor: 'governorship' };

// The noun phrase a chart uses for the set it is drawing -- "House districts",
// "governorships", "races, across all three chambers". A bare phrase with no
// count in it, because every caller already has a count of its own to put in
// front: gluing one in here produced "506 of 506 all 506 races".
const SCOPE_LABEL = {
  all: 'races from all three chambers',
  house: 'House districts',
  senate: 'Senate seats',
  governor: 'governorships',
};
const scopeLabel = s => SCOPE_LABEL[s.scope] || 'races';

const scopedRaces = s => (s.scope === 'all'
  ? s.data.forecast.races
  : s.data.forecast.races.filter(r => r.chamber === s.scope));

// Render one instance of a chart per chamber. Under a single-chamber scope there
// is one instance and no sub-heading, because the section badge already said
// which chamber it is; under `all` each gets its own.
function perChamber(host, chambers, draw) {
  host.replaceChildren();
  if (!chambers.length) return;
  for (const ch of chambers) {
    const box = el('div', 'per-chamber');
    if (chambers.length > 1) box.append(el('h3', 'pc-h', chamberName(ch)));
    const inner = el('div');
    box.append(inner);
    host.append(box);
    draw(inner, ch);
  }
}

// Every section's badge and, when the scope asks for something a fixed section
// cannot give, the sentence saying so. Run on every store change for EVERY
// section, deferred tabs included: a label is a few text nodes, and a reader who
// switches tab should never catch a heading still advertising the last scope.
function renderScopeTags(s) {
  for (const [id, d] of Object.entries(SECTION_SCOPE)) {
    const sec = document.getElementById(id);
    if (!sec) continue;
    const badge = sec.querySelector(':scope > .head .scope');
    const note = sec.querySelector(':scope > .scope-note');
    // Degrade rather than take the page down: a section with no slot is a bug,
    // and the diagnostics panel is where it gets reported.
    if (!badge || !note) continue;
    let text, off = false;

    if (d.kind === 'pooled') {
      text = scopeName(s.scope);
    } else if (d.kind === 'follows') {
      const drawn = chambersFor(s.scope, d.can);
      text = drawn.length === d.can.length ? 'All three chambers'
           : drawn.length ? chamberName(drawn[0])
           : scopeName(s.scope);
      off = !drawn.length;
    } else {
      text = d.label || d.can.map(chamberName).join(' · ');
      off = s.scope !== 'all' && !d.can.includes(s.scope);
    }

    badge.textContent = text;
    badge.classList.toggle('off', off);
    badge.title = d.why || '';
    badge.dataset.set = '1';

    // A section the scope cannot ask for is REMOVED, not annotated. This used to
    // stay on the page carrying a line explaining why it was not about the
    // chamber you had selected -- which is a footnote apologising for its own
    // presence. Selecting Senate is a request to be shown the Senate, and the
    // House districting map is not a qualified answer to it, it is a different
    // question.
    //
    // A CLASS AND NOT `hidden`. `hidden` already means something else here: it
    // is what the payload sets when a chamber is absent altogether, and tabs.js
    // reads it to decide whether a tab has anything left to show. Two mechanisms
    // writing one attribute is how a section comes back from the dead when the
    // scope changes.
    sec.classList.toggle('scope-hidden', off);
    note.hidden = true;
  }
}

// ---- panels -------------------------------------------------------------

// ---- navigation ---------------------------------------------------------
//
// One way to send a reader somewhere else on the site, so every affordance that
// does it -- a card, a number inside a sentence, the link row along a card's
// bottom edge -- lands the same way. This page used to contain exactly one
// cross-tab link and one clickable chart, which is not a dashboard; it is a
// report with tabs on it.
//
// `patch` carries the scope that makes the destination about the thing that was
// clicked. Sending a reader from the Senate card to the map and leaving the map
// showing the House is worse than not sending them at all.
function goto(sectionId, patch = {}) {
  const tab = tabs.owner(sectionId);
  store.set({ ...patch, ...(tab ? { tab } : {}) });
  const node = document.getElementById(sectionId);
  if (!node) return;
  // After the paint that reveals the tab: a section on a hidden panel has no box
  // to scroll to, and scrollIntoView on it silently does nothing at all.
  requestAnimationFrame(() => node.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  }));
}

function goButton(label, cls, sectionId, patch, title) {
  const b = el('button', cls, label);
  b.type = 'button';
  if (title) b.title = title;
  b.onclick = e => { e.stopPropagation(); goto(sectionId, patch); };
  return b;
}

// ---- movement -----------------------------------------------------------

const SHORT_DATE = iso => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// What a chamber has done since a run it can honestly be compared with.
//
// Both the baseline and the reachable series come from js/history.js, which will
// not step across a join engine/history.py declined to certify. So a card can
// say "no comparable earlier run" -- it cannot quote a movement that is really
// the model changing underneath the forecast. The first two published runs moved
// House control eighteen points in two days and none of it was the election.
function movement(bl, ch) {
  if (!bl) return null;
  const ser = series(bl.run, ch);
  if (!ser) return null;
  const i = bl.base ? bl.run.indexOf(bl.base) : -1;
  return { kind: ser.kind, values: ser.values, from: i >= 0 ? ser.values[i] : null,
           to: ser.values.at(-1), base: bl.base, runs: bl.run.length };
}

// The delta line under a card's headline number.
//
// Stated from the side the card is stated from. The Senate card reads "59.8%,
// Republicans favoured", so its movement is the change in the REPUBLICAN
// probability -- a blue rise underneath a red number would read as Republicans
// gaining and mean the opposite. Direction is carried by an arrow as well as by
// colour, because no party encoding on this page rests on hue alone.
function movementRow(mv, ch, lead) {
  const row = el('div', 'tl-move');
  if (!mv || mv.from == null) {
    row.append(el('span', 'tl-nomove', 'no comparable earlier run'));
    return row;
  }
  const flip = lead === 'R' && mv.kind === 'prob';
  const values = flip ? mv.values.map(v => 1 - v) : mv.values;
  const from = flip ? 1 - mv.from : mv.from;
  const to = flip ? 1 - mv.to : mv.to;
  const d = to - from;
  const flat = mv.kind === 'prob' ? Math.abs(d) < 0.005 : d === 0;
  const dir = flat ? 'flat' : d > 0 ? 'up' : 'down';
  const glyph = flat ? '\u2014' : d > 0 ? '\u25b2' : '\u25bc';
  const size = mv.kind === 'prob'
    ? `${Math.abs(d * 100).toFixed(1)} pts`
    : `${Math.abs(d)} ${Math.abs(d) === 1 ? 'governorship' : 'governorships'}`;
  const who = mv.kind === 'prob'
    ? `${lead === 'R' ? 'Republican' : 'Democratic'} probability of control`
    : 'median Democratic governorships';
  const delta = el('span', `tl-delta ${dir}`, `${glyph} ${flat ? 'unchanged' : size}`);
  delta.title = `Change in the ${who} since the run of ${mv.base.asof}.`;
  row.append(delta, el('span', 'tl-since', `since ${SHORT_DATE(mv.base.asof)}`));
  const spark = el('span', 'tl-spark');
  row.append(spark);
  sparkline(spark, {
    values,
    colour: lead === 'R' ? C.rep : C.dem,
    rule: mv.kind === 'prob' ? 0.5 : null,
    label: `${chamberName(ch)} across the last ${mv.runs} comparable runs`,
  });
  return row;
}

// Which chamber gets the icon array under the `all` scope.
//
// Three arrays used to be stacked in a half-width column, which is the same
// number said three times in the least dense form the page has. One is enough,
// and the one worth drawing is the chamber whose control is least settled: a
// block of 95 blue dots and 5 red teaches nothing the card has not said. A
// chamber with no control probability cannot be the subject unless it is the
// whole scope, because it has no hundred elections to divide.
function arrayChamber(shown, stateOf) {
  if (shown.length === 1) return shown[0];
  const contested = shown.filter(ch => stateOf(ch).control_prob != null);
  if (!contested.length) return shown[0];
  return contested.reduce((a, b) =>
    (Math.abs(stateOf(a).control_prob - 0.5) <= Math.abs(stateOf(b).control_prob - 0.5) ? a : b));
}

function renderHeadline(s) {
  const { forecast, sims, history } = s.data;
  const c = s.condition;

  const cond = c.pinned
    ? ` <span class="cond">conditional on ${s.pins.length} pinned race${s.pins.length > 1 ? 's' : ''}</span>`
    : '';
  const stateOf = ch => (c.ok ? sims.summary(ch, c.idx) : null) || forecast.topline[ch];

  // Republicans hold both chambers going in, which is what makes "win" and
  // "hold" the right pair of verbs; it is read off the payload's own threshold
  // rather than asserted, so a cycle where that changes does not need this
  // sentence rewritten.
  const shown = chambersFor(s.scope, forecast.meta.chambers);

  // One array, for the chamber that is actually in doubt.
  const ach = arrayChamber(shown, stateOf);
  const host = $('#iconarray');
  host.replaceChildren();
  {
    const st = stateOf(ach);
    const chName = chamberName(ach);
    const why = shown.length > 1
      ? ` <span class="icon-why">Drawn for the ${chName}, whose control is the least settled of ` +
        `the ${NUMBER[shown.length] || shown.length}; the cards beside it carry the ` +
        `${shown.length === 2 ? 'other' : 'others'}.</span>`
      : '';
    if (st.control_prob == null) {
      // Governors. There is no favourite because there is nothing to be
      // favoured for, so the reference class becomes the 36 offices themselves
      // rather than 100 hypothetical elections, and the array answers the
      // question governors do have: how many are won.
      const of = forecast.topline.governor.of;
      iconArray(host, {
        n: of, k: Math.round(st.median), cols: 12,
        unit: 'governorships won by Democrats at the median',
        label: `Of the <b>${of}</b> governorships on the ballot, Democrats win <b>${st.median}</b> ` +
               `at the median; 80% of simulations land between <b>${st.p10}</b> and <b>${st.p90}</b>. ` +
               `There is no probability of control because there is no control: ` +
               `36 governorships confer no collective majority.${cond}${why}`,
      });
    } else {
      const p = st.control_prob;
      iconArray(host, {
        n: 100, k: Math.round(p * 100), cols: 20,
        unit: `simulated elections won by Democrats in the ${chName}`,
        label: `In <b>100</b> simulated elections, Democrats won the ${chName} in ` +
               `<b>${Math.round(p * 100)}</b>.${cond}${why}`,
      });
    }
  }

  // The lede says the same thing in words, one clause per chamber shown.
  const clause = ch => {
    const st = stateOf(ch);
    const chName = chamberName(ch);
    if (st.control_prob == null) {
      return `Democrats take <em>${st.median}</em> of ${forecast.topline.governor.of} governorships`;
    }
    return st.control_prob >= 0.5
      ? `Democrats are <em>favoured</em> to win the ${chName}`
      : `Republicans are <em class="r">favoured</em> to hold the ${chName}`;
  };
  const parts = shown.map(clause);
  const lede = $('#lede');
  // Three clauses at the single-chamber type size run to eight lines of 2rem
  // serif. The multi-chamber lede is set smaller and to a wider measure -- it is
  // a summary of three things rather than one headline.
  lede.classList.toggle('multi', parts.length > 1);
  lede.innerHTML = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}.`
    : `${parts[0]}.`;

  // Movement is measured against the newest run the provenance can reach back
  // to, which is not necessarily the previous one: these are published several
  // times a week and twice in a day when a refresh lands mid-session, so a
  // one-run delta is mostly Monte Carlo noise.
  const bl = baseline(history, 7);

  const cards = $('#toplines');
  cards.replaceChildren();
  for (const cc of forecast.meta.chambers) {
    const live = c.ok ? sims.summary(cc, c.idx) : null;
    const base = forecast.topline[cc];
    const st = live || base;
    const p = live ? live.control_prob : base.control_prob;
    // The card for the chamber the scope is on is marked, so the row reads as
    // the whole board with your place on it rather than as three equal cards
    // that happen to disagree with the big number beside them.
    const card = el('div', `topline${cc === s.scope ? ' on' : ''}`);
    card.append(el('div', 'chamber', chamberName(cc)));
    const range = `80% range <b>${st.p10}\u2013${st.p90}</b>`;
    const lead = p == null ? null : p >= 0.5 ? 'D' : 'R';

    // The face of the card is the control that changes the page's subject. It
    // was a div: the row has always BEHAVED like a control -- it marks the
    // chamber the scope is on -- while being unclickable, which is the worst of
    // both.
    const face = el('button', 'tl-main');
    face.type = 'button';
    face.onclick = () => store.set({ scope: cc });
    face.setAttribute('aria-label',
      `Show only ${chamberName(cc)} races across the whole page.`);

    // A chamber with no majority to hold gets a COUNT where the others get a
    // percentage. Governors are the case: 36 governorships confer no collective
    // control, so there is no threshold, no favourite, and no probability. The
    // card keeps the same shape so the row still reads as a row, but the big
    // number is the seat median and the line beneath says why there is no
    // percentage rather than leaving a reader to wonder where it went.
    if (p == null) {
      face.append(el('div', 'prob d', String(st.median)));
      face.append(el('div', 'who', `of ${base.of} \u00b7 no majority to hold`));
      // Same guard as the other two cards: under a pin the median above is read
      // from the matching draws only, and the published history is not. Pairing
      // them would present the difference between a conditional number and an
      // unconditional one as movement in the forecast.
      if (!(live && c.pinned)) face.append(movementRow(movement(bl, cc), cc, 'D'));
      card.append(face);
      const seats = el('div', 'seats');
      seats.innerHTML = `${range} \u00b7 <span class="muted">no control probability</span>`;
      card.append(seats);
      const pa = base.prior_asserted;
      if (pa) {
        const warn = el('div', 'seats asserted');
        // The bound is the point. "Asserted" alone invites a reader to imagine the
        // worst; the sweep says what the worst actually is, and it is nothing.
        const b = pa.bound;
        warn.innerHTML = `<b>\u00b1${pa.sigma.toFixed(2)} assumed</b> \u2014 how uncertain a governor race ` +
          `is before polling is the one quantity here that was never measured against results. ` +
          (b
            ? `Sweeping it across everything a fit could plausibly return ` +
              `(&times;${(+b.range[0]).toFixed(2)}\u2013${(+b.range[1]).toFixed(2)}) leaves the median at ` +
              `<b>${b.median_values[0]}</b> and moves the expected count by ` +
              `<b>${b.expected_span.toFixed(2)}</b>. `
            : '') +
          `<a href="#s-limits">why</a>`;
        card.append(warn);
      }
      card.append(cardLinks(cc));
      cards.append(card);
      continue;
    }

    face.append(el('div', `prob ${lead === 'D' ? 'd' : 'r'}`, fmtPct(lead === 'D' ? p : 1 - p)));
    face.append(el('div', 'who',
      `${lead === 'D' ? 'Democrats' : 'Republicans'} favoured` +
      (live && c.pinned ? ` \u00b7 n=${live.n.toLocaleString()} (\u00b1${(live.se * 100).toFixed(1)} pts)` : '')));
    // A conditioned probability is not a point in the published series, so there
    // is nothing honest to compare it with; the movement row is dropped rather
    // than left showing the unconditional one beside a conditional number.
    if (!(live && c.pinned)) face.append(movementRow(movement(bl, cc), cc, lead));
    card.append(face);

    const seats = el('div', 'seats');
    seats.append(document.createTextNode('median '));
    seats.append(goButton(String(live ? live.median : base.median), 'tl-inline', 's-seats',
      { scope: cc }, 'See the whole distribution these seat totals came from'));
    seats.append(document.createTextNode(' D seats \u00b7 '));
    const r = el('span'); r.innerHTML = range; seats.append(r);
    seats.append(document.createTextNode(' \u00b7 '));
    seats.append(goButton(String(base.threshold), 'tl-inline', 's-path',
      { scope: cc }, 'See which seat actually delivers the majority'));
    seats.append(document.createTextNode(' to control'));
    card.append(seats);

    // The Senate figure is conditional on three seats with no Democrat running
    // staying Republican, and says so where it is read. Hidden while a scenario is
    // pinned: the ladder is computed on the unconditional simulation, so pairing it
    // with a conditioned probability would compare two different things.
    const nb = base.no_democrat_bound;
    if (nb && !live) {
      const hi = nb.ladder[String(nb.n_seats)];
      const note = el('div', 'seats');
      note.innerHTML = `assumes <b>${nb.n_seats}</b> seats with no Democrat running ` +
        `(${nb.races.join(', ')}) stay R \u00b7 if their independents win and caucus D, ` +
        `<b>${fmtPct(hi)}</b>`;
      card.append(note);
    }
    card.append(cardLinks(cc));
    cards.append(card);
  }

  renderToplineNote(s, bl);
}

// Where each card leads. The three destinations are the three questions a reader
// has after the number: where are these seats, which races are they, and has
// this model been right before.
function cardLinks(cc) {
  const row = el('div', 'tl-links');
  row.append(
    goButton('Map', 'tl-link', 's-map', { scope: cc }),
    goButton('Races', 'tl-link', 's-races', { scope: cc }),
    goButton('Track record', 'tl-link', 's-calibration', { scope: cc }));
  return row;
}

// The one place the comparability rule is spelled out in words. Every "since" on
// the cards above is measured inside this window, and where the window stops it
// says what stopped it -- because a series that simply begins ten runs ago looks
// like a model that began ten runs ago rather than one whose earlier runs cannot
// be joined to these.
function renderToplineNote(s, bl) {
  const note = $('#tl-note');
  note.replaceChildren();
  if (!bl || !bl.base) {
    note.innerHTML = bl
      ? `No movement is shown: the run before this one was produced differently, so the two `
        + `cannot be compared. `
      : `No published history yet, so there is nothing to measure movement against. `;
  } else {
    note.innerHTML =
      `Movement is measured against the run of <b>${SHORT_DATE(bl.base.asof)}</b>, ${bl.days} days `
      + `back. The series reaches <b>${bl.run.length}</b> runs, as far as `
      + `${SHORT_DATE(bl.run[0].asof)}`
      + (bl.blocked
        ? `, and stops there: ${bl.blocked.state === 'broken'
            ? 'the build changed'
            : 'that run recorded no provenance'}, so anything earlier is partly a different model `
          + `rather than a different electorate. `
        : `, which is every run ever published. `);
  }
  const a = el('a', null, 'Full history \u2192');
  a.href = '#s-trend';
  note.append(a);
}

function renderMovement(s) {
  perChamber($('#movement'), chambersFor(s.scope, s.data.forecast.meta.chambers),
    (host, ch) => movementPanel(host, {
      movement: s.data.forecast.movement, chamber: ch, chamberLabel: chamberName(ch),
    }));
}

function renderSeats(s) {
  const { forecast, sims } = s.data;
  const c = s.condition;
  const UNIT = {
    house: 'Democratic seats',
    senate: `Democratic seats (incl. ${sims.m.senate_heldover} holdovers)`,
    governor: `Democratic governorships (of ${forecast.topline.governor.of})`,
  };
  // The dotplot's own note comes in two versions -- one for a chamber with a
  // majority line and one for a chamber without -- and under `all` the first
  // version was printed twice, word for word. Each version is shown once.
  const told = new Set();
  perChamber($('#dotplot'), chambersFor(s.scope, forecast.meta.chambers), (host, ch) => {
    const live = c.ok ? sims.summary(ch, c.idx) : null;
    const kind = forecast.topline[ch].threshold == null ? 'no-line' : 'line';
    dotplot(host, {
      hist: live ? live.hist : forecast.seats[ch],
      // Undefined for governors, and the chart draws no line rather than inventing
      // one. See docs/js/charts/dotplot.js.
      threshold: forecast.topline[ch].threshold ?? null,
      n: live ? live.n : forecast.meta.n_sims,
      chamber: ch,
      unit: UNIT[ch] || 'Democratic seats',
      showNote: !told.has(kind),
    });
    told.add(kind);
    // The one sentence left behind by moving `Path to a majority` off this page.
    // It is the interesting half of that section -- which seat the ordering
    // lands on -- and it is now a door rather than fifteen hundred pixels of
    // chart above the fold.
    const cross = forecast.tipping[ch] && forecast.tipping[ch].crossing;
    if (cross) {
      // The Senate's crossing seat sits at a margin of -0.02, which fmtMargin
      // rounds to "R+0.0" -- a party label attached to nothing. Say what that
      // actually is rather than printing a signed zero.
      const cm = cross.median_margin;
      const where = Math.abs(cm) < 0.05
        ? `${cross.race_id}, which the model puts at a dead heat,`
        : `${cross.race_id} (${fmtMargin(cm)}),`;
      const line = el('p', 'chart-note');
      line.append(document.createTextNode(
        `Ordered by expected margin, the seat that reaches the majority is ${where} `
        + `at rank ${cross.rank}. Which race `));
      const a = el('a', null, 'actually decides it');
      a.href = '#s-path';
      a.onclick = e => { e.preventDefault(); goto('s-path', { scope: ch }); };
      line.append(a);
      line.append(document.createTextNode(' is a different question, and a different answer.'));
      host.append(line);
    }
  });
}

// ---- the races the answer rests on --------------------------------------

function renderWatch(s) {
  const { forecast, sims } = s.data;
  perChamber($('#watch'), chambersFor(s.scope, forecast.meta.chambers), (host, ch) => {
    watchlist(host, {
      races: forecast.races.filter(r => r.chamber === ch),
      chamber: ch,
      chamberLabel: chamberName(ch),
      tipping: forecast.tipping[ch] || null,
      sims,
      condition: s.condition,
      onPick: r => open(r),
    });
  });
}

// ---- the input everything else is downstream of --------------------------

function renderEnvironment(s) {
  environmentStrip($('#environment'), {
    environment: s.data.forecast.environment,
    scenarios: s.data.scenarios,
    gbAgeDays: s.data.forecast.freshness.generic_ballot_age_days,
    onLeverage: () => goto('s-scenario'),
  });
}

function renderPath(s) {
  const { forecast, sims } = s.data;
  const c = s.condition;
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));

  perChamber($('#path'), chambersFor(s.scope, forecast.meta.chambers), (host, ch) => {
    const grid = el('div', 'two-col');
    const left = el('div'), right = el('div');
    // Counted in races on the ballot, not seats held: the Senate majority is 51,
    // but 34 Democratic seats are not up, so the line falls at seat 17 of 35.
    const threshold = contestedThreshold(sims, ch);
    const held = (sims.m.offsets[ch] || 0);
    const tip = forecast.tipping[ch];

    left.append(el('h3', null, 'Ordered by margin'));
    const snakeHost = el('div'); left.append(snakeHost);
    right.append(el('h3', null, 'Which race decides it'));
    const tipHost = el('div'); right.append(tipHost);
    grid.append(left, right);
    host.append(grid);

    snake(snakeHost, {
      races: forecast.races.filter(r => r.chamber === ch),
      threshold,
      majority: sims.m.majority[ch] ?? null,
      held,
      unit: CHAMBER_NOUN[ch] || 'races',
      crossing: tip ? tip.crossing : null,
      onPick: r => open(r),
    });
    tippingChart(tipHost, {
      distribution: tip ? tip.distribution : null,
      chamber: chamberName(ch), byId, frozen: c.pinned,
      onPick: r => open(r),
    });
  });
}

// Functions rather than strings, because one of them has to count something. The
// hatched-district sentence used to name four states from memory; ten states
// redrew, covering 181 districts, and the same sentence also said their PRIORS
// were wrong when the priors have been on the 2026 lines for every district since
// workstream C — contradicting the legend directly beneath it. Both facts now come
// out of the payload, so neither can drift again.
const MAP_CAPTION = {
  'house:hex': f => {
    const stale = f.races.filter(r => r.chamber === 'house' && r.boundary_stale);
    const states = new Set(stale.map(r => r.state));
    return `Every district is one hex of the same size, so 435 seats read as 435 seats and nobody's
      vote looks larger for living somewhere emptier. The layout comes from Census district
      centroids under the 118th Congress, which means the shapes are on <b>2024 boundaries</b>.
      ${stale.length ? `<b>${stale.length} districts across ${states.size} states are hatched.</b>
      Those states redrew their lines for 2026: the forecast uses the new lines, and this map has
      no published shape file to place them with. Their seat count and their forecast are right;
      where they sit on the map is not.` : ''}`;
  },
  'house:geo': () => `Real district boundaries, on <b>2024 lines</b>, simplified so that borders
     shared between two districts stay shared. This is the honest shape of the country and a poor
     way to read an election: small urban districts almost disappear, Montana takes up the room of
     a state, and the two elect the same one member each. That is what the cartogram is for.`,
  'state:hex': () => `One hex per state, all fifty, every one the same size — because that is what
     these offices are. Sizing states by population would draw California at fifty-two times the
     area of Wyoming for the same two Senate seats apiece, which is the opposite of how the chamber
     works. States with no race this cycle are drawn grey rather than dropped, so the map is the
     whole country and not only the part of it voting.`,
  'state:geo': () => `Real geography, and no state boundary file is needed for it: a state is
     exactly the union of its districts, so the district shapes are drawn, filled with the colour
     of that state's race, and the seams between them closed. Land area is not votes — Montana is
     large, Rhode Island is not, and each elects one senator — which is what the cartogram is for.`,
};

// The heading names the unit the map is drawn in, which is the district for the
// House and the state for the other two. It was fixed text saying "The House",
// which is the kind of thing that stops being true the moment a scope control
// appears above it.
const MAP_TITLE = {
  house: 'The House, by district',
  senate: 'The Senate, by state',
  governor: 'Governors, by state',
};

function renderMap(s) {
  const { forecast } = s.data;
  $('#s-map').querySelector('h2').textContent =
    s.scope === 'all' ? 'The country, three ways' : MAP_TITLE[s.scope];
  const ctl = $('#map-controls'); ctl.replaceChildren();
  toggle(ctl, [['hex', 'Cartogram'], ['geo', 'Boundaries']], s.layout,
         v => store.set({ layout: v }), 'Map layout');
  toggle(ctl, Object.entries(cartogramModes).map(([k, m]) => [k, m.label]), s.mapMode,
         v => store.set({ mapMode: v }), 'Shade by');
  const vb = el('button', s.vsup ? 'on chip' : 'chip', 'Suppress uncertain colour');
  vb.setAttribute('aria-pressed', String(s.vsup));
  vb.onclick = () => store.set({ vsup: !s.vsup });
  ctl.append(vb);

  const play = el('button', s.playing ? 'on chip' : 'chip',
    s.playing ? 'Stop' : 'Play simulations');
  play.setAttribute('aria-pressed', String(s.playing));
  play.onclick = () => store.set({ playing: !s.playing });
  ctl.append(play);

  const chambers = chambersFor(s.scope, forecast.meta.chambers);
  const geo = s.layout === 'geo' && s.data.boundaries ? 'geo' : 'hex';
  const caption = [];
  const hopsCells = [];

  perChamber($('#cartogram'), chambers, (host, ch) => {
    const common = {
      races: forecast.races, mode: s.mapMode, showUncertainty: s.vsup,
      cycle: forecast.meta.asof.slice(0, 4), onPick: r => open(r),
    };
    let out;
    if (ch === 'house') {
      const houses = forecast.races.filter(r => r.chamber === 'house');
      out = geo === 'geo'
        ? choropleth(host, { ...common, races: houses, boundaries: s.data.boundaries })
        : cartogram(host, { ...common, races: houses, geo: s.data.geo });
      caption.push(MAP_CAPTION[`house:${geo}`](forecast));
    } else {
      out = geo === 'geo'
        ? stateChoropleth(host, { ...common, chamber: ch,
                                  boundaries: s.data.boundaries, geo: s.data.geo })
        : stateCartogram(host, { ...common, chamber: ch, geo: s.data.geo });
      caption.push(MAP_CAPTION[`state:${geo}`](forecast));
    }
    // The draw-by-draw replay repaints whatever cells were just drawn, so it
    // follows the scope without knowing anything about it.
    hopsCells.push(out.cells);
  });

  // Hypothetical Outcome Plot: the same cells, repainted draw by draw.
  hopsCtl?.stop();
  hopsCtl = hops(hopsCells, s.data.sims, {
    onFrame: (d, seats) => {
      const parts = chambers.map(ch => {
        const n = seats[ch];
        const maj = s.data.sims.m.majority[ch];
        const win = maj != null && n >= maj;
        return `${chamberName(ch)} <b>${n}</b>` + (maj == null ? ''
          : ` <span style="color:${win ? C.dem : C.rep}">${win ? 'majority' : `short of ${maj}`}</span>`);
      });
      $('#hops-read').innerHTML =
        `simulation <b>${(d + 1).toLocaleString()}</b> of ` +
        `${s.data.sims.m.n_sims.toLocaleString()} · ${parts.join(' · ')}`;
    },
  });
  // De-duplicated: under `all` the two statewide maps share a caption, and
  // printing it twice would read as a rendering fault.
  $('#map-caption').innerHTML = [...new Set(caption)].join(' ');
  $('#hops-read').innerHTML = s.playing ? '' :
    'Press <b>Play simulations</b> above to swap the forecast for single runs. Each frame is one ' +
    'complete election night out of 20,000, not an average — and whole regions will swing ' +
    'together from frame to frame, which is the shared national, regional and state error at work.';
  if (s.playing) {
    hopsCtl.start();
    hopsCtl.observe($('#s-map'), () => store.set({ playing: false }));
  }
}

function renderRaces(s) {
  const rows = scopedRaces(s);
  const label = scopeLabel(s);
  beeswarm($('#beeswarm'), { races: rows, scopeLabel: label, onPick: r => open(r) });
  raceTable($('#racetable'), { races: rows, scopeLabel: label, onPick: r => open(r) });
}

function renderCorrelation(s) {
  correlationMatrix($('#correlation'), {
    sims: s.data.sims, races: scopedRaces(s),
    scopeLabel: scopeLabel(s),
    condition: s.condition,
    // From the payload, not retyped here: the page should never be able to quote
    // a calibration the engine no longer ships.
    sigmaState: s.data.forecast.sigma.state,
    onPick: r => open(r),
  });
}

function renderScenario(s) {
  scenarioPanel($('#scenario'), {
    scenarios: s.data.scenarios, environment: s.data.forecast.environment,
    chambers: s.data.forecast.meta.chambers });
}

function renderField(s) {
  playingField($('#playingfield'), { structural: s.data.forecast.structural });
}

function renderStatewide(s) {
  const sf = s.data.forecast.structural;
  statewideField($('#statewide'), {
    statewide: sf.statewide,
    // Passed in so the two panels can be compared in a sentence without this one
    // reaching for the other's numbers behind its back.
    houseBias: sf.now ? sf.now.bias : null,
  });
}

function renderDetail(s) {
  raceDetail($('#drawer'), {
    race: s.detail, forecast: s.data.forecast, sims: s.data.sims,
    condition: s.condition, onPin: r => pin(r), onClose: () => store.set({ detail: null }),
  });
}

function open(race) { store.set({ detail: race }); }

// ---- conditioning -------------------------------------------------------

function pin(race) {
  const { pins: viability, sims } = store.data;
  const v = viability[race.race_id];
  const existing = store.pins.findIndex(p => p.race_id === race.race_id);
  if (existing >= 0) {
    const cur = store.pins[existing];
    const next = cur.party === 'D' ? 'R' : null;
    const pins = store.pins.slice();
    if (next && v && v[next.toLowerCase()] >= viability._meta.floor) {
      pins[existing] = { race_id: race.race_id, party: next };
    } else { pins.splice(existing, 1); }
    store.set({ pins });
    return;
  }
  if (!v || v.col < 0) { flash(`${race.race_id} never flips in any simulation — it cannot be pinned.`); return; }
  const dir = race.win_prob >= 0.5 ? 'R' : 'D';           // pin the interesting way first
  if (v[dir.toLowerCase()] < viability._meta.floor) {
    flash(`${race.race_id} going ${dir} happens in only ${v[dir.toLowerCase()]} of ` +
          `${sims.m.n_sims.toLocaleString()} simulations — below the ${viability._meta.floor}-draw reporting floor.`);
    return;
  }
  store.set({ pins: [...store.pins, { race_id: race.race_id, party: dir }] });
}

function flash(msg) {
  const b = $('#flash');
  b.textContent = msg;
  b.hidden = false;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { b.hidden = true; }, 6000);
}

// The scope control. One per page, in the chrome beside the pins, because every
// tab has something on it that answers to the scope and a control that lived on
// one tab would silently govern the other five.
function renderScopeControl(s) {
  const host = $('#scope-ctl');
  host.replaceChildren();
  host.append(el('span', 'scope-label', 'Showing'));
  toggle(host, SCOPES.map(v => [v, scopeName(v)]), s.scope,
         v => store.set({ scope: v }), 'Which races to show');
}

// Lives in the page chrome rather than on a tab of its own: a pinned race
// re-conditions every number on every tab, so the reader has to be able to see
// that the mode is on, and get out of it, from wherever they happen to be.
function renderPins(s) {
  const host = $('#pins');
  host.replaceChildren();
  const c = s.condition;
  $('#cond-bar').classList.toggle('on', s.pins.length > 0);
  if (!s.pins.length) {
    host.append(el('p', 'hint',
      'Click any race — on a map, on any chart, or in the table — to hold its result fixed. Every '
      + 'number on the page is then re-read from only the simulations where it went that way, '
      + 'which is how to ask questions like "if Republicans hold this seat, what happens to the '
      + 'rest?"'));
    return;
  }
  host.append(el('span', 'pins-label', 'Held fixed'));
  for (const p of s.pins) {
    const chip = el('button', 'pin', `${p.race_id} → ${p.party}`);
    chip.title = 'Click to flip, again to remove';
    chip.onclick = () => pin({ race_id: p.race_id, win_prob: p.party === 'D' ? 0 : 1 });
    host.append(chip);
  }
  const clear = el('button', 'pin clear', 'Clear all');
  clear.onclick = () => store.set({ pins: [] });
  host.append(clear);
  const note = el('p', 'hint',
    c.ok ? `${c.n.toLocaleString()} of ${s.data.sims.m.n_sims.toLocaleString()} simulations match `
           + `what you are holding fixed, and every number on the page is now read from those.`
         : `Only ${c.n} simulations match what you are holding fixed — fewer than the ${c.floor} `
           + `needed to say anything reliable, so the conditional numbers are switched off rather `
           + `than reported from a handful of runs.`);
  host.append(note);
}

// Rendered once: it depends on nothing in the store, and nothing a reader can
// do on this page changes the history of what was published.
function renderTrend(s) {
  trendChart($('#trend'), {
    history: s.data.history,
    chambers: chambersFor(s.scope, s.data.forecast.meta.chambers),
  });
}

// The model's error record is not one evidence base, it is four, drawn from
// different populations -- and the page used to show only the two House replays
// and the poll corpus, which read as "the other chambers have never been
// checked". They had. The Senate's prior ratio was measured against 97 real
// Senate races and deliberately not adopted; the governor sigma was swept across
// the range a fit could return, after a module that asked whether fitting it was
// worth doing at all concluded it was not.
//
// Each card declares which chamber it belongs to and what it was computed on, so
// nothing here can be read as evidence about a chamber it never touched.
const CAL_CARDS = [
  { id: 'reliability', chambers: ['house'], title: 'Does a 70% mean 70%?',
    source: 'House races, 2018 · 2020 · 2022 replays',
    has: f => f.backtest?.calibration,
    draw: (host, f) => reliability(host, { bands: f.backtest.calibration }) },
  { id: 'seatmiss', chambers: ['house'], title: 'What did it say about past elections?',
    source: 'House seat totals, 2018 · 2020 · 2022 replays',
    has: f => f.backtest?.rows,
    draw: (host, f) => seatMisses(host, { rows: f.backtest.rows }) },
  // The one card on any scope: the corpus behind it is polls from all three
  // chambers, so it is evidence about whichever one you are looking at.
  { id: 'loco', chambers: ['house', 'senate', 'governor'], title: 'Are the intervals honest?',
    source: 'polls from all three chambers',
    has: f => f.validation,
    draw: (host, f) => locoChart(host, { loco: f.validation }) },
  { id: 'senate-ratio', chambers: ['senate'], title: 'How much harder is a Senate race to call?',
    source: '97 Senate races, 2018 · 2020 · 2022',
    has: f => f.calibration?.prior?.senate_ratio_fit,
    draw: (host, f) => senateRatio(host, { fit: f.calibration.prior.senate_ratio_fit }) },
  { id: 'gov-sweep', chambers: ['governor'], title: 'What if the governor uncertainty is wrong?',
    source: 'the model re-run at six values of the one uncertainty never fitted',
    // `bound` is the sweep -- named for what the topline card uses it to say
    // (the worst a fit could do), and it carries every point of it.
    has: f => f.topline?.governor?.prior_asserted?.bound?.points,
    draw: (host, f) => governorSweep(host, { sweep: f.topline.governor.prior_asserted.bound }) },
];

function renderCalibration(s) {
  const f = s.data.forecast;
  const want = new Set(chambersFor(s.scope, ['house', 'senate', 'governor']));
  const host = $('#calibration');
  host.replaceChildren();
  for (const c of CAL_CARDS) {
    if (!c.chambers.some(ch => want.has(ch)) || !c.has(f)) continue;
    const box = el('div');
    box.append(el('h3', null, c.title), el('p', 'cal-source', c.source));
    const chart = el('div');
    box.append(chart);
    host.append(box);
    c.draw(chart, f);
  }
}

function renderFlows(s) {
  perChamber($('#flows'), chambersFor(s.scope, s.data.forecast.meta.chambers), (host, ch) => {
    flows(host, {
      races: s.data.forecast.races, chamber: ch,
      unit: CHAMBER_NOUN[ch] || 'races', seat: SEAT_NOUN[ch] || 'seat',
      onPick: r => open(r),
    });
  });
}

// Rendered once: it owns its own step/district state, and re-running it on every
// store change would throw the reader back to step 1 whenever anything else moved.
let wtScope = null;
function renderWalkthrough(s) {
  // Rebuilt only when the set it can pick from actually changes, so moving the
  // seat toggle elsewhere on the page does not throw the reader back to step 1.
  if (wtScope === s.scope) return;
  wtScope = s.scope;
  walkthrough($('#walkthrough'), {
    races: s.data.forecast.races, environment: s.data.forecast.environment,
    forecast: s.data.forecast, initial: 'PA-07',
    chambers: s.scope === 'all' ? s.data.forecast.meta.chambers : [s.scope],
  });
}

function renderLimits(s) {
  limitsPanel($('#limits'), { forecast: s.data.forecast });
}

// The payload has always carried poll coverage broken out by chamber and this
// panel summed it away, so "22 driven by polls" could be 22 of 435 or 22 of 35
// and the reader had no way to tell. Under a chamber scope it reports that
// chamber; under `all` it reports the totals and then the split beneath them.
function renderCoverage(s) {
  const cv = s.data.forecast.coverage;
  const host = $('#coverage'); host.replaceChildren();
  const chambers = s.data.forecast.meta.chambers;
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const one = s.scope !== 'all' ? s.scope : null;

  const races = one ? s.data.forecast.races.filter(r => r.chamber === one).length : cv.races;
  const polled = one ? cv.poll_driven[one] : sum(cv.poll_driven);
  const prior = one ? cv.prior_only[one] : sum(cv.prior_only);
  const stats = [
    [races, one ? `${chamberName(one)} races forecast` : 'races forecast (House + Senate + governors)'],
    [polled, `driven by polls${one ? '' : ', across all three'}`],
    [prior, `run on priors alone${one ? '' : ', across all three'}`],
  ];
  // Boundary staleness is a districting fact, so it is reported only where
  // districts exist rather than being shown under a Senate heading as if it
  // were about Senate seats.
  if (!one || one === 'house') {
    stats.push([cv.stale_boundary, 'districts mapped on 2024 boundaries']);
  }
  stats.push([cv.locked, `same-party generals, settled${one ? ' (all chambers)' : ''}`]);

  for (const [n, label] of stats) {
    const d = el('div', 'stat');
    d.append(el('div', 'n', String(n)), el('div', 'l', label));
    host.append(d);
  }

  if (!one) {
    const t = document.createElement('table');
    t.className = 'plain';
    const head = t.createTHead().insertRow();
    for (const h of ['', 'Races', 'Polled', 'Priors only']) {
      const th = document.createElement('th');
      th.textContent = h;
      if (h && h !== '') th.className = 'num';
      head.append(th);
    }
    const tb = t.createTBody();
    for (const ch of chambers) {
      const tr = tb.insertRow();
      tr.insertCell().innerHTML = `<b>${chamberName(ch)}</b>`;
      for (const v of [cv.poll_driven[ch] + cv.prior_only[ch], cv.poll_driven[ch], cv.prior_only[ch]]) {
        const td = tr.insertCell(); td.className = 'num'; td.textContent = String(v);
      }
    }
    $('#coverage-split').replaceChildren(t);
  } else {
    $('#coverage-split').replaceChildren();
  }
}

// Which bucket an alarm belongs in. This is NOT a severity ranking; it is a
// question about what the alarm is about.
//
//   headline  an assumption baked into a number at the top of this page, or the
//             age of the one input every number on it is downstream of
//   races     a fact about particular contests, true whether or not it is read;
//             the chamber totals are what they are either way
//   data      records dropped or reconciled BEFORE anything was computed, with
//             the resolution stated. No figure on the page rests on that choice
//             having gone the other way.
//
// Eight chips of identical weight taught a reader that "17 polls may be counted
// twice across the two race feeds" and "the Senate probability assumes three
// independents lose" are the same size of problem. The second is worth forty
// points of Senate control and the first is worth nothing you can see.
const RANK = {
  generic_ballot_stale: 'headline',
  generic_ballot_beyond_corpus_support: 'headline',
  governor_zero_poll_coverage: 'headline',
  senate_no_democrat_seats: 'headline',
  thin_poll_average: 'races',
  stale_priors: 'races',
  third_party_share: 'races',
  independent_candidate_races: 'races',
  unresolved_polls: 'data',
  cross_feed_duplicate: 'data',
  incumbency_hand_list_stale: 'data',
  pres_source_margin_mismatch: 'data',
};

// The headline tier gets a sentence and, wherever the payload can supply one, a
// magnitude. An alarm a reader cannot size is an alarm they can only either
// ignore or panic about.
const HEADLINE_SAY = {
  senate_no_democrat_seats: (n, f) => {
    const nb = f.topline.senate && f.topline.senate.no_democrat_bound;
    if (!nb) return [`${n} Senate seats have no Democrat on the ballot.`,
      'The Senate probability assumes their independents lose.'];
    const hi = nb.ladder[String(nb.n_seats)];
    const now = f.topline.senate.control_prob;

    // SCOPED TO THE SENATE RACES THIS NOTE IS ABOUT. `priced` is engine-wide and
    // includes AK-AL, which is a House seat; counting it here produced "2 of 3
    // no-Democrat Senate seats" out of a set of three that does not contain it.
    const priced = nb.races.filter(r => (nb.priced || []).includes(r));
    const held = nb.races.filter(r => !priced.includes(r));
    const list = a => (a.length === 1 ? a[0]
                     : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
    const show = m => `${m >= 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}`;
    const by = {};
    for (const q of (nb.polling || [])) by[q.race_id] = q;
    const line = r => {
      const q = by[r];
      if (!q || q.margin == null) return `<b>${r}</b>`;
      return `<b>${r}</b> ${q.name} ${show(q.margin)} across ${q.n_polls} `
           + `poll${q.n_polls === 1 ? '' : 's'}`
           + (q.spread != null ? ` spanning ${q.spread.toFixed(0)} points` : '');
    };

    const head = priced.length
      ? `${priced.length} of ${nb.n_seats} no-Democrat Senate seats now priced from polling.`
      : `The Senate number assumes ${nb.n_seats} independents lose.`;

    const body =
      `${nb.races.join(', ')} have no Democrat on the ballot and a named independent running. `
      + `All three are polled, and the model reads the polling only where it agrees with itself: `
      + `a spread of six points across four polls is a measurement, and a spread of thirty-nine `
      + `is an average of disagreement. `
      + (priced.length
          ? `${list(priced.map(line))} — ${priced.length === 1 ? 'that one is' : 'those are'} `
            + `priced from ${priced.length === 1 ? 'it' : 'them'} directly, carrying extra `
            + `uncertainty because no fitted error curve in this model covers a contest with one `
            + `major party missing. `
          : '')
      + (held.length
          ? `${list(held.map(line))} — ${held.length === 1 ? 'that one is' : 'those are'} still `
            + `forecast from how the state voted for president, which describes a Democrat who is `
            + `not on the ballot, because ${held.length === 1 ? 'its' : 'their'} polling does not `
            + `hold together well enough to replace it. `
          : '')
      + `If every one of these independents won and caucused with Democrats, Democratic control `
      + `of the Senate would be <b>${fmtPct(hi)}</b> rather than <b>${fmtPct(now)}</b>, so it `
      + `remains the largest single assumption on this page. That they would caucus with `
      + `Democrats is the ballot feed's claim, carried through as stated; an independent who `
      + `caucused with neither would move none of it. Open any of these races for the polling `
      + `itself.`;

    return [head, body];
  },
  governor_zero_poll_coverage: (n, f) => [
    'No governor race has usable polling.',
    `All ${f.topline.governor.of} are forecast from how the state voted for president, the national `
    + 'environment and whether an incumbent is running. Nothing on the governors card has a poll '
    + 'behind it.',
  ],
  generic_ballot_stale: d => [
    `The generic ballot is ${d} days old.`,
    'It is the input every number on this page is downstream of, and the model is carrying it '
    + 'forward from a reading taken that long ago.',
  ],
  generic_ballot_beyond_corpus_support: d => [
    `The generic ballot is ${d} days old \u2014 older than any reading that could be checked against `
    + 'a result.',
    'The corpus the national uncertainty was fitted on does not reach this far from an election, '
    + 'so the width of the interval around it is extrapolated rather than measured.',
  ],
};

function renderCaveats(s) {
  const f = s.data.forecast;
  const host = $('#caveats'); host.replaceChildren();
  const pretty = {
    generic_ballot_stale: d => `Generic ballot is ${d} days stale`,
    governor_zero_poll_coverage: () => 'Governor races have no usable polls',
    pres_source_margin_mismatch: n => `${n} district${n === '1' ? '' : 's'} where the presidential `
      + `source's published margin contradicts its own vote counts \u2014 the counts are used`,
    // This reads as a data fault and is the opposite: the list is kept precisely
    // so that it can be contradicted, and here it was.
    incumbency_hand_list_stale: n => `${n} race${n === '1' ? '' : 's'} where the ballot feed `
      + `overruled the hand-kept incumbency list \u2014 the cross-check working`,
    unresolved_polls: n => `${n} polls could not be resolved to a two-party margin`,
    thin_poll_average: n => `${n} races rest on roughly one poll`,
    stale_priors: n => `${n} districts carry priors from superseded maps`,
    generic_ballot_beyond_corpus_support: d =>
      `Generic ballot ${d} days old \u2014 older than any reading that could be checked against results`,
    third_party_share: n => `${n} polled race${n === '1' ? '' : 's'} where a third candidate `
      + `takes a large share`,
    senate_no_democrat_seats: n => `${n} Senate seats have no Democrat on the ballot \u2014 `
      + `the Senate probability assumes their independents lose`,
    independent_candidate_races: n => `${n} race${n === '1' ? '' : 's'} where the contest is `
      + `Republican vs independent, which a two-party margin does not describe`,
    // "May be counted twice" asserted more than the check found. What it found is
    // a shared race and fieldwork date under two pollster spellings, which is one
    // shop named twice about as often as it is two shops finishing on the same
    // day -- and the engine already merges the pairs the poll itself identifies,
    // by margin and sample size. What is left is the judgement, so the sentence
    // has to be the judgement rather than the conclusion.
    cross_feed_duplicate: n => `${n} poll${n === '1' ? '' : 's'} share a race and fieldwork `
      + `date with a poll from the other feed under a different pollster name`,
  };

  const bucket = { headline: [], races: [], data: [] };
  for (const a of f.freshness.alarms) {
    // `redraw_reverted_MO` carries a LIST OF STATES in its name, and the payload
    // carries the same list as data two keys away. Parsing it back out of the
    // string gave the alarm grammar ("everything ends in a count") an exception
    // that every renderer had to know about, in its own regex. Rendered from
    // forecast.redraw_ratchet below instead.
    if (a.startsWith('redraw_reverted_')) continue;
    const m = a.match(/^(.*?)_(\d+)d?$/);
    const key = m ? m[1] : a;
    const arg = m ? m[2] : null;
    // An alarm this page has never seen lands in `data` and is still shown. A
    // new alarm going unrendered is the failure mode worth designing out; one
    // shown a tier lower than it deserves is a formatting complaint.
    const rank = RANK[key] || 'data';
    if (rank === 'headline' && HEADLINE_SAY[key]) {
      bucket.headline.push(HEADLINE_SAY[key](arg, f));
    } else {
      const fn = pretty[key];
      bucket[rank].push(fn ? fn(arg) : a);
    }
  }
  for (const st of (f.redraw_ratchet && f.redraw_ratchet.reverted) || []) {
    const held = new Set((f.redraw_ratchet.held) || []);
    bucket.races.push(held.has(st)
      ? `${st} was redrawn for 2026 and the presidential source has reverted it to the `
        + `old lines \u2014 its priors are held at the last export that had the redraw`
      : `${st} was redrawn for 2026, but the presidential source has reverted it to the `
        + `old lines and there is no stored snapshot \u2014 its priors are on 2024 boundaries`);
  }
  for (const r of f.electoral_systems.unresolved) {
    bucket.races.push(`${r}: November ballot not established \u2014 forecast anyway, and named`);
  }

  for (const [title, body] of bucket.headline) {
    const d = el('div', 'caveat-major');
    // The title gets its own class rather than being a bare <b>: the body of
    // these carries inline bold of its own -- the two probabilities in the
    // Senate one -- and a display:block rule on the element would break them
    // onto lines of their own.
    d.innerHTML = `<b class="cm-t">${title}</b> ${body}`;
    host.append(d);
  }

  const rest = bucket.races.length + bucket.data.length;
  if (!rest) return;

  // Collapsed, because these are notes rather than news, and because eight of
  // them open used to take the whole fold. Open is one click and the count is on
  // the outside, so nothing is hidden -- it is filed.
  const more = document.createElement('details');
  more.className = 'caveats-more';
  const sum = document.createElement('summary');
  const parts = [];
  if (bucket.races.length) parts.push(`${bucket.races.length} on individual races`);
  if (bucket.data.length) parts.push(`${bucket.data.length} on the data itself`);
  sum.textContent = `${rest} more note${rest === 1 ? '' : 's'} \u2014 ${parts.join(', ')}`;
  more.append(sum);

  for (const [key, label, why] of [
    ['races', 'Individual races',
      'True of particular contests, and already inside the numbers above rather than a reason to '
      + 'doubt them.'],
    ['data', 'Data handling',
      'Records dropped or reconciled before anything was computed. Each says how it was resolved; '
      + 'no figure on this page depends on the choice having gone the other way.'],
  ]) {
    if (!bucket[key].length) continue;
    const g = el('div', 'caveat-group');
    g.append(el('h4', null, label), el('p', 'caveat-why', why));
    const chips = el('div', 'caveats');
    for (const t of bucket[key]) chips.append(el('div', 'caveat', t));
    g.append(chips);
    more.append(g);
  }

  const foot = el('p', 'caveat-why');
  foot.innerHTML = 'These come and go with the data on every run. The limits that do not \u2014 the '
    + 'ones built into the model and waiting on somebody to find the missing data \u2014 are on the '
    + '<a href="#s-limits">Method</a> tab.';
  more.append(foot);
  host.append(more);
}

function renderDiagnostics(s) {
  const { forecast, sims, pins } = s.data;
  const rows = [];
  for (const ch of forecast.meta.chambers) {
    const got = sims.summary(ch, null), want = forecast.topline[ch];
    // Governors have no control probability on either side, so the check is the
    // seat distribution alone. Comparing two nulls with `Math.abs(null - null)`
    // would pass by arithmetic accident rather than by agreeing about anything.
    const probOk = want.control_prob == null
      ? got.control_prob == null
      : Math.abs(got.control_prob - want.control_prob) < 1e-12;
    rows.push([`${ch} reconstructs from sims.bin.gz`,
      probOk && got.median === want.median && got.p10 === want.p10 && got.p90 === want.p90,
      (got.control_prob == null ? 'no control stake' : `P=${got.control_prob.toFixed(5)}`) +
      ` median=${got.median} ${got.p10}–${got.p90}`]);
  }
  rows.push(['draws decoded', true,
    `${sims.m.n_sims.toLocaleString()} × ${sims.m.n_races} races, ${sims.m.row_bytes} B/draw`]);
  rows.push(['pinnable races', true,
    `${pins._meta.both_directions} of ${pins._meta.races} both ways (n≥${pins._meta.floor})`]);
  rows.push(['cartogram layout', Object.keys(s.data.geo.districts).length === 435,
    `${Object.keys(s.data.geo.districts).length} districts · ${s.data.geo.boundaries.split('.')[0]}`]);
  // Every section has to say which races it is about. A chart whose subject is
  // left to be inferred is the failure mode this check exists to catch, and it
  // is the kind that survives review precisely because nothing looks broken.
  const secs = Array.from(document.querySelectorAll('section[id]'));
  const unlabelled = secs.filter(x => !x.querySelector(':scope > .head .scope')?.dataset.set);
  rows.push(['every section declares its scope', unlabelled.length === 0,
    unlabelled.length ? `missing: ${unlabelled.map(x => x.id).join(', ')}`
                      : `${secs.length} sections, ${Object.keys(SECTION_SCOPE).length} declarations`]);

  const t = document.createElement('table'); t.className = 'diag';
  for (const [name, pass, detail] of rows) {
    const tr = t.insertRow();
    tr.insertCell().textContent = name;
    tr.insertCell().innerHTML = `<span class="${pass ? 'pass' : 'fail'}">${pass ? 'ok' : 'FAIL'}</span>  ${detail}`;
  }
  // Monospace diagnostics are wider than a phone; they scroll in their own
  // container so the page body never does.
  const box = el('div', 'scroll-x'); box.append(t);
  const host = $('#diagnostics'); host.replaceChildren(box);
  host.append(el('p', 'chart-note',
    `Pinning a race — holding its winner fixed and re-reading the forecast from only the runs ` +
    `that agree — is done in the browser too, by discarding the runs that disagree. Anything that ` +
    `can be counted from who won survives that exactly: ${Sims.recomputable.yes.join(', ')}. ` +
    `Anything that needs the margins cannot, because margins are not in the payload, so these ` +
    `are frozen at their unpinned values and labelled where they appear: ` +
    `${Sims.recomputable.no.join(', ')}.`));
}

// ---- boot ---------------------------------------------------------------

let hopsCtl = null;
let tabs = null;

// Paint scheduling.
//
// A section on a tab nobody is looking at is not painted: the work is held
// against its tab and run when that tab is first shown. Held work is keyed by
// section, so a pin toggled five times while the map is hidden costs one
// cartogram, not five -- which is the same argument as the `changed` set above,
// carried one step further out.
//
// Not, measurably, a boot-time win: 557ms to first paint against 567ms for the
// single-page version it replaced, because the boot is dominated by fetching and
// decoding the payload rather than by drawing. What it buys is that the drawing
// that does cost something -- 108ms for the race table and swarm, 42ms for the
// playing field and the correlation matrix -- is only ever spent on a panel
// somebody is actually looking at.
const held = new Map();                    // tab id -> Map(section id -> paint fn)

// `key` separates two independent paints that share a section -- the headline
// and the caveat strip beneath it -- so holding one does not discard the other.
function paint(sectionId, fn, key = sectionId) {
  const sec = document.getElementById(sectionId);
  if (!sec || sec.hidden) return;          // not supported by this payload
  const tab = tabs.owner(sectionId);
  if (tab === tabs.current) { fn(); return; }
  let m = held.get(tab);
  if (!m) held.set(tab, m = new Map());
  m.set(key, fn);
}

function flush(tab) {
  const m = held.get(tab);
  if (!m) return;
  held.delete(tab);
  for (const fn of m.values()) fn();
}

// Every section gets a badge slot in its head and a slot for the sentence that
// explains a scope it cannot honour. Built here rather than typed into the HTML
// fifteen times, so a section physically cannot ship without somewhere to say
// what it is about -- and the diagnostics panel checks that all fifteen slots
// were actually filled.
function mountScopeSlots() {
  for (const sec of document.querySelectorAll('section[id]')) {
    let head = sec.querySelector(':scope > .head');
    if (!head) {
      head = el('div', 'head');
      const h2 = sec.querySelector(':scope > h2');
      // The headline section has no h2 -- it opens on the lede. It still needs
      // somewhere to say what it covers, so the head goes in above the lede with
      // the heading slot simply empty.
      if (h2) { h2.replaceWith(head); head.append(h2); } else { sec.prepend(head); }
    }
    // Anything the section already put in its head -- the map's layout toggles --
    // joins the badge on the right rather than being spaced away from it.
    let right = head.querySelector(':scope > .head-right');
    if (!right) {
      right = el('div', 'head-right');
      for (const n of Array.from(head.children)) if (n.tagName !== 'H2') right.append(n);
      head.append(right);
    }
    right.append(el('span', 'scope'));
    const note = el('p', 'scope-note');
    note.hidden = true;
    head.after(note);
  }
}

// Sections a payload may not carry at all. Settled once, before the first paint
// and before the tab strip is built, so a tab with nothing to show loses its
// button rather than offering the reader a blank page.
function applyAvailability(s) {
  $('#s-scenario').hidden = !s.data.scenarios;
  $('#s-field').hidden = !s.data.forecast.structural;
  $('#s-statewide').hidden = !s.data.forecast.structural?.statewide;
}

// Which store keys each panel actually reads. `changed` undefined means the first
// render, when everything runs. The static panels below read only the payload, so
// they are built once and never rebuilt.
function renderAll(s, changed) {
  writeHash(s);
  const t = (...keys) => !changed || keys.some(k => changed.has(k));

  if (t('tab')) {
    // `show` reports the tab it settled on, which is not always the one asked
    // for: a permalink can name a tab this payload pruned. Correct the store to
    // what is actually on screen rather than leaving the two disagreeing.
    const shown = tabs.show(s.tab);
    if (shown !== s.tab) { s.tab = shown; writeHash(s); }
  }

  // Chrome: on screen whichever tab is open, so never held. The badges included
  // -- a label is cheap, and a reader arriving on a tab must never find a heading
  // still advertising the scope it had two changes ago.
  if (t('pins')) renderPins(s);
  if (t('scope')) renderScopeControl(s);
  if (t('scope')) renderScopeTags(s);
  if (t('pins', 'detail')) renderDetail(s);

  if (t('pins', 'scope')) {
    paint('s-headline', () => renderHeadline(s));
    paint('s-movement', () => renderMovement(s));
    paint('s-seats', () => renderSeats(s));
    paint('s-watch', () => renderWatch(s));
    paint('s-path', () => renderPath(s));
    paint('s-correlation', () => renderCorrelation(s));
  }
  if (t('scope')) {
    paint('s-calibration', () => renderCalibration(s));
    paint('s-flows', () => renderFlows(s));
    paint('s-races', () => renderRaces(s));
    paint('s-trend', () => renderTrend(s));
    paint('s-walkthrough', () => renderWalkthrough(s));
    paint('s-coverage', () => renderCoverage(s));
  }
  if (t('scope', 'layout', 'mapMode', 'vsup', 'playing')) paint('s-map', () => renderMap(s));

  if (!changed) {
    paint('s-scenario', () => renderScenario(s));
    paint('s-limits', () => renderLimits(s));
    paint('s-field', () => renderField(s));
    paint('s-statewide', () => renderStatewide(s));
    paint('s-headline', () => renderCaveats(s), 's-headline:caveats');
    paint('s-headline', () => renderEnvironment(s), 's-headline:environment');
    paint('s-diag', () => renderDiagnostics(s));
  }

  flush(s.tab);
}

async function boot() {
  try {
    const data = await loadAll();
    data.geo = await (await fetch('data/geo/cd-hex.json')).json();
    // Optional: the site works without it, showing the cartogram only.
    data.boundaries = await fetch('data/geo/cd-boundaries.json')
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
    store.data = data;
    mountScopeSlots();
    applyAvailability(store);
    tabs = mountTabs({ list: $('#tablist'), onSelect: id => store.set({ tab: id }) });
    tabs.prune();
    tabs.show(store.tab);
    store.subscribe(renderAll);
    $('#asof').textContent =
      `as of ${data.forecast.meta.asof} · ${data.forecast.meta.n_sims.toLocaleString()} simulations`;
    // Section intros quote fitted numbers too. They are filled from the payload
    // rather than typed into the HTML, for the same reason the charts are.
    const cal = {
      'n.sims': data.forecast.meta.n_sims.toLocaleString(),
      'sigma.state': data.forecast.sigma.state,
      'gb.bias': data.forecast.environment.instrument_bias,
      // Signed in the payload, spoken as a magnitude in the sentence around it.
      'field.bias': data.forecast.structural
        ? Math.abs(data.forecast.structural.now.bias) : null,
      // Was the word "nine", typed into index.html from a README sentence fitted
      // at a different environment. It is not a constant: the sweep is steepest
      // where the chamber is closest, so the leverage moves with the forecast,
      // and today's sweep says 13. Computed from scenarios.json for the same
      // reason every other figure on the page is read from the payload.
      'gb.leverage': (() => {
        const v = houseLeverage(data.scenarios);
        return v == null ? null : Math.round(v * 100);
      })(),
    };
    for (const el of document.querySelectorAll('[data-cal]')) {
      const v = cal[el.dataset.cal];
      if (v != null) el.textContent = String(v);
    }
    $('#loading').remove();
    $('#app').hidden = false;
    Object.assign(store, readHash(store));
    store.emit();
    window.__store = store;
    addEventListener('hashchange', () => store.set(readHash(store)));
    addEventListener('keydown', e => { if (e.key === 'Escape') store.set({ detail: null, playing: false }); });
    // A link to a section -- "why" under the governors card points at s-limits --
    // now has to cross a tab boundary. Open the owning tab and scroll, rather
    // than letting the browser write a bare `#s-limits` over a hash this page
    // uses to carry the whole view.
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#s-"]');
      if (!a) return;
      const id = a.getAttribute('href').slice(1);
      if (!tabs.owner(id)) return;
      e.preventDefault();
      store.set({ tab: tabs.owner(id) });
      document.getElementById(id).scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  } catch (e) {
    // #loading is removed before the first render, so a failure AFTER that point
    // used to die in here trying to write to null -- masking the real error with
    // a useless one. Put the box back if it has gone.
    let box = $('#loading');
    if (!box) {
      box = document.createElement('div');
      box.id = 'loading';
      box.style.padding = '2rem 0';
      document.querySelector('main').prepend(box);
    }
    box.innerHTML =
      `<p style="color:${C.rep}"><strong>Could not load the forecast.</strong><br>${e.message}</p>
       <p style="color:${C.muted}">This page uses ES modules and <code>fetch</code>, so it must be served
       over HTTP — <code>python3 -m http.server -d docs 8000</code> — not opened from the filesystem.</p>`;
    throw e;
  }
}

boot();
