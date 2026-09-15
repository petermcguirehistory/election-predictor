// State store and composition.
//
// Every panel reads one store and re-renders on change, so a pinned race
// propagates everywhere at once rather than each chart holding its own copy of
// the condition.

import { loadAll, Sims } from './data.js';
import { C, fmtPct, fmtMargin, chamberName, SCOPES, scopeName, chambersFor } from './charts/util.js';
import { iconArray } from './charts/iconarray.js';
import { dotplot } from './charts/dotplot.js';
import { seatCurve } from './charts/seatcurve.js';
import { jointChambers, cheapestPath } from './charts/chambers.js';
import { movers as moversChart } from './charts/movers.js';
import { ahead } from './charts/ahead.js';
import { seatStrip } from './charts/seatstrip.js';
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
         governorPrior } from './charts/calibration.js';
import { trendChart } from './charts/trend.js';
import { limitsPanel } from './panels/limits.js';
import { alarmKind } from './alarms.js';
import { playingField, statewideField } from './panels/playingfield.js';
import { walkthrough } from './panels/walkthrough.js';
import { watchlist } from './panels/watchlist.js';
import { flipsPanel } from './panels/flips.js';
import { movementPanel } from './panels/movement.js';
import { environmentStrip, houseLeverage } from './panels/environment.js';
import { sparkline } from './charts/sparkline.js';
import { baseline, series } from './history.js';
import { mountTabs } from './tabs.js';
import { mountToc } from './toc.js';
import { mountGlossary, auditTerms, term } from './glossary.js';

