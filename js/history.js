// What may honestly be compared across published runs.
//
// engine/history.py certifies every join between two consecutive runs as
// `comparable`, `broken` or `unverifiable`. A movement quoted across a broken
// join is part electorate and part model with no way to separate the two: the
// first two runs put House control at 67.1% and 49.1% two days apart, and none
// of that was the election. js/charts/trend.js already refuses to draw a line
// across such a join. This is the same rule for the numbers.
//
// Everything on the page that says "since" comes through here, so the page
// cannot quote a movement its own provenance does not support. Where the chain
// will not reach, the caller gets `blocked` and says so instead of falling back
// to a longer, prettier delta.

const DAY = 864e5;
const t = d => Date.parse(`${d}T00:00:00Z`);

// The newest run and as many before it as an unbroken chain of `comparable`
// edges reaches. `blocked` is the join that stopped the walk, or null when the
// chain runs all the way back to the first published forecast.
export function comparableRun(history) {
  const pts = history?.points ?? [];
  if (!pts.length) return null;
  const edge = new Map((history.edges ?? []).map(e => [e.to, e]));
  let i = pts.length - 1;
  // The edge keyed by a run's own date is the one arriving at it, so this asks
  // "can I step back from here?" and stops the first time the answer is no.
  while (i > 0 && edge.get(pts[i].asof)?.state === 'comparable') i--;
  return { run: pts.slice(i), blocked: i > 0 ? edge.get(pts[i].asof) ?? null : null };
}

// The run to measure the newest one against: the most recent one at least
// `days` old, or the oldest the chain reaches when there is nothing that far
// back. Not simply the previous run — these are published several times a week
// and sometimes twice in a day, so a one-run delta is mostly Monte Carlo noise.
// Not a fixed calendar window either, because the window may cross a join the
// provenance will not carry.
export function baseline(history, days = 7) {
  const r = comparableRun(history);
  if (!r) return null;
  const { run, blocked } = r;
  const latest = run.at(-1);
  if (run.length < 2) return { latest, base: null, run, blocked, days: 0 };
  const cut = t(latest.asof) - days * DAY;
  const base = [...run.slice(0, -1)].reverse().find(p => t(p.asof) <= cut) ?? run[0];
  return { latest, base, run, blocked, days: Math.round((t(latest.asof) - t(base.asof)) / DAY) };
}

// The quantity a chamber's history is measured in. A chamber with a majority to
// hold moves in probability; governors have none, so theirs moves in seats. The
// payload states which by leaving `control_prob` null, and this reads it rather
// than keeping a list of chamber names — the same rule Sims.summary and the
// trend chart already follow.
//
// `party` picks whose probability. Republicans' is read from `r_control_prob`,
// never taken as 1 - control_prob: once independents can decide a chamber the
// two do not add to one. A run that predates the split carries no
// `r_control_prob`, and a series that would need one is refused rather than
// filled -- in practice it never is, because the rule change breaks the join.
export function series(points, chamber, party = 'D') {
  const has = points.every(p => p[chamber]);
  if (!has) return null;
  const prob = points.at(-1)[chamber].control_prob != null;
  const key = party === 'R' ? 'r_control_prob' : 'control_prob';
  const values = points.map(p => (prob ? p[chamber][key] : p[chamber].median));
  if (values.some(v => v == null)) return null;
  return { kind: prob ? 'prob' : 'count', values };
}
