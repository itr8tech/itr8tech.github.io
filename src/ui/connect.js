// src/ui/connect.js — connect-a-repo wizard (P3). Native <dialog>, no innerHTML with user data.
// Creates a NEW workspace (or connects an existing one) to a GitHub repo: validate the PAT →
// store repo config + token (main-thread secrets) → initialize an empty repo, or pull an
// existing one (pull lands in step 6). Every mutating control is data-requires-primary.
import { el } from './dom.js';
import { announce } from './a11y.js';

function mountDialog(dlg, invoker) {
  document.body.append(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); invoker?.focus?.(); }, { once: true });
  dlg.showModal();
}

const trimSlashes = (s) => String(s || '').replace(/^\/+|\/+$/g, '');
const manifestPathFor = (path) => (trimSlashes(path) ? trimSlashes(path) + '/' : '') + 'manifest.json';

// Accept "owner/repo" or a pasted GitHub URL (https://github.com/owner/repo[/…][.git]).
function parseRepoRef(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const url = str.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/i);
  if (url) return { owner: url[1], repo: url[2] };
  const parts = trimSlashes(str).split('/');
  if (parts.length === 2 && parts[0] && parts[1]) return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  return null;
}

function friendlyError(ex) {
  const s = ex?.status;
  if (s === 401) return 'That access token was rejected. Check it has Contents: Read and write on this repo.';
  if (s === 404) return 'Repository or branch not found. Check the owner, name, and branch.';
  if (s === 403) return 'Access denied (permissions or rate limit). Check the token’s repository access.';
  return ex?.message || 'Could not connect. Check the details and try again.';
}

