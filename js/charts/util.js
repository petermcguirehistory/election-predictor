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

// A hover tooltip on a touch screen has no hover to end. `pointerleave` does
// fire for a touch pointer, but only when the finger lifts -- and not at all if
// the gesture turns into a scroll, which leaves the tip pinned over the chart
// with no way to dismiss it. Scrolling and the next touch elsewhere both clear
// it. Capture, because the scroll happens inside .chart-scroll rather than on
// the window.
addEventListener('scroll', hideTip, { passive: true, capture: true });
addEventListener('pointerdown', e => {
  if (tipEl && tipEl.style.display === 'block' && e.pointerType !== 'mouse') hideTip();
}, { passive: true, capture: true });

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

// Charts are laid out in viewBox units at a fixed design width and then scaled
// to whatever column they land in. That scales the LABELS too, and below about
// 90% of the design width they stop being readable: axis text on this page is
// 9.4 to 11.1 viewBox units, so at 0.9 the smallest of it lands at 8.5px and at
// the 0.40 a phone was giving the race swarm it lands at 4.4px. A chart squeezed
// that far has not become a smaller readable chart, it has become a smudge --
// and the marks collide as well, so nothing is recovered by zooming.
//
// So a narrow viewport scrolls the chart at a legible scale rather than shrinking
// it. `--design-w` is what the layout asked for; theme.css holds the floor and
// the media query. Charts that were already narrow never reach it and never
// scroll.
// An element that scrolls sideways and does not say so reads as an element that
// has been cut off. The page cannot know in CSS whether a given scroller
// actually overflows -- that depends on the payload, the scope and the viewport
// -- so the class is set from the measurement and the fade hangs off it.
//
// The frame is a separate element from the scroller because the fade must NOT
// scroll with the content: painted inside, it would slide away on the first
// swipe and sit in the middle of the chart.
const SCROLLERS = new Set();
// Which scrollers have ever been in the document. A scroller is pruned when it
// leaves the page -- panels repaint constantly and the set would otherwise grow
// for the life of the session -- but "not in the document" and "gone" are only
// the same thing AFTER it has been in the document once.
//
// Several panels build their chart detached and attach it afterwards, so the
// prune ran on the synchronous remark() inside the scroller's own registration
// and deleted it on the spot. Six of the nine charts were removed from the set
// by the call that added them, which is why the playing field never calibrated
// and never scrolled while the three charts drawn into an attached host did.
const SEEN = new WeakSet();
let scrollWatch = null;

// The floor below which a chart scrolls instead of shrinking, expressed as the
// thing that actually matters: the smallest label it contains, in real pixels.
//
// The first version of this used one factor for every chart -- 0.9 of the design
// width -- which is a proxy for legibility rather than legibility. It put six
// charts comfortably over 9px and left the correlation matrix at 8.5px, because
// that chart's labels are 9.4 viewBox units where the rest of the page uses 10
// to 11. A constant cannot know that. This measures each chart's own smallest
// label and asks for exactly the width that keeps it at MIN_LABEL_PX, capped at
// the design width, so a chart with large labels is still free to shrink and one
// with small labels is not.
const MIN_LABEL_PX = 9;

function calibrate(s) {
  const svg = s.querySelector('svg');
  const vb = svg && svg.getAttribute('viewBox');
  if (!vb) return;
  const vbw = Number(vb.split(/[\s,]+/)[2]);
  if (!vbw) return;
  // Re-measured whenever the label count changes, and NOT latched on the first
  // look. svg() returns before its caller has drawn anything, so the first
  // observation can land on a chart carrying only its title -- which is the
  // largest text in it. Latching there recorded a floor from the one label that
  // did not need protecting, and left five charts on the playing field at 8.2px
  // while reporting success.
  const texts = svg.querySelectorAll('text');
  if (s.dataset.nText === String(texts.length)) return;
  let min = Infinity;
  for (const t of texts) {
    if (!t.textContent.trim()) continue;
    const fs = parseFloat(getComputedStyle(t).fontSize);
    if (fs) min = Math.min(min, fs);
  }
  // No text yet means the chart has not drawn. Leave it uncalibrated and try
  // again rather than recording a floor of zero.
  if (!isFinite(min)) return;
  s.dataset.nText = String(texts.length);
  s.style.setProperty('--legible-w',
    `${Math.round(vbw * Math.min(1, MIN_LABEL_PX / min))}px`);
}

// `calib` is off for scroll events: re-reading every label's computed style on
// every scroll frame is the one way this could cost anything, and a scroll
// cannot change what a label measures.
function remark(calib = true) {
  for (const s of SCROLLERS) {
    if (s.isConnected) SEEN.add(s);
    else if (SEEN.has(s)) { SCROLLERS.delete(s); scrollWatch.unobserve(s); continue; }
    else continue;                       // built detached; it will be attached shortly
    if (calib && s.classList.contains('chart-scroll')) calibrate(s);
    const over = s.scrollWidth > s.clientWidth + 1;
    const atEnd = s.scrollLeft + s.clientWidth >= s.scrollWidth - 1;
    s.parentElement.classList.toggle('is-scrollable', over && !atEnd);
    s.parentElement.classList.toggle('is-scrolled', s.scrollLeft > 1);
  }
}

// Wrap `el` in a frame and keep that frame told whether `el` is currently
// scrollable. Returns the frame.
export function scrollAffordance(el) {
  const frame = document.createElement('div');
  frame.className = 'xscroll-frame';
  el.parentNode.insertBefore(frame, el);
  frame.append(el);
  el.classList.add('xscroll');
  SCROLLERS.add(el);
  if (!scrollWatch) {
    scrollWatch = new ResizeObserver(remark);
    addEventListener('resize', remark, { passive: true });
  }
  scrollWatch.observe(el);
  el.addEventListener('scroll', () => remark(false), { passive: true });

  // A ResizeObserver on the scroller is not enough to catch the labels arriving.
  // svg() returns before its caller has drawn anything, and drawing into a fixed
  // viewBox changes neither the scroller's width (it is contained) nor, for most
  // of these charts, its height -- so the observer never fires a second time and
  // the calibration is taken on an empty chart forever. That is what left the
  // playing field at 8.2px while the correlation matrix, whose height does move
  // as it draws, calibrated correctly: the same code, passing and failing on
  // whether a chart happened to change size.
  const drawn = el.querySelector('svg');
  if (drawn) {
    let queued = false;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; remark(); });
    });
    mo.observe(drawn, { childList: true, subtree: true });
  }
  remark();
  requestAnimationFrame(() => remark());
  return frame;
}

export function svg(host, width, height, label) {
  const scroll = d3.select(host).append('div').attr('class', 'chart-scroll');
  scroll.node().style.setProperty('--design-w', `${width}px`);
  const s = scroll.append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', label)
    .style('display', 'block')
    .style('overflow', 'visible');
  scrollAffordance(scroll.node());
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
