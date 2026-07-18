// src/ui/ext-bridge.js — P8: the app side of the extension bridge. Listens for the content
// script's announcements/pongs (window.postMessage, same-window + same-origin + nonce checked),
// and runs PAGE-DRIVEN CHUNKED audits: ≤40 URLs per request (MV3 SW lifetime: each chunk is one
// short event; a killed SW costs one retryable chunk), merging each chunk's results immediately
// through the existing mergeAuditResults (idempotent; overrides/exemptions already enforced by
// the worker and by listAuditUrls itself). Results are device-local by design.
const CHUNK = 40;
const CHUNK_TIMEOUT = 90000;

let extInfo = null;                 // { version, auditReady } once detected
const subscribers = new Set();
const pendingChunks = new Map();    // nonce → {resolve}

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.origin !== location.origin) return;
  const d = ev.data;
  if (!d || typeof d !== 'object') return;
  if (d.pc === 'ext-pong') {
    extInfo = { version: d.version ?? null, auditReady: !!d.auditReady };
    for (const cb of subscribers) { try { cb(extInfo); } catch { /* subscriber's problem */ } }
  } else if (d.pc === 'ext-audit-result' && pendingChunks.has(d.nonce)) {
    pendingChunks.get(d.nonce).resolve(d);
    pendingChunks.delete(d.nonce);
  }
});

export const ping = () => window.postMessage({ pc: 'ext-ping', nonce: crypto.randomUUID() }, location.origin);
export const extensionInfo = () => extInfo;
export function onExtension(cb) {
  subscribers.add(cb);
  if (extInfo) cb(extInfo);
  ping();                                            // covers the content-script-announced-first race
  return () => subscribers.delete(cb);
}

function auditChunk(urls) {
  const nonce = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingChunks.has(nonce)) { pendingChunks.delete(nonce); resolve({ ok: false, error: 'Timed out waiting for the extension.', results: {} }); }
    }, CHUNK_TIMEOUT);
    pendingChunks.set(nonce, { resolve: (d) => { clearTimeout(timer); resolve(d); } });
    window.postMessage({ pc: 'ext-audit', nonce, urls }, location.origin);
  });
}

// Audit one workspace (null = pathways without a workspace). onProgress(done, total).
export async function runExtensionAudit(db, workspaceId, onProgress) {
  const list = await db.listAuditUrls(workspaceId);
  let done = 0, updated = 0, failedChunks = 0, lastError = null;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const res = await auditChunk(chunk);
    if (!res.ok) { failedChunks++; lastError = res.error || 'Extension error.'; done += chunk.length; onProgress?.(done, list.length); continue; }
    const results = {};
    for (const item of chunk) if (res.results[item.url_norm]) results[item.url_norm] = res.results[item.url_norm];
    const m = await db.mergeAuditResults({ workspaceId, results, checkMethod: 'extension' });
    updated += m.updated;
    done += chunk.length;
    onProgress?.(done, list.length);
  }
  return { total: list.length, updated, failedChunks, lastError };
}