export function openConnectRepo({ workspace = null, invoker, ctx }) {
  const isNew = !workspace;
  const hadRepo = !!(workspace && workspace.owner && workspace.repo);
  const dlg = el('dialog', { class: 'pc-editor' });

  const name = el('input', { name: 'name', type: 'text', required: true, value: workspace?.org_label ?? '' });
  const repoRef = el('input', { name: 'repo_ref', type: 'text', required: !isNew, autocomplete: 'off', placeholder: 'owner/repo',
    value: (workspace?.owner && workspace?.repo) ? `${workspace.owner}/${workspace.repo}` : '', 'aria-describedby': 'repo-help' });
  const repoHelp = el('span', { class: 'muted field-help', id: 'repo-help' },
    'The repository’s owner and name, e.g. itr8tech/pathcurator-app — you can also paste the GitHub URL.');
  const branch = el('input', { name: 'branch', type: 'text', value: workspace?.branch ?? 'main', autocomplete: 'off' });
  const path = el('input', { name: 'path', type: 'text', value: workspace?.path ?? '', autocomplete: 'off', placeholder: '(repository root)' });
  const pat = el('input', { name: 'pat', type: 'password', autocomplete: 'off', 'aria-describedby': 'pat-help' });
  const patHelp = el('span', { class: 'muted field-help', id: 'pat-help' },
    'A GitHub fine-grained token with Contents: Read and write on just this repository. Stored encrypted on this device — never committed.');
  const err = el('p', { class: 'field-error', role: 'alert' });
  const status = el('p', { class: 'muted', role: 'status' });
  const submit = el('button', { type: 'submit', class: 'btn btn--primary', 'data-requires-primary': true }, isNew ? 'Create workspace' : 'Save connection');

  const ghFields = el('fieldset', { class: 'gh-optional' },
    isNew ? el('legend', {}, 'Connect a GitHub repo (optional)') : null,
    el('label', {}, 'Repository', repoRef, repoHelp),
    el('div', { class: 'field-row' }, el('label', {}, 'Branch', branch), el('label', {}, 'Subfolder (optional)', path)),
    el('label', {}, hadRepo ? 'Replace access token (optional)' : 'Access token', pat, patHelp));
  const rows = [isNew ? el('label', {}, 'Workspace name', name) : null, ghFields].filter(Boolean);

  const actions = el('div', { class: 'form-actions' });
  if (hadRepo) {
    const disconnect = el('button', { type: 'button', class: 'btn btn--danger', 'data-requires-primary': true, style: 'margin-right:auto' }, 'Disconnect');
    disconnect.addEventListener('click', async () => {
      disconnect.disabled = true;
      try { await ctx.db.disconnectWorkspaceRepo({ id: workspace.id }); announce('Repository disconnected. Pathways kept.'); dlg.close('ok'); }
      catch (ex) { err.textContent = friendlyError(ex); disconnect.disabled = false; }
    });
    actions.append(disconnect);
  }
  actions.append(el('button', { type: 'button', class: 'btn' }, 'Cancel'), submit);
  actions.querySelector('.btn:not(.btn--danger):not(.btn--primary)').addEventListener('click', () => dlg.close('cancel'));

  const form = el('form', { novalidate: true, 'aria-labelledby': 'conn-h' },
    el('h2', { id: 'conn-h', 'data-view-heading': true, tabindex: -1 }, isNew ? 'New workspace' : `Repository & sync — ${workspace.org_label}`),
    ...rows, err, status, actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = ''; status.textContent = '';
    const ref = parseRepoRef(repoRef.value);
    const o = ref?.owner || '', r = ref?.repo || '', br = branch.value.trim() || 'main', pth = trimSlashes(path.value);
    const token = pat.value;
    if (isNew && !name.value.trim()) { err.textContent = 'Workspace name is required.'; name.focus(); return; }

    // New workspace with no repo details → create a local-only workspace (connect a repo later via ⚙).
    if (isNew && !repoRef.value.trim() && !token) {
      submit.disabled = true; dlg.setAttribute('aria-busy', 'true');
      try { await ctx.db.createWorkspace({ org_label: name.value }); announce('Workspace created.'); dlg.close('ok'); }
      catch (ex) { err.textContent = friendlyError(ex); submit.disabled = false; }
      finally { dlg.removeAttribute('aria-busy'); }
      return;
    }
    // Otherwise a repo is being connected.
    if (!ref) { err.textContent = 'Enter the repository as owner/repo (for example, itr8tech/pathcurator-app).'; repoRef.focus(); return; }
    if (!hadRepo && !token) { err.textContent = 'An access token is required to connect a repository.'; pat.focus(); return; }

    submit.disabled = true; dlg.setAttribute('aria-busy', 'true');
    let wsId = workspace?.id;
    try {
      let login = workspace?.username ?? null;
      if (token) {
        status.textContent = 'Verifying access token…';
        login = (await ctx.githubFactory({ owner: o, repo: r, branch: br, path: pth, token }).getUser()).login;
      }
      status.textContent = 'Saving connection…';
      if (isNew) {
        wsId = (await ctx.db.createWorkspace({ token, org_label: name.value, owner: o, repo: r, branch: br, path: pth, username: login })).id;
      } else {
        await ctx.db.setWorkspaceRepo({ id: wsId, token: token || undefined, owner: o, repo: r, branch: br, path: pth, username: login });
      }

      const activeToken = token || await ctx.db.getWorkspacePat(wsId);
      const client = ctx.githubFactory({ owner: o, repo: r, branch: br, path: pth, token: activeToken });
      const head = await client.headFile(o, r, manifestPathFor(pth), br);

      if (head.exists) {
        status.textContent = 'Repository already has content — importing…';
        const res = await ctx.sync.pull(wsId, { interactive: true });
        dlg.close('ok');
        if (res.needsReview) { announce('Repository connected. Review the incoming changes.'); ctx.navigate(`/merge/${encodeURIComponent(wsId)}`); return; }
        const a = res.applied || {};
        const bits = [];
        if (a.added) bits.push(`${a.added} imported`);
        if (a.replaced) bits.push(`${a.replaced} updated from the repository`);
        announce(bits.length ? `Repository connected. ${bits.join(', ')}.` : 'Repository connected and imported.');
        return;
      } else {
        status.textContent = 'Initializing repository…';
        await ctx.sync.initialize(wsId);
        announce('Repository connected and initialized.');
      }
      dlg.close('ok');
    } catch (ex) {
      err.textContent = friendlyError(ex);
      submit.disabled = false;
    } finally {
      dlg.removeAttribute('aria-busy');
    }
  });

  dlg.append(form);
  mountDialog(dlg, invoker);
  (isNew ? name : repoRef).focus();
}