const store = {
  data: null, pins: [], scope: 'all', mapMode: 'prob', vsup: true,
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
// `scope` MUST match the store's initial value above. writeHash omits a key
// exactly when it holds its default and readHash supplies the default when the
// key is absent, so a disagreement between the two means the page opens on one
// scope and an empty hash reads back as another — the lossy round trip of
// finding 40, in the one place it cannot be seen without a link to compare.
const TAB_MOVED = { map: 'seats', races: 'seats', flips: 'seats', drivers: 'whatif',
                    record: 'trust', method: 'trust' };
const HASH_DEFAULT = { tab: 'forecast', scope: 'all', layout: 'hex', mapMode: 'prob', vsup: true };

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
  // The page had seven tabs before it had five, and it was public under both. A
  // link to a retired tab opens the tab its sections moved to rather than the
  // first tab, which is what `tabs.show` would otherwise fall back on.
  if (TAB_MOVED[patch.tab]) patch.tab = TAB_MOVED[patch.tab];

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
  's-movers': { kind: 'pooled' },
  's-ahead': { kind: 'fixed', can: ['house', 'senate', 'governor'],
    label: 'All three chambers',
    why: 'The feeds supply every chamber, so what is still to arrive is not a per-chamber fact.' },
  's-seats': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  // Governors too. They were left out because the strip puts the majority on a
  // seat and 36 governorships have none -- but the strip also answers which
  // offices lean which way, and that needs no line. Their strip draws none.
  's-snake': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  // Pooled, and under `all` that is the point of it: every chamber's flips ranked
  // against each other on the one quantity they share.
  's-flips': { kind: 'pooled' },
  's-together': { kind: 'fixed', can: ['house', 'senate'],
    label: 'House · Senate',
    why: 'This is about the two chambers as a pair, so it shows both whatever the scope says. '
       + 'Governors confer no majority and have no threshold to be on either side of.' },
  's-watch': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-map': { kind: 'follows', can: ['house', 'senate', 'governor'] },
  's-races': { kind: 'pooled' },
  's-scenario': { kind: 'fixed', can: ['house', 'senate', 'governor'],
    label: 'All three chambers',
    why: 'The sweep re-simulates every chamber at every stop.' },
  's-field': { kind: 'fixed', can: ['house'],
    why: 'Only the House has districts, so only the House has a districting tilt to measure. The '
       + 'Senate and governors have their own version in the next section, kept separate: district '
       + 'lines are drawn and redrawn, state borders are not.' },
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
      // "All three" only when the section can do all three: the seat strip draws
      // two, and a badge claiming governors over it would be false.
      text = drawn.length === d.can.length
           ? (d.can.length === 3 ? 'All three chambers' : d.can.map(chamberName).join(' · '))
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
function movement(bl, ch, lead = 'D') {
  if (!bl) return null;
  const ser = series(bl.run, ch, lead);
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
  // Already the lead's own series (see `movement`); this used to flip the
  // Democratic one, which is only Republicans' when nobody else can win.
  const { values, from, to } = mv;
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
  return contested.reduce((a, b) => (settled(stateOf(a)) <= settled(stateOf(b)) ? a : b));
}

// How settled a chamber's control is: the likelier party's probability. This was
// distance from 50%, which stopped meaning anything once control had a third
// outcome -- a Senate at D 41 / R 49.5 / independents 9.5 is further from 50% than
// a coin flip and less settled than one.
function settled(t) {
  return Math.max(t.control_prob, t.r_control_prob);
}

// The likelier party, and its probability. Not `control_prob >= 0.5`: with a
// third outcome neither party need be past half, and 1 - P(D) is not P(R).
function leader(t) {
  return t.control_prob >= t.r_control_prob
    ? { lead: 'D', p: t.control_prob } : { lead: 'R', p: t.r_control_prob };
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
      ? ` <span class="icon-why">The ${chName}: the least settled chamber.</span>`
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
               `No probability of control: ${of} governorships confer no collective ` +
               `majority.${cond}${why}`,
      });
    } else {
      // Three blocks where the draws have three outcomes. Rounded per block and the
      // Republican block takes the remainder, so the hundred always adds up.
      const kd = Math.round(st.control_prob * 100);
      const ku = Math.round(st.undecided_prob * 100);
      const kr = 100 - kd - ku;
      iconArray(host, {
        n: 100, k: kd, mid: ku, cols: 20,
        unit: `simulated elections won by Democrats in the ${chName}`,
        midUnit: 'where neither party reached its number and independents decided',
        label: `In <b>100</b> simulated elections, Democrats won the ${chName} in ` +
               `<b>${kd}</b> and Republicans in <b>${kr}</b>` +
               (ku ? `. In <b>${ku}</b> neither party reached its number, and the ` +
                     `independents decided` : '') +
               `.${cond}${why}`,
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
    return leader(st).lead === 'D'
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
    const lead = p == null ? null : leader(st).lead;

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
      const pf = base.prior_fitted;
      if (pf) {
        // Measured, with what it replaced: a held-out error means little alone.
        const note = el('div', 'seats prior-fit');
        note.innerHTML = `Governor prior fitted on <b>${pf.n}</b> past races: misses by ` +
          `<b>${pf.loco_rmse.M2.all.toFixed(1)}</b> pts held out, against ` +
          `${pf.loco_rmse.M0.all.toFixed(1)} for lean + incumbency. ` +
          `<a href="#s-calibration">how</a>`;
        card.append(note);
      }
      card.append(cardLinks(cc));
      cards.append(card);
      continue;
    }

    face.append(el('div', `prob ${lead === 'D' ? 'd' : 'r'}`, fmtPct(leader(st).p)));
    face.append(el('div', 'who',
      `${lead === 'D' ? 'Democrats' : 'Republicans'} favoured` +
      (live && c.pinned
        ? ` \u00b7 n=${live.n.toLocaleString()} (\u00b1${((lead === 'D' ? live.se : live.se_r) * 100).toFixed(1)} pts)`
        : '')));
    // A conditioned probability is not a point in the published series, so there
    // is nothing honest to compare it with; the movement row is dropped rather
    // than left showing the unconditional one beside a conditional number.
    if (!(live && c.pinned)) face.append(movementRow(movement(bl, cc, lead), cc, lead));
    card.append(face);

    const seats = el('div', 'seats');
    seats.append(document.createTextNode('median '));
    seats.append(goButton(String(live ? live.median : base.median), 'tl-inline', 's-seats',
      { scope: cc }, 'See the whole distribution these seat totals came from'));
    seats.append(document.createTextNode(' D seats \u00b7 '));
    const r = el('span'); r.innerHTML = range; seats.append(r);
    seats.append(document.createTextNode(' \u00b7 '));
    seats.append(goButton(String(base.threshold), 'tl-inline', 's-snake',
      { scope: cc }, 'See the seat that sits on the majority line'));
    seats.append(document.createTextNode(' to control'));
    card.append(seats);

    // THE WHOLE SPLIT, on every card with control to win. The big number is the
    // likelier party's; this line is the rest of it, because 100 minus that number
    // is not the other party's chance once independents can decide the chamber.
    // From the same state as the big number, so it follows a pin.
    const split = el('div', 'seats split3');
    split.innerHTML = `Democrats <b>${fmtPct(st.control_prob)}</b> \u00b7 Republicans ` +
      `<b>${fmtPct(st.r_control_prob)}</b>` +
      (st.undecided_prob > 0
        ? ` \u00b7 independents decide <b>${fmtPct(st.undecided_prob)}</b>` : '');
    card.append(split);

    // The seats with no Democrat running. Hidden while a scenario is pinned: the
    // ladder is computed on the unconditional simulation, so pairing it with a
    // conditioned probability would compare two different things. The guard is
    // `live && c.pinned`, not `!live` -- `live` exists on every load, and `!live`
    // hid this note from the page entirely until 2026-09-15.
    const nb = base.no_democrat_bound;
    if (nb && !(live && c.pinned)) {
      const hi = nb.ladder[String(nb.n_seats)];
      const note = el('div', 'seats');
      note.innerHTML = `<b>${nb.n_seats}</b> seats have no Democrat running ` +
        `(${nb.races.join(', ')}); an independent\u2019s win there counts for neither party ` +
        `\u00b7 all ${nb.n_seats} as Democratic seats: <b>${fmtPct(hi)}</b>`;
      card.append(note);
    }

    // The third outcome, named, for any independent whose seat decides the chamber
    // often enough to matter -- the engine's MATERIAL_PTS decides which, so this
    // names no race. The card the page is scoped to also gets what each caucus
    // choice would do; the others get the fact once.
    //
    // `decides` is this seat's own share of the undecided draws, not the chamber's
    // total, so a sentence naming one independent carries only their part of it.
    const scen = nb && nb.caucus_scenarios;
    if (scen && !(live && c.pinned)) {
      const who = {};
      for (const q of (nb.polling || [])) who[q.race_id] = q.name;
      const open = cc === s.scope;
      const chName = chamberName(cc);
      // Thresholds from the payload. They differ only where one party holds the
      // tiebreak, and the sentence says so only then.
      const tb = base.r_threshold < base.threshold
        ? ` ${base.threshold} for Democrats, ${base.r_threshold} for Republicans, who hold the ` +
          `Vice President\u2019s tiebreak`
        : ` ${base.threshold} for either`;
      for (const [rid, sn] of Object.entries(scen).sort((x, y) => y[1].decides - x[1].decides)) {
        const name = who[rid] || `the independent in ${rid}`;
        const third = el('div', `seats third${open ? ' open' : ''}`);
        third.innerHTML = open
          ? `<b>Third outcome</b> \u2014 in <b>${fmtPct(sn.decides)}</b> of runs ${name} wins ` +
            `${rid} and neither party reaches its number:${tb}. ${name}\u2019s vote then ` +
            `decides who organises the ${chName}. No independent\u2019s win is counted for ` +
            `either party.` +
            `<span class="tie">If ${name} sided with Democrats, their chance of control would ` +
            `be ${fmtPct(sn.caucus_dem.d)}. If ${name} sided with Republicans, theirs would be ` +
            `${fmtPct(sn.caucus_rep.r)}.</span>`
          : `<b>Third outcome</b> \u2014 in <b>${fmtPct(sn.decides)}</b> of runs neither party ` +
            `reaches its number and ${name} (${rid}) decides who controls the ${chName}.`;
        card.append(third);
      }
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
    goButton('Flips', 'tl-link', 's-flips', { scope: cc }),
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
      ? `No movement: the previous run used a different method. `
      : `No published history yet. `;
  } else {
    note.innerHTML =
      `Movement since <b>${SHORT_DATE(bl.base.asof)}</b> (${bl.days} days), over ` +
      `<b>${bl.run.length}</b> comparable runs` +
      (bl.blocked
        ? `; before ${SHORT_DATE(bl.run[0].asof)} ${bl.blocked.state === 'broken'
            ? 'the method changed' : 'runs recorded no provenance'}. `
        : '. ');
  }
  const a = el('a', null, 'Full history \u2192');
  a.href = '#s-trend';
  note.append(a);
}

function renderMovement(s) {
  // No comparable pair is a fact about the runs, not about any one chamber: said
  // once, not once per chamber.
  const mv = s.data.forecast.movement;
  if (mv && !mv.available) {
    $('#movement').replaceChildren(el('p', 'mv-none', mv.reason));
    return;
  }
  perChamber($('#movement'), chambersFor(s.scope, s.data.forecast.meta.chambers),
    (host, ch) => movementPanel(host, {
      movement: s.data.forecast.movement, chamber: ch, chamberLabel: chamberName(ch),
    }));
}

// Which reading of the seat distribution is on screen. Per-reader and
// remembered, like the drawer width: it is a preference about how someone likes
// to read a chart, not a fact about the forecast, so it does not belong in a
// link.
let _seatMode = null;
function seatMode() {
  if (_seatMode === null) {
    try { _seatMode = localStorage.getItem('seat-mode') || 'dots'; } catch { _seatMode = 'dots'; }
  }
  return _seatMode;
}
function mountSeatModes(onChange) {
  const box = $('#seat-modes');
  if (!box) return;
  const note = $('#seat-mode-note');
  const paint = () => {
    for (const b of box.querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.mode === seatMode());
    }
    if (note) {
      note.textContent = seatMode() === 'curve'
        ? 'Every height is P(at least this many seats). Read across from any seat number.'
        : '100 dots, one per percentile of the simulations: dots past the line ÷ 100 = P(control).';
    }
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.dataset.mode === seatMode()) return;
    _seatMode = b.dataset.mode;
    try { localStorage.setItem('seat-mode', _seatMode); } catch { /* ignore */ }
    paint();
    onChange();
  });
  paint();
}

