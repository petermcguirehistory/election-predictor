// Which races move together.
//
// Computed in the browser from the sign payload -- a phi coefficient over the
// 20,000 draws, which is exactly a correlation on binary outcomes, so this is
// the model's real dependence structure and not a proxy for it.
//
// Ordered by hierarchical clustering with no geography supplied. The blocks that
// emerge ARE the state and region layers: workstream F's finding ("the missing
// layer was the state, not demographics") turned from a claim in PLAN.md into
// something visible. If the ordering came out as noise, that finding would be
// wrong.
import d3 from '../d3.js';
import { term } from '../glossary.js';
import { C, svg, showTip, hideTip } from './util.js';

// `idx` is the selected draws under a pin, or null for all of them. This panel
// used to ignore the condition entirely while data.js listed 'correlation' among
// the things that recompute under one -- and the diagnostics table printed that
// list to the reader. It conditions now, which is also the more interesting
// chart: hold one race and the block around it collapses.
//
// A pinned race has the same outcome in every surviving draw, so its sd is 0 and
// its row reads as zero correlation. That is the right answer -- something held
// fixed covaries with nothing -- and the note below says so.
function phiMatrix(sims, ids, idx) {
  const n = idx ? idx.length : sims.m.n_sims;
  const k = ids.length;
  const bits = ids.map(r => sims.bitsFor(r));
  const at = idx ? (a, s) => a[idx[s]] : (a, s) => a[s];
  const mean = bits.map(a => { let t = 0; for (let s = 0; s < n; s++) t += at(a, s); return t / n; });
  const sd = mean.map(m => Math.sqrt(m * (1 - m)));
  const M = Array.from({ length: k }, () => new Float32Array(k));
  for (let i = 0; i < k; i++) {
    M[i][i] = 1;
    for (let j = i + 1; j < k; j++) {
      const a = bits[i], b = bits[j];
      if (sd[i] < 1e-9 || sd[j] < 1e-9) { M[i][j] = M[j][i] = 0; continue; }
      let t = 0;
      for (let s = 0; s < n; s++) t += at(a, s) & at(b, s);
      const r = (t / n - mean[i] * mean[j]) / (sd[i] * sd[j]);
      M[i][j] = M[j][i] = r;
    }
  }
  return M;
}

// Average-linkage agglomerative clustering; leaves come out in merge order.
function clusterOrder(M) {
  const k = M.length;
  let nodes = d3.range(k).map(i => ({ leaves: [i] }));
  const dist = (a, b) => {
    let t = 0;
    for (const i of a.leaves) for (const j of b.leaves) t += 1 - M[i][j];
    return t / (a.leaves.length * b.leaves.length);
  };
  while (nodes.length > 1) {
    let best = null;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = dist(nodes[i], nodes[j]);
        if (!best || d < best.d) best = { d, i, j };
      }
    }
    const merged = { leaves: [...nodes[best.i].leaves, ...nodes[best.j].leaves] };
    nodes = nodes.filter((_, x) => x !== best.i && x !== best.j).concat([merged]);
  }
  return nodes[0].leaves;
}

// The unconditioned matrix and its clustered ORDER are computed once and kept.
// The order is then frozen across conditioned renders: re-clustering under every
// pin would reshuffle the axes under the reader, and the ordering is a property
// of the model, not of the scenario being asked about.
function base(sims, ids) {
  if (!sims._corrBase || sims._corrKey !== ids.join()) {
    const M = phiMatrix(sims, ids, null);
    sims._corrBase = { M, order: clusterOrder(M) };
    sims._corrKey = ids.join();
  }
  return sims._corrBase;
}

