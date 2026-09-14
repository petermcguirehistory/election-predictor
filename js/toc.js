// The section rail: what is on the open tab, and a way to jump to it.
//
// Read off the DOM on every refresh rather than declared anywhere. Three things
// decide what belongs in it and all three already live on the page: which tab is
// open (tabs.js), which sections the payload carries (`hidden`), and which ones the
// scope removed (`.scope-hidden`). A list of section names typed here would be a
// fourth copy, and the first one to fall out of step would advertise a section the
// reader cannot reach.
//
// The label is the section's h2, which some panels rewrite with the scope -- the
// map heading reads "The Senate, by state" under the Senate -- so it is re-read
// rather than cached. A section with no h2 names itself with `data-toc`.
//
// Entries are buttons, not `#s-...` links: the hash carries the whole view on this
// page, and a bare fragment written over it would drop the scope and the pins.

const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

export function mountToc({ host, condBar }) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toc-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const title = document.createElement('div');
  title.className = 'toc-title';
  const list = document.createElement('ol');
  list.className = 'toc-list';
  host.append(toggle, title, list);

  // On a narrow screen the rail sits above the panel as a closed disclosure, so
  // it costs one line rather than a screen of links before the first chart.
  toggle.onclick = () => {
    const open = !host.classList.contains('open');
    host.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };

  // The conditioning bar sticks under the tab strip while a race is pinned, and
  // anything else that sticks -- this rail, a section a jump lands on -- has to
  // clear both. Measured, like --tabbar-h, because its height is its content.
  if (condBar) {
    const measure = () => document.documentElement.style.setProperty('--condbar-h',
      condBar.classList.contains('on') ? `${condBar.offsetHeight}px` : '0px');
    new ResizeObserver(measure).observe(condBar);
    new MutationObserver(measure).observe(condBar, { attributes: true, attributeFilter: ['class'] });
  }

  let entries = [];              // [{ sec, btn }]
  let signature = '';

  function jump(sec) {
    host.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    sec.scrollIntoView({ behavior: smooth(), block: 'start' });
  }

  // Which entry is current: the last section whose top has passed the line the
  // sticky chrome ends at. Past the final section's top it stays on that section,
  // rather than falling back to nothing at the foot of the page.
  function mark() {
    if (!entries.length) return;
    const css = getComputedStyle(document.documentElement);
    const line = (parseFloat(css.getPropertyValue('--tabbar-h')) || 0)
               + (parseFloat(css.getPropertyValue('--condbar-h')) || 0) + 48;
    let at = entries[0];
    for (const e of entries) if (e.sec.getBoundingClientRect().top <= line) at = e;
    // At the very bottom a short last section can never reach the line.
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) at = entries.at(-1);
    for (const e of entries) {
      const on = e === at;
      e.btn.classList.toggle('on', on);
      if (on) e.btn.setAttribute('aria-current', 'location');
      else e.btn.removeAttribute('aria-current');
    }
    const cur = at.btn.textContent;
    toggle.innerHTML = `<span class="toc-k">On this page</span><span class="toc-cur">${cur}</span>`;
  }

  let queued = false;
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; mark(); });
  }, { passive: true });
  addEventListener('resize', mark, { passive: true });

  return {
    // Cheap enough to run after every store change: a few querySelector calls,
    // and the list is only rebuilt when what it would show has actually changed.
    refresh(tabId) {
      const panel = document.querySelector(`[data-tab="${tabId}"]`);
      if (!panel) return;
      const secs = Array.from(panel.querySelectorAll('section[id]'))
        .filter(sec => !sec.hidden && !sec.classList.contains('scope-hidden'));
      const label = sec => sec.dataset.toc
        || sec.querySelector(':scope > .head h2, :scope > h2')?.textContent.trim()
        || sec.id;
      const sig = tabId + '|' + secs.map(sec => `${sec.id}:${label(sec)}`).join('|');
      if (sig !== signature) {
        signature = sig;
        title.textContent = panel.dataset.tabLabel;
        list.replaceChildren();
        entries = secs.map(sec => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'toc-item';
          btn.textContent = label(sec);
          btn.onclick = () => jump(sec);
          li.append(btn);
          list.append(li);
          return { sec, btn };
        });
        // A one-section tab has nowhere to jump to. The rail stays, so the page
        // does not shift sideways between tabs, but says only what the tab is.
        host.classList.toggle('single', entries.length < 2);
      }
      mark();
    },
  };
}