function renderTogether(s) {
  const { forecast, sims } = s.data;
  const c = s.condition;
  const host = $('#together');
  host.replaceChildren();
  const q = jointChambers(host, { sims, forecast, idx: c.ok ? c.idx : null });
  if (!q) return;

  // The independence comparison is the reason this chart is here, so it is the
  // sentence under it rather than a note somewhere else.
  const ph = forecast.topline.house.control_prob;
  const ps = forecast.topline.senate.control_prob;
  const naive = ph * ps;
  const note = el('p', 'chart-note');
  note.innerHTML =
    `Democrats take both in <b>${fmtPct(q.both, 1)}</b> of runs, against `
    + `<code>P(House) &times; P(Senate) = ${fmtPct(naive, 1)}</code> if the chambers were `
    + `independent. A national polling miss moves both.`
    // `ok` is true whenever there are enough draws, which is true of every run
    // with nothing pinned at all. `pinned` is the question being asked here.
    + (c.pinned && c.ok ? `<br><br><b>Counted over your pinned draws.</b>` : '');
  host.append(note);

  // What the trailing side needs, in the chamber that is actually in doubt.
  const cheap = $('#cheapest');
  cheap.replaceChildren();
  const tight = ['senate', 'house']
    .filter(ch => forecast.topline[ch].control_prob != null)
    .sort((a, b) => settled(forecast.topline[a]) - settled(forecast.topline[b]))[0];
  const path = cheapestPath(cheap, { sims, forecast, races: forecast.races, chamber: tight });
  if (!path) return;
  const who = path.behind === 'D' ? 'Democrats' : 'Republicans';
  const name = tight === 'house' ? 'the House' : 'the Senate';
  const h4 = el('h4', 'dt-h', `What ${who} still need in ${name}`);
  const list = el('div', 'cheap');
  list.innerHTML = path.pool.map(r => {
    const w = Math.max(2, r.p * 100);
    return `<button class="cheap-row" data-race="${r.race_id}">`
      + `<span class="cheap-id">${r.race_id}</span>`
      + `<span class="cheap-bar"><i style="width:${w.toFixed(1)}%"></i></span>`
      + `<span class="cheap-p">${fmtPct(r.p, 0)}</span></button>`;
  }).join('');
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-race]');
    if (!b) return;
    const race = forecast.races.find(r => r.race_id === b.dataset.race);
    if (race) open(race);
  });
  const foot = el('p', 'chart-note');
  foot.innerHTML = `Median <b>${path.median}</b>, <b>${path.need}</b> short. Seats they do not `
    + `yet favour, closest first.`;
  cheap.append(h4, list, foot);
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
  // TWO READINGS OF THE SAME DISTRIBUTION, and the dotplot stays the default.
  // It is countable on purpose: Kay et al. (CHI 2018) found discrete outcomes
  // beat density displays for a threshold decision, which is what a majority
  // line is. The curve answers what the dots cannot — the chance of AT LEAST any
  // number, not only the one that wins — so it is offered rather than swapped in.
  const mode = seatMode();
  perChamber($('#dotplot'), chambersFor(s.scope, forecast.meta.chambers), (host, ch) => {
    const live = c.ok ? sims.summary(ch, c.idx) : null;
    const kind = forecast.topline[ch].threshold == null ? 'no-line' : 'line';
    if (mode === 'curve') {
      seatCurve(host, {
        hist: live ? live.hist : forecast.seats[ch],
        threshold: forecast.topline[ch].threshold ?? null,
        n: live ? live.n : forecast.meta.n_sims,
        chamber: ch, unit: UNIT[ch] || 'Democratic seats',
      });
      return;
    }
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
  });
}

