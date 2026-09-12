// Shared scales, colour, and the hover layer.
//
// Party colour is the documented diverging pair (blue <-> red, neutral grey
// midpoint), validated on this page's surface: worst adjacent pair dE 21.2 under
// protanopia, 27.3 under normal vision, both clear of the floors. Hue is never
// the only channel carrying party -- every mark that uses it is also labelled,
// positioned against a baseline, or both.

import d3 from '../d3.js';

export const C = {
  dem: '#5b8fd9', rep: '#e0574a',
  demDeep: '#2f5fa8', repDeep: '#a8342a',
  mid: '#383835',
  surface: '#14171c', bg: '#0c0e11',
  line: '#262b33', ink: '#e9e7e2', dim: '#b6bcc4', muted: '#8b939d', faint: '#5c646e',
  accent: '#d8a657',
};

export const party = p => (p === 'D' ? C.dem : C.rep);
export const fmtPct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
export const fmtMargin = m =>
  m == null ? '—' : `${m > 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}`;

// Diverging ramp, two hues about a neutral grey. Equal steps per arm.
const rampD = d3.interpolateLab(C.mid, '#8fb6ea');
const rampR = d3.interpolateLab(C.mid, '#ef8d82');
export function diverging(t) {           // t in [-1, 1]
  return t >= 0 ? rampD(Math.min(1, t)) : rampR(Math.min(1, -t));
}

// Value-Suppressing Uncertainty Palette (Correll & Moritz, CHI 2018).
//
// Encoding margin in hue alone would render a district the model barely knows
// -- a prior-only seat on a superseded map, total sigma 13 -- exactly as boldly
// as a well-polled one at sigma 5. A VSUP spends the colour range where the
// model has something to say: certain races get many distinguishable steps,
// uncertain ones collapse toward the neutral midpoint and toward each other. The
// map becomes structurally unable to overstate what is known.
export function vsupScale({ domain = 30 } = {}) {
  // Breakpoints come from the model's actual sigma distribution, which is
  // BIMODAL rather than smooth: 302 House districts sit at exactly 6.50 (the
  // flat prior branch), 24 polled ones spread 6.8-10.9, and 101 carry 13.10
  // because their prior was joined across a redraw. A smooth four-level ramp --
  // the first version of this -- spent its resolution on a range nothing
  // occupies and collapsed California and Texas to two indistinguishable bins,
  // which reads as "no data" rather than "less certain". Three levels on the
  // real breaks keep a D+30 seat visibly different from a D+3 one inside the
  // suppressed band, which is the difference the map still has to carry.
  const LEVELS = [
    { max: 7.0, steps: 16, mute: 0.00 },   // prior-only and well-polled
    { max: 10.0, steps: 10, mute: 0.15 },  // thin polling
    { max: Infinity, steps: 6, mute: 0.30 },  // prior joined across a redraw
  ];
  return (value, sigma) => {
    if (value == null) return C.line;
    const L = LEVELS.find(l => (sigma ?? Infinity) <= l.max);
    const t = Math.max(-1, Math.min(1, value / domain));
    const q = (Math.floor(((t + 1) / 2) * L.steps) + 0.5) / L.steps * 2 - 1;
    return d3.interpolateLab(diverging(q), C.surface)(L.mute);
  };
}

// ---- hover layer --------------------------------------------------------
let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.setAttribute('role', 'status');
    document.body.append(tipEl);
  }
  return tipEl;
}
export function showTip(evt, html) {
  const t = tip();
  t.innerHTML = html;
  t.style.display = 'block';
  const r = t.getBoundingClientRect();
  const pad = 12;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
export const hideTip = () => { if (tipEl) tipEl.style.display = 'none'; };

// Attach hover + keyboard focus to a selection. Hit targets are the marks
// themselves plus an invisible overlay where marks are smaller than 8px.
export function hoverable(sel, html) {
  sel.on('pointerenter', (e, d) => showTip(e, html(d)))
     .on('pointermove', (e, d) => showTip(e, html(d)))
     .on('pointerleave', hideTip)
     .attr('tabindex', 0)
     .on('focus', function (e, d) {
       const b = this.getBoundingClientRect();
       showTip({ clientX: b.x + b.width / 2, clientY: b.y }, html(d));
     })
     .on('blur', hideTip);
  return sel;
}

export function svg(host, width, height, label) {
  const s = d3.select(host).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', label)
    .style('display', 'block')
    .style('overflow', 'visible');
  return s;
}

// `hatch` renders the texture in CSS -- an SVG `url(#pattern)` reference does
// not resolve from an HTML element, so the swatch came out empty.
export function legendSwatch(label, color, note, hatch = false) {
  const d = document.createElement('span');
  d.className = 'key';
  const style = hatch
    ? `background:repeating-linear-gradient(45deg,${color} 0 2px,transparent 2px 4px),${C.surface}`
    : `background:${color}`;
  d.innerHTML = `<i style="${style}"></i>${label}` + (note ? `<em>${note}</em>` : '');
  return d;
}


// Chamber display names. Here rather than in main.js because three surfaces need
// them -- the topline cards, the seat toggle and the race-table filter -- and the
// third one was a hardcoded list that had to be remembered when governors landed.
export const CHAMBER_NAME = { house: 'House', senate: 'Senate', governor: 'Governors' };
export const chamberName = c => CHAMBER_NAME[c] || c;

// ---- scope --------------------------------------------------------------
// One vocabulary for "which races is this about", shared by the scope control,
// every chart that answers to it, and every badge that reports what a chart
// settled on. `all` is a fourth value rather than a missing one: some panels
// (the swarm, the table, the correlation matrix) are genuinely cross-chamber and
// pool under it, and the rest render one instance per chamber they support.
export const SCOPES = ['all', 'house', 'senate', 'governor'];
export const SCOPE_NAME = { all: 'All races', ...CHAMBER_NAME };
export const scopeName = v => SCOPE_NAME[v] || v;

// The chambers a `follows` panel should draw for a given scope, given the ones
// it can do at all. This is the single place the "all means one of each" rule
// lives; no panel reimplements it.
export const chambersFor = (scope, can) => (scope === 'all' ? can : can.filter(c => c === scope));

// Democratic seats already banked before a single contested race is counted:
// Senate holdovers, plus the seats the simulator never sampled because they
// cannot flip. A chamber's snake ranks only the races on the ballot, so its
// majority line has to be the majority MINUS what is already held -- 51 becomes
// seat 17 of 35 for the Senate, which is meaningless unless it is said.
export function contestedThreshold(sims, chamber) {
  const maj = sims.m.majority;
  if (!Object.prototype.hasOwnProperty.call(maj, chamber)) return null;
  return maj[chamber] - (sims.m.offsets[chamber] || 0);
}
