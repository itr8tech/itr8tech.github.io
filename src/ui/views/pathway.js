// src/ui/views/pathway.js — detail: collapsible steps, arrow reorder, sanitized markdown,
// bookmark description + curator context, header image.
import { el, clear } from '../dom.js';
import { initReorder, reorderControls } from '../reorder.js';
import { openPathwayEditor, openStepEditor, openBookmarkEditor, confirmDelete } from '../editors.js';
import { makeObjectUrlScope } from '../attachments.js';

// Link-audit status (P5). status_label is untrusted → only render it if it's a known label.
const AUDIT_LABELS = new Set(['OK', 'Broken', 'Not found', 'Server error', 'Timeout', 'Redirected', 'Auth required', 'Blocked']);
const auditHost = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 30 * 86400000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}

export default async function mount(container, params, ctx) {
  const root = el('div', { class: 'view-content' }); container.append(root);
  let teardownReorder = null, pathwayId = null, exemptDomains = [];
  const imgScope = makeObjectUrlScope();
  const collapsed = new Set();   // collapsed step ids — persists across re-renders
  const controller = { title: 'Pathway', refresh, destroy() { teardownReorder?.(); imgScope.dispose(); } };
  const primary = () => ctx.isPrimary();
  const md = (src) => el('div', { class: 'prose' }, ctx.md.renderMarkdown(src));
  const btn = (txt, props, fn) => { const b = el('button', { type: 'button', ...props }, txt); b.addEventListener('click', fn); return b; };

  // Link-audit pill from the bookmark's audit columns (most-specific first). Untrusted fields are
  // sanitized: status_label enum-clamped, redirect_url routed through safeUrl into the title only.
  function auditBadge(b) {
    const host = auditHost(b.url);
    if (host && exemptDomains.some((d) => host === d || host.endsWith('.' + d)))
      return el('span', { class: 'badge audit-badge audit--muted', title: `Skipped by exemption (${host})` }, 'Exempt');
    if (b.last_checked == null) return null;                    // unchecked → no pill (avoid noise pre-audit)
    const checked = `Checked ${relTime(b.last_checked)}`;
    const withStatus = (t) => (b.http_status ? `${t} · HTTP ${b.http_status}` : t);
    if (b.available === 0)
      return el('span', { class: 'badge audit-badge audit--danger', title: withStatus(checked) }, AUDIT_LABELS.has(b.status_label) ? b.status_label : 'Broken');
    if (b.requires_auth) return el('span', { class: 'badge audit-badge audit--info', title: checked }, 'Auth required');
    if (b.redirect_url) { const safe = ctx.md.safeUrl(b.redirect_url); return el('span', { class: 'badge audit-badge audit--info', title: safe ? `Redirects to ${safe}` : checked }, 'Redirects →'); }
    return el('span', { class: 'badge audit-badge audit--ok', title: withStatus(checked) }, 'OK');
  }

  // ---- collapse: one delegated listener on the persistent root ----
  const applyCollapsed = (li, on) => {
    const body = li.querySelector('.step__body'), toggle = li.querySelector('.step__toggle');
    li.classList.toggle('step--collapsed', on);
    if (body) body.hidden = on;
    if (toggle) toggle.setAttribute('aria-expanded', String(!on));
  };
  function updateCollapseAllBtn() {
    const b = root.querySelector('[data-collapse-all]'); if (!b) return;
    const steps = root.querySelectorAll('li.step');
    const allCollapsed = steps.length > 0 && collapsed.size >= steps.length;
    b.dataset.collapseAll = allCollapsed ? 'expand' : 'collapse';
    b.textContent = allCollapsed ? 'Expand all' : 'Collapse all';
    b.setAttribute('aria-label', allCollapsed ? 'Expand all steps' : 'Collapse all steps');
  }
  root.addEventListener('click', (e) => {
    const tog = e.target.closest('.step__toggle');
    if (tog) {
      const li = tog.closest('[data-id]'), id = li.dataset.id, on = !collapsed.has(id);
      on ? collapsed.add(id) : collapsed.delete(id); applyCollapsed(li, on); updateCollapseAllBtn(); return;
    }
    const all = e.target.closest('[data-collapse-all]');
    if (all) {
      const on = all.dataset.collapseAll === 'collapse';
      for (const li of root.querySelectorAll('li.step')) { on ? collapsed.add(li.dataset.id) : collapsed.delete(li.dataset.id); applyCollapsed(li, on); }
      updateCollapseAllBtn(); announceSteps(on);
    }
  });
  const announceSteps = (on) => ctx.announce(on ? 'All steps collapsed.' : 'All steps expanded.');

  async function refresh() {
    const [p, exempt] = await Promise.all([ctx.db.getPathway(params.id), ctx.db.listExemptDomains()]);
    exemptDomains = exempt.map((e) => e.domain);
    pathwayId = p?.id ?? null;
    teardownReorder?.(); imgScope.dispose(); clear(root);
    if (!p) {
      root.append(el('h1', { 'data-view-heading': true, tabindex: -1 }, 'Pathway not found'),
        el('p', {}, el('a', { href: '#/' }, 'Back to dashboard')));
      return;
    }
    controller.title = p.name;
    if (p.header_image_id) { const url = await imgScope.url(p.header_image_id); if (url) root.append(el('img', { class: 'header-image', src: url, alt: '' })); }
    root.append(el('h1', { 'data-view-heading': true, tabindex: -1 }, p.name));
    if (p.content_warning) root.append(el('div', { class: 'content-warning', role: 'note' }, el('span', { class: 'callout-label' }, 'Content warning'), md(p.content_warning)));
    if (p.description) root.append(md(p.description));

    root.append(el('div', { class: 'row' },
      btn('Edit pathway', { class: 'btn', 'data-requires-primary': true, 'data-focus-key': `edit-pathway:${p.id}` },
        (ev) => openPathwayEditor({ pathway: p, invoker: ev.currentTarget, ctx })),
      btn('Delete pathway', { class: 'btn btn--danger', 'data-requires-primary': true, 'data-focus-key': `del-pathway:${p.id}` },
        (ev) => confirmDelete({ noun: 'pathway', name: p.name, invoker: ev.currentTarget,
          onConfirm: async () => { await ctx.db.deletePathway({ id: p.id }); ctx.navigate('#/'); } })),
      btn('+ Step', { class: 'btn', 'data-requires-primary': true, 'data-focus-key': `add-step:${p.id}` },
        (ev) => openStepEditor({ pathwayId: p.id, invoker: ev.currentTarget, ctx })),
      // P6/P7 exports: read-shaped → usable from a follower tab too
      btn('⬇ Export file', { class: 'btn', 'data-focus-key': `export-pathway:${p.id}` }, async () => {
        try {
          const { buildExportFile } = await import('/src/data/exchange.js');
          const { downloadFile } = await import('../download.js');
          const { filename, content } = await buildExportFile(ctx.db, { scope: 'pathway', id: p.id });
          downloadFile(filename, content);
          ctx.announce(`Exported ${filename}.`);
        } catch (e) { ctx.announce(e.message || 'Export failed.', { assertive: true }); }
      }),
      btn('🌐 Export web page', { class: 'btn', 'data-focus-key': `export-web:${p.id}`,
        title: 'A self-contained interactive page for learners — tracks launch progress in their browser' }, async () => {
        try {
          const { buildPathwayHtml } = await import('../publish-html.js');
          const { downloadFile } = await import('../download.js');
          const { filename, content } = await buildPathwayHtml(ctx.db, { id: p.id });
          downloadFile(filename, content, 'text/html;charset=utf-8');
          ctx.announce(`Exported ${filename}.`);
        } catch (e) { ctx.announce(e.message || 'Export failed.', { assertive: true }); }
      })));

    if (p.steps.length) root.append(el('div', { class: 'steps-toolbar' },
      el('button', { type: 'button', class: 'btn btn--subtle', 'data-collapse-all': 'collapse' }, 'Collapse all')));

    const stepsList = el('ol', { class: 'steps', 'data-reorder-scope': 'step', role: 'list' });
    p.steps.forEach((s, i) => stepsList.append(renderStep(s, i, p.steps.length)));
    root.append(stepsList);

    teardownReorder = initReorder(root, ctx);
    updateCollapseAllBtn();
    if (!primary()) for (const c of root.querySelectorAll('[data-requires-primary]')) {
      if ('disabled' in c && c.tagName !== 'A') c.disabled = true; else { c.setAttribute('aria-disabled', 'true'); c.tabIndex = -1; }
    }
  }

  function renderStep(s, i, total) {
    const on = collapsed.has(s.id), bodyId = `sb-${s.id}`, n = s.bookmarks.length;
    const li = el('li', { class: 'step' + (on ? ' step--collapsed' : ''), 'data-id': s.id, 'data-focus-key': `step:${s.id}` });
    const toggle = el('button', { class: 'step__toggle', type: 'button', 'aria-expanded': String(!on), 'aria-controls': bodyId },
      el('span', { class: 'chevron', 'aria-hidden': 'true' }, '▸'),
      el('span', { class: 'step__num' }, String(i + 1)),
      el('span', { class: 'step__title' }, s.name),
      el('span', { class: 'step__meta muted' }, ` · ${n} ${n === 1 ? 'link' : 'links'}`));
    const header = el('div', { class: 'step__header' },
      el('h2', { class: 'step__name' }, toggle),
      el('span', { class: 'step__controls' },
        reorderControls({ entity: 'step', id: s.id, index: i, count: total, label: `step “${s.name}”` }),
        btn('✎', { class: 'btn btn--icon', 'data-requires-primary': true, 'aria-label': 'Edit step', 'data-focus-key': `edit-step:${s.id}` },
          (ev) => openStepEditor({ pathwayId, step: s, invoker: ev.currentTarget, ctx })),
        btn('🗑', { class: 'btn btn--icon btn--danger', 'data-requires-primary': true, 'aria-label': 'Delete step' },
          (ev) => confirmDelete({ noun: 'step', name: s.name, invoker: ev.currentTarget, onConfirm: () => ctx.db.deleteStep({ id: s.id }) }))));
    const body = el('div', { class: 'step__body', id: bodyId });
    if (on) body.hidden = true;
    if (s.objective) body.append(md(s.objective));
    const bl = el('ul', { class: 'bookmarks', 'data-reorder-scope': 'bookmark', 'data-parent': s.id, role: 'list' });
    s.bookmarks.forEach((b, bi) => bl.append(renderBookmark(b, bi, n, s.id)));
    body.append(bl, btn('+ Link', { class: 'btn', 'data-requires-primary': true, 'data-focus-key': `add-link:${s.id}` },
      (ev) => openBookmarkEditor({ stepId: s.id, invoker: ev.currentTarget, ctx })));
    if (s.pause_and_reflect) body.append(el('div', { class: 'pause-reflect' }, el('span', { class: 'callout-label' }, 'Pause & reflect'), md(s.pause_and_reflect)));
    li.append(header, body);
    return li;
  }

  function renderBookmark(b, i, total, stepId) {
    const li = el('li', { class: 'bookmark', 'data-id': b.id, 'data-focus-key': `bookmark:${b.id}` });
    li.append(el('div', { class: 'bookmark__head' },
      reorderControls({ entity: 'bookmark', id: b.id, index: i, count: total, label: `link “${b.title || b.url}”` }),
      el('a', { class: 'bookmark__title', href: b.url, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, b.title || b.url),
      el('span', { class: 'bookmark__badges' },
        el('span', { class: 'badge', 'data-type': b.content_type }, b.content_type),
        el('span', { class: b.required ? 'badge badge--required' : 'badge badge--bonus' }, b.required ? 'Required' : 'Bonus'),
        auditBadge(b))));
    if (b.description) li.append(el('div', { class: 'prose bookmark__desc' }, ctx.md.renderMarkdown(b.description)));
    if (b.context) li.append(el('div', { class: 'bookmark__context' },
      el('span', { class: 'callout-label' }, 'Curator context'), el('div', { class: 'prose' }, ctx.md.renderMarkdown(b.context))));
    li.append(el('div', { class: 'row bookmark__actions' },
      btn('Edit', { class: 'btn btn--icon', 'data-requires-primary': true, 'aria-label': 'Edit link', 'data-focus-key': `edit-bm:${b.id}` },
        (ev) => openBookmarkEditor({ stepId, bm: b, invoker: ev.currentTarget, ctx })),
      btn('Delete', { class: 'btn btn--icon btn--danger', 'data-requires-primary': true, 'aria-label': 'Delete link' },
        (ev) => confirmDelete({ noun: 'link', name: b.title || b.url, invoker: ev.currentTarget, onConfirm: () => ctx.db.deleteBookmark({ id: b.id }) }))));
    return li;
  }

  await refresh();
  return controller;
}
