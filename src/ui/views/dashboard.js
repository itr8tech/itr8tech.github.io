// src/ui/views/dashboard.js — pathways grouped by workspace.
import { el, clear } from '../dom.js';
import { openPathwayEditor, openWorkspaceEditor, confirmDelete } from '../editors.js';
import { openConnectRepo } from '../connect.js';
import { syncRow } from '../sync-indicator.js';
import { initReorder, reorderControls } from '../reorder.js';
export default async function mount(container, params, ctx) {
  const root = el('div', { class: 'view-content' }); container.append(root);
  let teardownReorder = null;
  const controller = { title: 'Dashboard', refresh, destroy() { teardownReorder?.(); } };
  const btn = (txt, props, fn) => { const b = el('button', { type: 'button', ...props }, txt); b.addEventListener('click', fn); return b; };
  async function refresh() {
    const [workspaces, pathways] = await Promise.all([ctx.db.getWorkspaces(), ctx.db.listPathways()]);
    const primary = ctx.isPrimary();
    const statuses = {};
    if (primary && ctx.sync) await Promise.all(workspaces.map(async (w) => { statuses[w.id] = await ctx.sync._computeStatus(w.id); }));
    const totalUn = Object.values(statuses).reduce((n, s) => n + (s.uncommittedCount || 0), 0);
    const anyConflict = Object.values(statuses).some((s) => s.remoteAhead);
    const byWs = new Map(workspaces.map((w) => [w.id, { ws: w, items: [] }]));
    for (const p of pathways) byWs.get(p.workspace_id)?.items.push(p);
    clear(root);
    root.append(el('h1', { 'data-view-heading': true, tabindex: -1 }, 'Pathways'));
    if (primary) root.append(el('div', { class: 'dashboard-actions' },
      btn('+ New workspace', { class: 'btn btn--primary', 'data-requires-primary': true, 'data-focus-key': 'new-workspace' },
        (ev) => openConnectRepo({ invoker: ev.currentTarget, ctx }))));
    if (primary && (totalUn > 0 || anyConflict)) root.append(el('p', { class: 'sync-summary', role: 'status' },
      anyConflict ? 'Some workspaces have sync conflicts — pull to review.'
        : `${totalUn} uncommitted change${totalUn === 1 ? '' : 's'} across your workspaces.`));
    if (!workspaces.length) { root.append(el('p', { class: 'muted' }, 'No workspaces yet — create one to get started. You can connect it to a GitHub repo now or later.')); return; }
    for (const { ws, items } of byWs.values()) {
      const section = el('section', { class: 'workspace', 'aria-labelledby': `ws-${ws.id}`,
        style: ws.colour ? `--org-accent:${ws.colour}` : null });
      const connected = !!(ws.owner && ws.repo);
      const wsHeader = el('header', {}, el('h2', { id: `ws-${ws.id}` }, `${ws.org_label} `,
        el('span', { class: 'muted' }, `(${ws.pathway_count})`)),
        el('span', { class: `ws-conn ${connected ? 'is-connected' : 'is-disconnected'}` },
          connected ? `${ws.owner}/${ws.repo}` : 'Not connected'));
      if (primary) wsHeader.append(el('span', { class: 'row', style: 'margin-left:auto' },
        btn('⚙', { class: 'btn btn--icon', 'aria-label': `Repository and sync settings for ${ws.org_label}`, 'data-requires-primary': true },
          (ev) => openConnectRepo({ workspace: ws, invoker: ev.currentTarget, ctx })),
        btn('✎', { class: 'btn btn--icon', 'aria-label': `Rename workspace ${ws.org_label}`, 'data-requires-primary': true },
          (ev) => openWorkspaceEditor({ workspace: ws, invoker: ev.currentTarget, ctx })),
        btn('🗑', { class: 'btn btn--icon btn--danger', 'aria-label': `Delete workspace ${ws.org_label}`, 'data-requires-primary': true },
          (ev) => confirmDelete({ noun: 'workspace', name: `${ws.org_label} (${ws.pathway_count} ${ws.pathway_count === 1 ? 'pathway' : 'pathways'})`,
            invoker: ev.currentTarget, onConfirm: () => ctx.db.deleteWorkspace({ id: ws.id }) }))));
      section.append(wsHeader);
      if (primary && statuses[ws.id]) section.append(syncRow(ws, statuses[ws.id], ctx));
      const list = el('ul', { class: 'card-grid', 'data-reorder-scope': 'pathway', role: 'list' });
      items.forEach((p, idx) => {
        const cell = el('li', { class: 'card-cell', 'data-id': p.id, 'data-focus-key': `pathway-card:${p.id}` },
          el('a', { class: 'card', href: `#/pathway/${encodeURIComponent(p.id)}` },
            el('strong', {}, p.name),
            el('p', { class: 'muted' }, `${p.steps} steps · ${p.bookmarks} links`,
              p.broken ? el('span', { class: 'card-broken' }, ` · ${p.broken} broken`) : '')));
        if (primary) cell.append(el('div', { class: 'card-reorder' },
          reorderControls({ entity: 'pathway', id: p.id, index: idx, count: items.length, label: `pathway “${p.name}”` })));
        list.append(cell);
      });
      section.append(list);
      const add = el('button', { type: 'button', class: 'btn',
        'data-requires-primary': true, 'data-focus-key': `add-pathway:${ws.id}` }, '+ New pathway');
      add.addEventListener('click', (ev) => openPathwayEditor({ workspaceId: ws.id, invoker: ev.currentTarget, ctx }));
      if (!primary) add.disabled = true;
      section.append(add);
      root.append(section);
    }
  }
  await refresh();
  teardownReorder = initReorder(root, ctx);
  return controller;
}