export function correlationMatrix(host, { sims, races, condition, sigmaState, topN = 34,
                                          scopeLabel = 'races', onPick }) {
  host.replaceChildren();
  const pool = races
    .filter(r => sims.col.has(r.race_id))
    .sort((a, b) => Math.abs(a.win_prob - 0.5) - Math.abs(b.win_prob - 0.5))
    .slice(0, topN);
  const ids = pool.map(r => r.race_id);
  const byId = new Map(pool.map(r => [r.race_id, r]));

  const b = base(sims, ids);
  const order = b.order;
  const live = condition && condition.pinned && condition.ok;
  const M = live ? phiMatrix(sims, ids, condition.idx) : b.M;
  const oid = order.map(i => ids[i]);

  const cell = 15, pad = { l: 74, t: 74 };
  const W = pad.l + oid.length * cell + 8, H = pad.t + oid.length * cell + 8;
  const s = svg(host, W, H, 'Correlation between race outcomes, ordered by clustering');
  const ramp = d3.interpolateLab(C.surface, C.dem);

  // Scale to the OFF-DIAGONAL range. A correlation matrix's diagonal is 1 by
  // definition and carries no information, and letting it anchor the ramp
  // compresses every real value -- which here run about 0.05 to 0.35 -- into the
  // bottom tenth of the scale, flattening exactly the block structure the chart
  // exists to show. The diagonal is drawn as a neutral rule instead.
  let hi = 0;
  for (let a = 0; a < oid.length; a++)
    for (let b = 0; b < oid.length; b++)
      if (a !== b) hi = Math.max(hi, Math.abs(M[order[a]][order[b]]));

  const g = s.append('g');
  for (let a = 0; a < oid.length; a++) {
    for (let b = 0; b < oid.length; b++) {
      const v = M[order[a]][order[b]];
      g.append('rect')
        .attr('x', pad.l + b * cell).attr('y', pad.t + a * cell)
        .attr('width', cell - 1).attr('height', cell - 1)
        .attr('fill', a === b ? C.line
                    : v < 0 ? d3.interpolateLab(C.surface, C.rep)(Math.min(1, -v / hi))
                            : ramp(Math.min(1, v / hi)))
        .on('pointermove', e => showTip(e, a === b ? `<b>${oid[a]}</b>` :
          `<b>${oid[a]}</b> × <b>${oid[b]}</b><br>correlation ${v.toFixed(2)}` +
          (byId.get(oid[a]).state === byId.get(oid[b]).state
            ? '<br><span class="tip-dim">same state</span>' : '')))
        .on('pointerleave', hideTip);
    }
  }
  for (let a = 0; a < oid.length; a++) {
    const r = byId.get(oid[a]);
    s.append('text').attr('x', pad.l - 6).attr('y', pad.t + a * cell + cell / 2 + 1)
      .attr('text-anchor', 'end').attr('fill', C.muted).attr('font-size', 9.5)
      .text(oid[a]).style('cursor', 'pointer').on('click', () => onPick && onPick(r));
    s.append('text')
      .attr('transform', `translate(${pad.l + a * cell + cell / 2},${pad.t - 6}) rotate(-90)`)
      .attr('fill', C.muted).attr('font-size', 9.5).text(oid[a]);
  }

  const sameState = [];
  for (let a = 0; a < oid.length; a++) {
    for (let b = a + 1; b < oid.length; b++) {
      if (byId.get(oid[a]).state === byId.get(oid[b]).state) sameState.push(M[order[a]][order[b]]);
    }
  }
  const cross = [];
  for (let a = 0; a < oid.length; a++) {
    for (let b = a + 1; b < oid.length; b++) {
      if (byId.get(oid[a]).state !== byId.get(oid[b]).state) cross.push(M[order[a]][order[b]]);
    }
  }
  const mean = xs => xs.reduce((p, c) => p + c, 0) / (xs.length || 1);

  // A div, not a p -- the caption carries a <ul>.
  const note = document.createElement('div');
  note.className = 'chart-note';
  note.innerHTML =
    `<b>${term('correlation')}</b> between every pair of the ${Math.min(topN, oid.length)} `
    + `closest ${scopeLabel} of ${races.length}, across `
    + `${live ? condition.n.toLocaleString() : sims.m.n_sims.toLocaleString()} draws.`
    + `<ul class="pts">`
    + `<li><b>Colour</b> — saturates at ${hi.toFixed(2)}, the strongest pair.</li>`
    + `<li><b>Order</b> — clustered on outcomes alone; states still form blocks.</li>`
    + `<li><b>Same state ${mean(sameState).toFixed(2)}, different states `
    + `${mean(cross).toFixed(2)}</b>: the gap is σ<sub>state</sub>.</li>`
    + `</ul>`
    + (live
        ? ` <b>Recomputed over your pinned draws</b>, order held fixed; a pinned race correlates `
          + `with nothing.`
        : '');
  host.append(note);
}
