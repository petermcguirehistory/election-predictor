// Tab chrome.
//
// The panels declare the tabs. Each [data-tab] element carries the tab's id and
// its label and owns the sections nested inside it, so adding a section to a tab
// is an edit to one HTML element -- there is no second list here to keep in step
// with it, and no way for the strip to advertise a tab that does not exist.
//
// This file does not render anything but the strip. What it gives main.js is
// `owner(sectionId)`: which tab a section sits on, so main.js can hold a
// section's paint while its tab is off screen. See the note on `paint` there for
// what that is and is not worth.

import { scrollAffordance } from './charts/util.js';

export function mountTabs({ list, onSelect }) {
  // Six labels do not fit a phone, so the strip scrolls -- and a strip that
  // scrolls without saying so is a strip that appears to have four tabs on it.
  scrollAffordance(list);
  const panels = Array.from(document.querySelectorAll('[data-tab]'));
  const owner = new Map();
  for (const p of panels) {
    for (const sec of p.querySelectorAll('section[id]')) owner.set(sec.id, p.dataset.tab);
  }

  const buttons = new Map();
  const dead = new Set();          // tabs with nothing this payload can show
  const bar = list.closest('.tabbar');
  let current = null;

  const order = () => panels.map(p => p.dataset.tab).filter(id => !dead.has(id));

  const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

  // Two other rules need the height of this bar -- where the conditioning strip
  // sticks to, and how far a cross-tab link has to overshoot so its heading does
  // not land underneath. Measured rather than typed: the strip is one line of
  // text, and its height moves with the reader's font settings.
  //
  // A ResizeObserver rather than a call at the end of boot. The first measure has
  // to happen after #app is unhidden -- taken any earlier it reads 0, and a
  // conditioning strip pinned to `top: 0` sits underneath the tab strip instead
  // of below it, which is what the first version of this did.
  if (bar) {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--tabbar-h', `${bar.offsetHeight}px`);
    }).observe(bar);
  }

  // Switching tab while scrolled halfway down a long panel otherwise lands the
  // reader in the middle of the new one, at a scroll depth that meant something
  // on the panel they just left and nothing on this one.
  function toTop() {
    if (bar && scrollY > bar.offsetTop) scrollTo({ top: bar.offsetTop, behavior: smooth() });
  }

  for (const p of panels) {
    const id = p.dataset.tab;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.id = `tabbtn-${id}`;
    b.textContent = p.dataset.tabLabel;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', p.id);
    b.setAttribute('aria-selected', 'false');
    b.tabIndex = -1;
    b.addEventListener('click', () => { onSelect(id); toTop(); });
    // Roving tabindex with automatic activation: one Tab stop for the whole
    // strip, arrows move along it. Home/End go to the ends, which is the part
    // people actually miss on a strip this wide.
    b.addEventListener('keydown', e => {
      const ids = order();
      const i = ids.indexOf(current);
      const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: ids.length - 1 }[e.key];
      if (to === undefined || i < 0) return;
      e.preventDefault();
      const next = ids[(to + ids.length) % ids.length];
      onSelect(next);
      buttons.get(next).focus();
      toTop();
    });
    p.setAttribute('aria-labelledby', b.id);
    list.append(b);
    buttons.set(id, b);
  }

  return {
    owner: id => owner.get(id),
    get current() { return current; },

    // A payload without the scenario sweep or the structural block hides those
    // sections. A tab left with nothing but hidden sections loses its button
    // too, rather than offering a reader a destination that is a blank page.
    // Called once, after availability is settled and before the first paint.
    prune() {
      for (const p of panels) {
        const secs = Array.from(p.querySelectorAll('section'));
        if (secs.length && secs.every(s => s.hidden)) { dead.add(p.dataset.tab); }
        buttons.get(p.dataset.tab).hidden = dead.has(p.dataset.tab);
      }
    },

    // Returns the tab actually shown, which is not always the one asked for: a
    // permalink can outlive the tab it names, or name one this payload pruned.
    show(id) {
      if (!buttons.has(id) || dead.has(id)) id = order()[0];
      if (id === current) return id;
      current = id;
      for (const p of panels) {
        const t = p.dataset.tab;
        const on = t === id;
        p.hidden = !on;
        const b = buttons.get(t);
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      // On a phone the strip is wider than the screen, so the tab a permalink
      // opens can be off the end of it -- an active tab with no visible mark on
      // it reads as no active tab at all.
      buttons.get(id).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return id;
    },
  };
}
