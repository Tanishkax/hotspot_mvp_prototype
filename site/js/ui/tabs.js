// Tab panels: one coherent app, four sections. Navigation is URL-driven (#/<tab>?<state>),
// so links are shareable and the browser back button moves between tabs.
import { TABS } from './hash.js';

const panels = () => TABS.map((t) => document.getElementById(`tab-${t}`));

/** Show one panel, update nav semantics. focus=true moves focus to the panel heading (keyboard/AT users). */
export function showTab(tab, { focus = false, scroll = true } = {}) {
  const active = TABS.includes(tab) ? tab : 'explore';
  for (const p of panels()) p.hidden = p.dataset.tab !== active;
  document.querySelectorAll('#tabs .tab').forEach((a) => {
    if (a.dataset.tab === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.body.dataset.tab = active;
  if (scroll) window.scrollTo({ top: 0 });
  if (focus) {
    const h = document.querySelector(`#tab-${active} h1[tabindex="-1"]`);
    if (h) h.focus({ preventScroll: true });
  }
  return active;
}

/** Keep every tab link pointing at the same selection, so middle-click / copy-link preserves state. */
export function updateTabLinks(hrefFor) {
  document.querySelectorAll('#tabs .tab, a[data-tab-link]').forEach((a) => {
    const tab = a.dataset.tab || a.dataset.tabLink;
    a.setAttribute('href', hrefFor(tab));
  });
}
