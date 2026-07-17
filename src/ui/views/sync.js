// src/ui/views/sync.js — #/sync cross-workspace overview: one place to see every workspace's sync
// state and act on it. Summary line + per-workspace cards (status chip, Commit/Pull, changed
// pathway names). Actions are primary-only (data-requires-primary); followers see read-only chips.
import { el, clear } from '../dom.js';
import { syncRow, syncChip } from '../sync-indicator.js';
import { openConnectRepo } from '../connect.js';

export default async function mount(container, params, ctx) {
  const root = el('div', { class: 'view-content' });
  container.append(root);
  let unsub = () => {};
  const controller = { title: 'Sync', refresh, destroy() { unsub(); } };
  const btn = (txt, props, fn) => { const b = el('button', { type: 'button', ...props }, txt); b.addEventListener('click', fn); return b; };
  const act = async (fn) => { try { await fn(); } catch { /* remove is rarely fallible; add shows inline errors */ } };

  // Link-audit exemptions (P5): domains the auditor skips. Global; committed so the Action honours them.
  async function renderExemptSection() {
    const exempt = await ctx.db.listExemptDomains();
    const sec = el('section', { class: 'exempt-section', 'aria-labelledby': 'exempt-h' });
    sec.append(el('h2', { id: 'exempt-h' }, 'Link-audit exemptions'),
      el('p', { class: 'muted' }, 'Domains the link auditor skips — paywalled or auth-walled sites. Committed to the repo so the audit workflow honours them.'));
    const list = el('ul', { class: 'exempt-list', role: 'list' });
    if (!exempt.length) list.append(el('li', { class: 'muted' }, 'No exemptions yet.'));
    for (const e of exempt) list.append(el('li', {},
      el('code', {}, e.domain), e.reason ? el('span', { class: 'muted' }, ` — ${e.reason}`) : '',
      btn('Remove', { class: 'btn btn--sm btn--danger', 'data-requires-primary': true, style: 'margin-inline-start:auto' },
        () => act(() => ctx.db.removeExemptDomain({ domain: e.domain })))));
    const input = el('input', { type: 'text', name: 'domain', placeholder: 'example.com', 'aria-label': 'Domain to exempt', autocomplete: 'off' });
    const err = el('span', { class: 'field-error', role: 'alert' });
    const form = el('form', { class: 'exempt-add' }, input,
      el('button', { type: 'submit', class: 'btn btn--sm', 'data-requires-primary': true }, 'Add exemption'), err);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      try { await ctx.db.addExemptDomain({ domain: input.value }); input.value = ''; }
      catch (ex) { err.textContent = ex.message || 'Could not add.'; }
    });
    sec.append(list, form);
    return sec;
  }

  async function refresh() {
    const [workspaces, pathways] = await Promise.all([ctx.db.getWorkspaces(), ctx.db.listPathways()]);
    const nameById = new Map(pathways.map((p) => [p.id, p.name]));
    const primary = ctx.isPrimary();
    const statuses = {};
    if (ctx.sync) await Promise.all(workspaces.map(async (w) => { statuses[w.id] = await ctx.sync._computeStatus(w.id); }));
    const connected = workspaces.filter((w) => w.owner && w.repo);
    const total = Object.values(statuses).reduce((n, s) => n + (s.uncommittedCount || 0), 0);
    const conflicts = Object.values(statuses).filter((s) => s.remoteAhead);

    clear(root);
    root.append(el('h1', { 'data-view-heading': true, tabindex: -1 }, 'Sync'));

    if (conflicts.length) root.append(el('p', { class: 'sync-summary sync-summary--danger', role: 'status' },
      `${conflicts.length} workspace${conflicts.length === 1 ? '' : 's'} with a sync conflict — pull to review.`));
    else if (total) root.append(el('p', { class: 'sync-summary', role: 'status' },
      `${total} uncommitted change${total === 1 ? '' : 's'} across ${connected.length} connected workspace${connected.length === 1 ? '' : 's'}.`));
    else if (Object.values(statuses).some((s) => s.auditDirty)) root.append(el('p', { class: 'sync-summary', role: 'status' },
      'Audit override changes pending — commit to share them with your other devices.'));
    else root.append(el('p', { class: 'sync-summary sync-summary--ok', role: 'status' },
      connected.length ? 'All connected workspaces are in sync.' : 'No workspaces are connected to a repository yet.'));

    if (!workspaces.length) {
      root.append(el('p', { class: 'muted' }, 'No workspaces yet — create one from the dashboard.'),
        el('p', {}, el('a', { class: 'btn', href: '#/' }, 'Back to dashboard')));
      return;
    }

    const list = el('div', { class: 'sync-list' });
    for (const ws of workspaces) {
      const st = statuses[ws.id] || { state: 'disconnected', uncommittedCount: 0 };
      const conn = !!(ws.owner && ws.repo);
      const card = el('section', { class: 'sync-ws-card', 'aria-labelledby': `syncws-${ws.id}`,
        style: ws.colour ? `--org-accent:${ws.colour}` : null });
      card.append(el('header', {},
        el('h2', { id: `syncws-${ws.id}` }, ws.org_label),
        el('span', { class: `ws-conn ${conn ? 'is-connected' : 'is-disconnected'}` },
          conn ? `${ws.owner}/${ws.repo}` : 'Not connected')));

      if (primary && conn) {
        card.append(syncRow(ws, st, ctx));
        const changed = (st.changedPathwayIds || []).map((id) => nameById.get(id)).filter(Boolean);
        if (changed.length) card.append(el('p', { class: 'sync-detail muted' }, 'Changed: ' + changed.join(', ')));
        if (st.removedPathwayIds?.length) card.append(el('p', { class: 'sync-detail muted' },
          `${st.removedPathwayIds.length} removed pathway${st.removedPathwayIds.length === 1 ? '' : 's'} pending commit.`));
      } else if (primary && !conn) {
        const connect = el('button', { type: 'button', class: 'btn btn--sm', 'data-requires-primary': true }, 'Connect repo…');
        connect.addEventListener('click', (ev) => openConnectRepo({ workspace: ws, invoker: ev.currentTarget, ctx }));
        card.append(el('div', { class: 'sync-row' }, syncChip(st, ws.id), connect));
      } else {
        card.append(el('div', { class: 'sync-row' }, syncChip(st, ws.id)));   // follower: read-only
      }
      list.append(card);
    }
    root.append(list);
    if (primary) root.append(await renderExemptSection());
  }

  // Live-update when the global conflict state flips. Ordinary count changes (edit/commit/pull)
  // carry a DB change event the router already re-renders on; a commit that hits remote-ahead only
  // marks conflict in memory, so subscribe to catch exactly that transition.
  let lastConflict = !!ctx.sync?.hasConflict();
  if (ctx.sync) unsub = ctx.sync.onStatusChange(() => {
    const c = !!ctx.sync.hasConflict();
    if (c !== lastConflict) { lastConflict = c; refresh(); }
  });

  await refresh();
  return controller;
}
