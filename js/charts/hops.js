// Hypothetical Outcome Plots: show the draws, don't summarise them.
//
// Every static chart on this page reduces the simulations to a summary, and
// summaries cannot show CORRELATION. The model's error is hierarchical -- a
// national term, a regional one, and a state term that workstream F added after
// measuring that the four regions carry far less than the state, which was not
// modelled at all. The live values are in forecast.sigma; they are not restated
// here, because a comment that repeats a calibration goes stale silently. That
// structure is the difference between 435 coin flips and an election, and no
// snapshot of the mean conveys it.
//
// So: play the draws. Whole regions swing together, states move as blocks, and
// the seat total lurches instead of jittering. That is the state layer, visible.
//
// Honours prefers-reduced-motion by not starting, and stops when scrolled away.
import { C } from './util.js';

// `groups` is one or more d3 selections whose data carry a `.race` (null where a
// state holds no race this cycle). Taking a list rather than one selection is
// what lets the replay run over whichever chamber maps are on screen -- the House
// hexes, a Senate state map, or all three at once -- without knowing which.
export function hops(groups, sims, { onFrame, interval = 420 } = {}) {
  let timer = null, draw = 0, io = null;
  const n = sims.m.n_sims;
  const layers = (Array.isArray(groups) ? groups : [groups]).map(sel => ({
    sel, cols: sel.data().map(d => (d.race ? sims.col.get(d.race.race_id) : undefined)),
  }));
  const chambers = Object.keys(sims.seats);

  const paint = () => {
    for (const L of layers) {
      L.sel.attr('fill', (d, k) => {
        if (!d.race) return C.line;            // no race here this cycle
        const c = L.cols[k];
        // Never-flip races are absent from the payload; their outcome is the
        // same in every draw, which is exactly what makes them absent.
        const dem = c === undefined ? d.race.win_prob >= 0.5 : sims.bit(draw, c) === 1;
        return dem ? C.dem : C.rep;
      });
    }
    onFrame && onFrame(draw, Object.fromEntries(chambers.map(c => [c, sims.seats[c][draw]])));
  };

  const step = () => { draw = (draw + Math.floor(Math.random() * 997) + 1) % n; paint(); };

  return {
    start() {
      if (timer) return;
      step();
      timer = setInterval(step, interval);
    },
    stop() { clearInterval(timer); timer = null; },
    get running() { return !!timer; },
    // Stop when the map scrolls AWAY, having first been seen. An
    // IntersectionObserver fires once immediately on observe(), and the map
    // usually sits below the fold at that moment -- acting on that first
    // callback stops playback the instant it is started.
    observe(node, onStop) {
      let seen = false;
      io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting) { seen = true; return; }
        if (seen && timer) { this.stop(); onStop && onStop(); }
      }, { threshold: 0 });
      io.observe(node);
      return () => io.disconnect();
    },
  };
}

export const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
