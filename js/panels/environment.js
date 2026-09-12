// The model's largest single input, on the page that rests on it.
//
// Every headline number on this site is downstream of one quantity: what the
// generic ballot says, minus the correction for what the generic ballot has
// historically got wrong. That was reported nowhere on the front page — a reader
// could learn the House is 63.8% three times over and never see the number
// producing it. This is the strip that says where it comes from.
import { C } from '../charts/util.js';

// How much House control rides on the bias correction being right, read off the
// sweep rather than asserted. README's "about nine points per point" was fitted
// at a different environment and is not a constant: the curve is steepest where
// the chamber is closest, so the leverage moves with the forecast and the only
// honest version of the number is the one recomputed each run.
//
// A symmetric secant across +/- 1 point, not a local derivative: the sweep is
// 20,000 draws per stop under common random numbers, and a one-step difference
// would be reporting the noise between two adjacent stops as a slope.
export function houseLeverage(scenarios, span = 1) {
  const rows = (scenarios?.scenarios ?? []).filter(r => r.house?.p != null);
  if (rows.length < 2) return null;
  const fitted = scenarios.fitted_bias;
  const at = b => {
    const lo = [...rows].reverse().find(r => r.bias <= b);
    const hi = rows.find(r => r.bias >= b);
    if (!lo || !hi) return null;
    if (lo.bias === hi.bias) return lo.house.p;
    const t = (b - lo.bias) / (hi.bias - lo.bias);
    return lo.house.p + t * (hi.house.p - lo.house.p);
  };
  const a = at(fitted - span), z = at(fitted + span);
  if (a == null || z == null) return null;
  return Math.abs(a - z) / (2 * span);
}

const tile = (n, unit, label) => {
  const d = document.createElement('div');
  d.className = 'env-stat';
  d.innerHTML = `<div class="env-n">${n}${unit ? `<span class="env-u">${unit}</span>` : ''}</div>`
              + `<div class="env-l">${label}</div>`;
  return d;
};

export function environmentStrip(host, { environment: e, scenarios, gbAgeDays, onLeverage }) {
  host.replaceChildren();
  if (!e) return;

  const lead = e.margin >= 0 ? 'D' : 'R';
  const colour = lead === 'D' ? C.dem : C.rep;

  host.append(tile(
    `<span style="color:${colour}">${lead}+${Math.abs(e.margin).toFixed(1)}</span>`, '',
    `<b>generic ballot</b>, after subtracting the `
    + `${e.instrument_bias.toFixed(2)}-point lean it has shown in past cycles `
    + `(before it: ${e.margin_before_instrument_bias >= 0 ? 'D' : 'R'}`
    + `+${Math.abs(e.margin_before_instrument_bias).toFixed(1)})`));

  host.append(tile(e.n_polls, '', `<b>polls</b> in the ${e.window_days}-day window, the newest `
    + `${e.newest_days_old} day${e.newest_days_old === 1 ? '' : 's'} old`));

  host.append(tile(Math.round(e.weighted_age_days), ' days', `<b>weighted age</b> of that average. `
    + `Each poll counts for less as it ages, so this — not the newest one — is how old the `
    + `reading really is.`));

  const lev = houseLeverage(scenarios);
  if (lev != null) {
    const t = tile(`${(lev * 100).toFixed(0)}`, ' pts', `<b>of House control</b> for every point that `
      + `correction is off \u2014 and the correction is an estimate from past elections, not a `
      + `measurement of this one.`);
    // The one tile that is a door rather than a fact: the sweep behind this
    // number is a control, and a reader who doubts the correction should land on
    // it rather than be told the number and left there.
    t.classList.add('env-go');
    t.tabIndex = 0;
    t.setAttribute('role', 'button');
    t.setAttribute('aria-label', 'Open the generic ballot scenario sweep');
    const go = () => onLeverage && onLeverage();
    t.onclick = go;
    t.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } };
    host.append(t);
  }
}
