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
      'Audit changes pending (overrides or exemptions) — commit to share them with your other devices and the audit workflow.'));
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