// ---- every seat, in order ------------------------------------------------

function renderSnake(s) {
  const { forecast, sims } = s.data;
  const c = s.condition;
  const live = c.ok && c.pinned;
  perChamber($('#snake'), chambersFor(s.scope, ['house', 'senate', 'governor']), (host, ch) => {
    const races = forecast.races.filter(r => r.chamber === ch);
    // A chamber with a majority must be drawn whole, or its line lands on the wrong
    // seat, so it needs its size from the payload. One with no majority to reach --
    // governors -- has no line to misplace and is drawn as the offices on the
    // ballot, with `needs` null so the strip outlines nothing.
    const needs = sims.m.needs[ch] || null;
    const size = needs ? sims.m.size && sims.m.size[ch] : races.length;
    if (!size) {
      host.append(el('p', 'chart-note', `No chamber size in this payload for the ${chamberName(ch)}.`));
      return;
    }
    seatStrip(host, {
      races, size, needs, heldD: sims.m.offsets[ch] || 0,
      chamber: ch, chamberLabel: chamberName(ch),
      prob: live ? r => sims.winProb(r.race_id, c.idx) ?? r.win_prob : undefined,
      frozen: live,
      onPick: r => open(r),
    });
  });
}

// ---- seats that could change hands ---------------------------------------

function renderFlips(s) {
  flipsPanel($('#flips'), {
    races: scopedRaces(s),
    chambers: chambersFor(s.scope, s.data.forecast.meta.chambers),
    sims: s.data.sims, condition: s.condition,
    onPick: r => open(r),
  });
}

// ---- the races the answer rests on --------------------------------------

