// src/ui/shell.js — chrome: header/theme toggle/role banner/skeleton/error pane.
import { el } from './dom.js';
import * as theme from './theme.js';
import { announce } from './a11y.js';

let banner, outlet, toggle;
export function init() {
  banner = document.getElementById('role-banner');
  outlet = document.getElementById('view');
  toggle = document.getElementById('theme-toggle');
  toggle.setAttribute('aria-pressed', String(theme.current() === 'dark'));
  toggle.addEventListener('click', () => {
    const t = theme.toggle();
    toggle.setAttribute('aria-pressed', String(t === 'dark'));
    announce(t === 'dark' ? 'Dark mode on' : 'Dark mode off');
  });
  return { setRole, setBusy, announce, skeleton, errorPane, capabilityScreen };
}
export function setRole(role, isPrimary) {
  document.body.dataset.role = role;                 // ONE role location: body[data-role]
  // Primary is the NORMAL state — no banner for it. Only the exceptional read-only follower
  // state gets announced.
  if (role === 'pending' || isPrimary) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.dataset.kind = 'follower';
  banner.className = 'banner banner--follower';
  banner.textContent = 'Read-only — PathCurator is active in another tab. Editing is disabled here.';
}
export function setBusy(b) { outlet.setAttribute('aria-busy', String(b)); }
export function skeleton() {
  const wrap = el('div', { class: 'view-content', 'aria-hidden': 'true' });
  for (let i = 0; i < 4; i++) wrap.append(el('div', { class: 'skeleton skeleton--line', style: `width:${70 - i * 8}%` }));
  return wrap;
}
export function errorPane(msg) {
  return el('div', { class: 'view-content' },
    el('h1', { 'data-view-heading': true, tabindex: -1 }, 'Something went wrong'),
    el('p', {}, msg),
    el('p', {}, el('a', { href: '#/' }, 'Return to the dashboard')));
}

// Shown when on-device storage (OPFS) is unavailable — private/incognito windows, or a browser
// older than Chrome 108 / Firefox 111 / Safari 16.4. (O11 / spec §6.4.)
export function capabilityScreen({ kind = 'storage' } = {}) {
  const card = el('div', { class: 'capability card', role: 'alert' },
    el('h1', { 'data-view-heading': true, tabindex: -1 }, "PathCurator can’t save data here"));
  if (kind === 'oldbrowser') {
    card.append(
      el('p', {}, 'This browser is missing features PathCurator needs to store your pathways on this device.'),
      el('p', {}, 'PathCurator works in Chrome/Edge 108+, Firefox 111+, and Safari 16.4+. Please update your browser and reload.'));
  } else {
    card.append(
      el('p', {}, 'Your browser is blocking on-device storage. This almost always means you are in a ',
        el('strong', {}, 'Private / Incognito'), ' window — PathCurator keeps your pathways in the browser’s private file system, which private windows do not allow.'),
      el('p', {}, el('strong', {}, 'Open PathCurator in a normal window to continue.'), ' Nothing is lost.'),
      el('p', { class: 'muted' }, 'Once you are set up, GitHub sync and JSON export are your off-device backups.'));
  }
  return el('div', { class: 'view-content' }, card);
}
