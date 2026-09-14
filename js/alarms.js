// One parser for engine alarm names, shared by the caveat strip and the limits panel.
//
// The grammar is "kind, then a trailing count" for most of them, and the two
// renderers used to split it with the same regex written twice. Three shapes do not
// fit that grammar, and each broke it differently:
//
//   feed_stopped_votehub_races_16d   the feed's NAME sits between kind and count,
//                                    so the regex read the kind as
//                                    "feed_stopped_votehub_races" and found no text
//   house_zero_poll_coverage         the chamber comes first and there is no count
//   redraw_reverted_MO               a list of states, rendered from the payload
//
// engine/dashboard/build.py reads the key tables in main.js and limits.js and fails
// the build if the engine can raise a kind that either has no text for. Change the
// shapes here and there together.
export function alarmKind(a) {
  let m = a.match(/^(feed_stopped|feed_not_refetched)_(.+)_(\d+)d$/);
  if (m) return { key: m[1], arg: m[3], sub: m[2] };
  m = a.match(/^redraw_reverted_(.+)$/);
  if (m) return { key: 'redraw_reverted', arg: null, sub: m[1] };
  m = a.match(/^(.*?)_(\d+)d?$/);
  return m ? { key: m[1], arg: m[2], sub: null } : { key: a, arg: null, sub: null };
}