function renderWatch(s) {
  const { forecast, sims } = s.data;
  const byId = new Map(forecast.races.map(r => [r.race_id, r]));
  perChamber($('#watch'), chambersFor(s.scope, forecast.meta.chambers), (host, ch) => {
    const list = el('div');
    host.append(list);
    watchlist(list, {
      races: forecast.races.filter(r => r.chamber === ch),
      chamber: ch,
      chamberLabel: chamberName(ch),
      tipping: forecast.tipping[ch] || null,
      sims,
      condition: s.condition,
      onPick: r => open(r),
    });
    // The distribution behind the ranking, moved here from the retired "Path to a
    // majority". Governors have none, and the list above already says why, so the
    // chart's own no-majority note would only repeat it.
    const tip = forecast.tipping[ch];
    if (!tip || !tip.distribution) return;
    const box = el('div', 'wl-tip');
    box.append(el('h4', 'wl-h', 'How the deciding vote is spread'));
    const chart = el('div');
    box.append(chart);
    host.append(box);
    tippingChart(chart, {
      distribution: tip.distribution, chamber: chamberName(ch), byId,
      frozen: s.condition.pinned, onPick: r => open(r),
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
    return `One equal hex per district, placed on 2024 lines.
      ${stale.length ? `Hatched: <b>${stale.length} districts in ${states.size} states</b> that
      redrew for 2026 \u2014 forecast on the new lines, placed on the old.` : ''}`;
  },
  'house:geo': () => `District boundaries on 2024 lines. Area is not votes: use the cartogram to
     read seats.`,
  'state:hex': () => `One hex per state. Grey: no race this cycle.`,
  'state:geo': () => `State shapes. Area is not votes: use the cartogram to read seats.`,
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
        const sm = s.data.sims.m;
        const need = sm.needs[ch];
        if (!need) return `${chamberName(ch)} <b>${n}</b>`;
        // Whose chamber this draw is: D at its number, R at its number, or
        // neither, in which case the independents hold the balance.
        const r = sm.size[ch] - n - s.data.sims.ind[ch][d];
        const out = n >= need.D ? ['Democratic control', C.dem]
          : r >= need.R ? ['Republican control', C.rep]
          : ['independents decide', C.accent];
        return `${chamberName(ch)} <b>${n}</b> D` +
          ` <span style="color:${out[1]}">${out[0]}</span>`;
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
    `<b>Play simulations</b>: whole regions swing together between frames \u2014 shared error.`;
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
      'Click any race — on a map, on a chart, in the table — to hold its result fixed. Every number '
      + 'on the page is then re-read from only the simulations where it went that way. That answers '
      + 'questions of the form: if Republicans hold this seat, what happens to the rest?'));
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
  { id: 'gov-prior', chambers: ['governor'], title: 'How good is the governor prior?',
    source: 'polled governor generals, 2000–2022, each cycle held out',
    has: f => f.topline?.governor?.prior_fitted?.loco_rmse,
    draw: (host, f) => governorPrior(host, { fit: f.topline.governor.prior_fitted }) },
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
//   checks    one of the engine's checks on its own inputs FAILED this run. Not
//             "reconciled" -- something is not working, and the note says what it
//             touches. `ban_list_empty` filed under "data" would have told a reader
//             a disabled fabricated-data filter was routine housekeeping.
//
// Every kind the engine can raise must appear here, in HEADLINE_SAY or CHIP, and
// in limits.js's ALARM table. engine/dashboard/build.py fails the build otherwise:
// an alarm with no text used to render as its raw key, and `independent_priced_2`
// shipped that way.
//
// Eight chips of identical weight taught a reader that "17 polls may be counted
// twice across the two race feeds" and "the Senate probability assumes three
// independents lose" are the same size of problem. The second is worth forty
// points of Senate control and the first is worth nothing you can see.
const RANK = {
  feed_stopped: 'headline',
  feed_not_refetched: 'headline',
  generic_ballot_stale: 'headline',
  generic_ballot_beyond_corpus_support: 'headline',
  house_zero_poll_coverage: 'headline',
  senate_zero_poll_coverage: 'headline',
  governor_zero_poll_coverage: 'headline',
  senate_no_democrat_seats: 'headline',
  race_feed_union_empty: 'headline',
  ban_list_empty: 'headline',
  thin_poll_average: 'races',
  stale_priors: 'races',
  third_party_share: 'races',
  independent_candidate_races: 'races',
  independent_priced: 'races',
  cross_feed_duplicate: 'data',
  incumbency_feed_uncovered: 'data',
  pres_source_margin_mismatch: 'data',
  ballot_poll_unresolved: 'checks',
  banned_name_near_miss: 'checks',
  fundraising_absent: 'checks',
  fundraising_share_level_out_of_range: 'checks',
  prior_sigma_no_provenance: 'checks',
  prior_sigma_stale: 'checks',
  prior_sigma_stale_acknowledgement: 'checks',
  independent_dispersion_unavailable: 'checks',
};

// Rendered from the payload rather than from the alarm string; see renderCaveats.
const RENDERED_ELSEWHERE = new Set(['redraw_reverted']);

const HEADLINE_SAY = {
  senate_no_democrat_seats: (n, f) => {
    const nb = f.topline.senate && f.topline.senate.no_democrat_bound;
    if (!nb) return [`${n} Senate seats have no Democrat on the ballot.`,
      'An independent\u2019s win in any of them counts for neither party.'];
    const priced = nb.races.filter(r => (nb.priced || []).includes(r));
    const held = nb.races.filter(r => !priced.includes(r));
    const list = a => (a.length === 1 ? a[0]
                     : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
    const by = {};
    for (const q of (nb.polling || [])) by[q.race_id] = q;
    const spread = r => (by[r] && by[r].spread != null
      ? `${by[r].n_polls} polls, ${by[r].spread.toFixed(0)} pts apart` : 'too few polls');

    // ONE LINE PER CLAIM, not one paragraph carrying all of them. This was a
    // single 900-character run of prose whose most consequential figure -- what
    // the caucus decision is worth -- arrived last, after two subordinate
    // clauses about polling spread. A reader looking for one of these four facts
    // now finds it without reading the other three.
    //
    // Sorted by what each is worth rather than by key order, and all of them are
    // rendered: the engine's own MATERIAL_PTS threshold already decided which
    // races are consequential enough to be here, so taking only the first would
    // silently drop a second seat that had cleared the same bar.
    const sc = nb.caucus_scenarios || {};
    const pts = [];
    if (priced.length) {
      pts.push(`<b>Priced from polling</b> — ${list(priced.map(r => `${r} (${spread(r)})`))}.`);
    }
    if (held.length) {
      pts.push(`<b>On the prior</b> — ${list(held.map(r => `${r} (${spread(r)})`))}: polls too `
        + `scattered to use.`);
    }
    // Each material caucus choice through the headline's own three-way split.
    for (const [rid, sn] of Object.entries(sc).sort((a, b) => b[1].decides - a[1].decides)) {
      const who = (by[rid] && by[rid].name) || rid;
      pts.push(`<b>If ${who} caucused</b> — with Democrats, D control <b>${fmtPct(sn.caucus_dem.d, 1)}</b>; `
        + `with Republicans, R control <b>${fmtPct(sn.caucus_rep.r, 1)}</b>.`);
    }

    return [
      `${nb.n_seats} Senate seats have no Democrat on the ballot.`,
      `<ul class="pts">${pts.map(x => `<li>${x}</li>`).join('')}</ul>`,
    ];
  },
  governor_zero_poll_coverage: (n, f) => [
    'No governor race has usable polling.',
    `All ${f.topline.governor.of} run on the prior alone: state presidential lean, national `
    + 'environment, incumbency. No figure on the governors card has a poll behind it.',
  ],
  feed_stopped: (d, f, feed) => {
    const x = ((f.freshness && f.freshness.feeds) || {})[feed] || {};
    return [
      `${x.what || feed} has published nothing new for ${d} days.`,
      `It supplies ${x.used_for || 'part of this forecast'}. That input is carried forward from `
      + `its last reading${x.newest ? `, ${x.newest},` : ''} rather than updated.`,
    ];
  },
  feed_not_refetched: (d, f, feed) => {
    const x = ((f.freshness && f.freshness.feeds) || {})[feed] || {};
    return [
      `The local copy of ${x.what || feed} was last fetched ${d} days ago.`,
      'The source may still be publishing; this run did not download it, so everything it '
      + `supplies is ${d} days behind.`,
    ];
  },
  house_zero_poll_coverage: () => [
    'No House race has usable polling.',
    'Every House race runs on its prior alone: presidential lean, national environment, '
    + 'incumbency, fundraising. No figure on the House card has a district poll behind it.',
  ],
  senate_zero_poll_coverage: () => [
    'No Senate race has usable polling.',
    'Every Senate race runs on its prior alone: state presidential lean, national environment, '
    + 'incumbency. No figure on the Senate card has a poll behind it.',
  ],
  race_feed_union_empty: () => [
    'The second race-poll feed contributed nothing this run.',
    'ElectIndex supplies the only polling in many races. Either its file is stale or '
    + 'de-duplication removed every row, and those races are running on fewer polls or on their '
    + 'prior.',
  ],
  ban_list_empty: () => [
    'The fabricated-data filter is switched off.',
    'The list of pollsters flagged for fabricated data came back empty, so polls it would '
    + 'normally remove are in this forecast.',
  ],
  generic_ballot_stale: d => [
    `The generic ballot is ${d} days old.`,
    `Every number on this page is downstream of it, and the model is carrying a reading taken `
    + `${d} days ago forward to today.`,
  ],
  generic_ballot_beyond_corpus_support: d => [
    `The generic ballot is ${d} days old \u2014 older than any reading that could be checked against `
    + 'a result.',
    'The corpus the national error bar was fitted on stops 60 days out, so the width at '
    + `${d} days is extrapolated from the drift rate rather than measured.`,
  ],
};

const CHIP = {
  generic_ballot_stale: d => `Generic ballot is ${d} days stale`,
  governor_zero_poll_coverage: () => 'Governor races have no usable polls',
  pres_source_margin_mismatch: n => `${n} district${n === '1' ? '' : 's'} where the presidential `
    + `source's published margin contradicts its own vote counts \u2014 the counts are used`,
  incumbency_feed_uncovered: n => `${n} federal race${n === '1' ? '' : 's'} with no `
    + `ballot-feed answer on whether the incumbent is running \u2014 filings used instead`,
  thin_poll_average: n => `${n} races rest on roughly one poll`,
  stale_priors: n => `${n} districts carry priors from superseded maps`,
  generic_ballot_beyond_corpus_support: d =>
    `Generic ballot ${d} days old \u2014 older than any reading that could be checked against results`,
  // Where the third share is a named candidate on the ballot the race is simulated
  // three-way; the rest stay D minus R. The limits panel says which is which.
  third_party_share: n => `${n} polled race${n === '1' ? '' : 's'} where a third candidate `
    + `takes a large share \u2014 named candidates on the ballot are simulated as a third share`,
  senate_no_democrat_seats: n => `${n} Senate seats have no Democrat on the ballot \u2014 `
    + `an independent\u2019s win there counts for neither party`,
  // Not "Republican vs independent": half of the eight this was written over are
  // a Democrat against an independent with no Republican running (AZ-03, MA-01,
  // NJ-08, PA-03). Either party can be the absent one.
  independent_candidate_races: n => `${n} race${n === '1' ? '' : 's'} where an independent `
    + `faces only one major party, which a two-party margin does not describe`,
  independent_priced: (n, f) => {
    const nb = (f.topline.senate && f.topline.senate.no_democrat_bound) || {};
    const who = (nb.priced || []).join(', ');
    return `${n} of them${who ? ` (${who})` : ''} priced from polls of the independent, `
      + `with a wider error bar, instead of the D-vs-R prior`;
  },
  // "May be counted twice" asserted more than the check found. What it found is
  // a shared race and fieldwork date under two pollster spellings, which is one
  // shop named twice about as often as it is two shops finishing on the same
  // day -- and the engine already merges the pairs the poll itself identifies,
  // by margin and sample size. What is left is the judgement, so the sentence
  // has to be the judgement rather than the conclusion.
  cross_feed_duplicate: n => `${n} poll${n === '1' ? '' : 's'} share a race, fieldwork `
    + `date and a margin, sample size or pollster name with a poll from the other feed \u2014 `
    + `both kept`,
  feed_stopped: (d, f, feed) => `${feed} has published nothing new for ${d} days`,
  feed_not_refetched: (d, f, feed) => `${feed} not downloaded for ${d} days`,
  house_zero_poll_coverage: () => 'House races have no usable polls',
  senate_zero_poll_coverage: () => 'Senate races have no usable polls',
  race_feed_union_empty: () => 'The second race-poll feed contributed nothing',
  ban_list_empty: () => 'The fabricated-data filter is empty and removed nothing',
  ballot_poll_unresolved: n => `${n} poll${n === '1' ? '' : 's'} of the actual November matchup `
    + `did not resolve \u2014 a name-matching fault; left out`,
  banned_name_near_miss: n => `${n} pollster ${n === '1' ? 'name nearly matches' : 'names nearly match'} `
    + `a pollster flagged for fabricated data \u2014 not removed`,
  fundraising_absent: () => 'Fundraising term not applied \u2014 House priors rest on '
    + 'presidential lean alone',
  fundraising_share_level_out_of_range: () => "This cycle's fundraising level is outside the "
    + 'cycles the fundraising term was fitted on',
  prior_sigma_no_provenance: () => 'The prior error bar does not record what it was fitted '
    + 'against \u2014 whether it is stale cannot be checked',
  prior_sigma_stale: n => `The prior error bar was fitted against ${n} input${n === '1' ? '' : 's'} `
    + `that have since changed, and has not been refitted`,
  prior_sigma_stale_acknowledgement: () => 'A note deferring a refit of the prior error bar '
    + 'has outlived the problem it described',
  independent_dispersion_unavailable: () => 'Independent-candidate races not priced \u2014 the '
    + 'historical spread they rely on could not be read',
};

function renderCaveats(s) {
  const f = s.data.forecast;
  const host = $('#caveats'); host.replaceChildren();

  const bucket = { headline: [], races: [], data: [], checks: [] };
  for (const a of f.freshness.alarms) {
    // `redraw_reverted_MO` carries a LIST OF STATES in its name, and the payload
    // carries the same list as data two keys away. Rendered from
    // forecast.redraw_ratchet below instead.
    const { key, arg, sub } = alarmKind(a);
    if (RENDERED_ELSEWHERE.has(key)) continue;
    // An alarm this page has never seen lands in `checks` and is still shown. The
    // build refuses to ship one, so reaching this fallback means the payload and the
    // page were built from different trees.
    const rank = RANK[key] || 'checks';
    if (rank === 'headline' && HEADLINE_SAY[key]) {
      bucket.headline.push(HEADLINE_SAY[key](arg, f, sub));
    } else {
      const fn = CHIP[key];
      bucket[rank === 'headline' ? 'checks' : rank].push(fn ? fn(arg, f, sub) : a);
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

  const rest = bucket.races.length + bucket.data.length + bucket.checks.length;
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
  if (bucket.checks.length) parts.push(`${bucket.checks.length} failed check${bucket.checks.length === 1 ? '' : 's'}`);
  sum.textContent = `${rest} more note${rest === 1 ? '' : 's'} \u2014 ${parts.join(', ')}`;
  more.append(sum);

  for (const [key, label, why] of [
    ['checks', 'Checks that failed',
      'Input checks that did not pass this run.'],
    ['races', 'Individual races',
      'Already priced into the numbers above.'],
    ['data', 'Data handling',
      'Records dropped or reconciled before anything was computed.'],
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
  foot.innerHTML = 'Structural limits: <a href="#s-limits">Can you trust it</a>.';
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
    // All three outcomes, each counted: D, R, and the independents deciding.
    const probOk = ['control_prob', 'r_control_prob', 'undecided_prob'].every(k =>
      want[k] == null ? got[k] == null : Math.abs(got[k] - want[k]) < 1e-12);
    rows.push([`${ch} reconstructs from sims.bin.gz`,
      probOk && got.median === want.median && got.p10 === want.p10 && got.p90 === want.p90,
      (got.control_prob == null ? 'no control stake'
        : `D=${got.control_prob.toFixed(5)} R=${got.r_control_prob.toFixed(5)} ` +
          `ind=${got.undecided_prob.toFixed(5)}`) +
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
  // A term whose id is mistyped renders as ordinary text with a dotted underline
  // and no definition behind it, which is invisible to everything except a
  // reader who tries it. Counted here instead.
  const g = auditTerms();
  rows.push(['defined terms resolve', g.undefined.length === 0,
    g.undefined.length ? `no definition for: ${g.undefined.join(', ')}`
                       : `${g.used} in use, ${g.defined} defined`]);

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
  // A DIV, not a p: the list below cannot legally live inside a paragraph, and a
  // browser that meets one there closes the p and leaves the list outside it.
  const rec = el('div', 'chart-note');
  rec.innerHTML =
    `A pin discards every run that disagrees:` +
    `<ul class="pts">` +
    `<li><b>Recomputed</b> — ${Sims.recomputable.yes.join(', ')}.</li>` +
    `<li><b>Frozen</b> (needs margins, not carried) — ${Sims.recomputable.no.join(', ')}.</li>` +
    `</ul>`;
  host.append(rec);
}

// ---- boot ---------------------------------------------------------------

let hopsCtl = null;
let tabs = null;
let toc = null;

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
    paint('s-movers', () => {
      const host = $('#movers');
      const d = s.data.forecast.movers;
      if (!d || !d.races || !d.races.length) {
        host.replaceChildren(el('p', 'chart-note',
          'Not enough runs yet to show how these races have moved.'));
        return;
      }
      moversChart(host, { movers: d, onPick: rid => {
        const race = s.data.forecast.races.find(r => r.race_id === rid);
        if (race) open(race);
      } });
      host.append(el('p', 'chart-note',
        `The ${d.races.length} seats most often the deciding one, over ${d.runs.length} runs, `
        + `ordered by distance travelled. One shared vertical scale across all cards: scaled each `
        + `to its own range, a half-point wobble would draw like a six-point swing. Click any `
        + `card.`));
    });
    paint('s-ahead', () => {
      const f = s.data.forecast;
      const host = $('#ahead');
      const r = ahead(host, { asof: f.meta.asof, cadence: f.freshness.feed_cadence,
                              sigma: f.sigma });
      if (!r) {
        host.replaceChildren(el('p', 'chart-note', 'No cadence measurement available.'));
        return;
      }
      const gb = f.sigma;
      const note = el('p', 'chart-note');
      note.innerHTML =
        `<b>${r.days} days left.</b> Ticks: expected readings, at each feed's own pace. Red: the `
        + `silence after which a feed is called dead.`
        // TWO DIFFERENT AGES, and saying "the generic ballot is 35 days old" while
        // the feed publishes daily reads as a contradiction. The newest poll is
        // days old; the WEIGHTED age of the average is what the model charges
        // for, because the average spans a decaying window rather than the last
        // reading. The distinction is the point of the sentence.
        + (gb && gb.nat_fitted && gb.nat_gb_age_days != null
            ? `<br><br>Newest ${term('generic-ballot')} poll: `
              + `${f.freshness.generic_ballot_age_days} days; weighted age of the average: `
              + `<b>${gb.nat_gb_age_days.toFixed(0)} days</b>, charged as `
              + `<code>σ_nat ${gb.nat_fitted.toFixed(2)} → ${gb.nat.toFixed(2)}</code>.`
            : '');
      host.append(note);
    });
    paint('s-seats', () => renderSeats(s));
    paint('s-snake', () => renderSnake(s));
    paint('s-flips', () => renderFlips(s));
    paint('s-together', () => renderTogether(s));
    paint('s-watch', () => renderWatch(s));
    paint('s-correlation', () => renderCorrelation(s));
  }
  if (t('scope')) {
    paint('s-calibration', () => renderCalibration(s));
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
  // Last, after the paints: a heading can change with the scope, and the scope can
  // remove a section outright, so the rail is read off the page as it now stands.
  toc.refresh(s.tab);
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
    mountGlossary();
    mountSeatModes(() => renderSeats(store));
    tabs = mountTabs({ list: $('#tablist'), onSelect: id => store.set({ tab: id }) });
    tabs.prune();
    tabs.show(store.tab);
    toc = mountToc({ host: $('#toc'), condBar: $('#cond-bar') });
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
