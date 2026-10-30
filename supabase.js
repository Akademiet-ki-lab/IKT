/* Helpnotes — skysynk mot Supabase (REST, uten SDK og uten CDN)
 *
 * Offline-først: saker lagres alltid lokalt først. Er Supabase koblet til, synkroniseres
 * endringene i bakgrunnen (henter nye saker, sender egne, løser konflikter etter
 * "sist endret vinner"). Slettinger synkroniseres som "myke" slettinger (deleted_at).
 */
(function (global) {
  'use strict';

  const CONFIG_KEY = 'ikt_supabase_config';
  const TABLE = 'helpnotes_tickets';
  const PAGE = 1000;
  const PUSH_CHUNK = 200;
  const SYNC_INTERVAL_MS = 45000;

  /* ---------- Små hjelpere ---------- */
  const text = value => String(value ?? '');
  const time = value => { const t = new Date(value).getTime(); return Number.isNaN(t) ? 0 : t; };
  const norm = value => text(value).trim().toLocaleLowerCase('nb');

  class CloudError extends Error {
    constructor(message, kind, status) { super(message); this.name = 'CloudError'; this.kind = kind || 'server'; this.status = status || 0; }
  }

  function decodeJwtRole(token) {
    try {
      const part = text(token).split('.')[1];
      if (!part) return null;
      const json = (typeof atob === 'function' ? atob : s => Buffer.from(s, 'base64').toString('binary'))(part.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json).role || null;
    } catch (error) { return null; }
  }

  function validateConfig(url, anonKey) {
    const cleanUrl = text(url).trim().replace(/\/+$/, '');
    const key = text(anonKey).trim();
    if (!cleanUrl) return { ok: false, message: 'Lim inn Project URL fra Supabase (Project Settings → API).' };
    if (!/^https:\/\/[^\s/]+$/i.test(cleanUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanUrl)) return { ok: false, message: 'URL-en må se slik ut: https://xxxxxxxx.supabase.co' };
    if (!key) return { ok: false, message: 'Lim inn anon- eller publishable-nøkkelen.' };
    if (key.startsWith('sb_secret_') || decodeJwtRole(key) === 'service_role') return { ok: false, message: 'Dette er en hemmelig nøkkel (service_role). Den må aldri brukes i nettleseren. Bruk anon- eller publishable-nøkkelen.' };
    if (!key.startsWith('sb_publishable_') && key.split('.').length !== 3) return { ok: false, message: 'Nøkkelen ser ikke riktig ut. Kopier «anon» eller «publishable» fra Project Settings → API.' };
    return { ok: true, url: cleanUrl, anonKey: key };
  }

  /* ---------- Konvertering mellom app og database ---------- */
  function toRow(c) {
    return {
      id: c.id, number: c.number, technician: text(c.technician), user_name: text(c.user), room: text(c.room),
      equipment: text(c.equipment), serial: text(c.serial), loan_id: text(c.loanId), category: text(c.category),
      priority: text(c.priority), symptom: text(c.symptom), cause: text(c.cause), action: text(c.action),
      shift_notes: text(c.shiftNotes), status: text(c.status), created_at: c.createdAt, updated_at: c.updatedAt, deleted_at: null
    };
  }

  function fromRow(r) {
    return {
      id: text(r.id), number: text(r.number), technician: text(r.technician), user: text(r.user_name), room: text(r.room),
      equipment: text(r.equipment), serial: text(r.serial), loanId: text(r.loan_id), category: text(r.category),
      priority: text(r.priority), symptom: text(r.symptom), cause: text(r.cause), action: text(r.action),
      shiftNotes: text(r.shift_notes), status: text(r.status),
      createdAt: new Date(r.created_at || Date.now()).toISOString(), updatedAt: new Date(r.updated_at || r.created_at || Date.now()).toISOString(),
      deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null
    };
  }

  /* ---------- Flettelogikk (ren funksjon, testbar) ---------- */
  function merge(local, remote, deletions, now) {
    const stamp = now || new Date().toISOString();
    const pending = deletions || {};
    const localById = new Map(local.map(c => [c.id, c]));
    const remoteIds = new Set(remote.map(r => r.id));
    const out = new Map();
    const toPush = new Map();
    const deletionPush = [];
    const deletionClear = [];
    let pulled = 0;

    for (const r of remote) {
      if (pending[r.id]) { (r.deletedAt ? deletionClear : deletionPush).push(r.id); continue; }
      if (r.deletedAt) {
        // slettet et annet sted: fjernes lokalt, med mindre saken er endret/gjenopprettet etter slettingen
        const l = localById.get(r.id);
        if (l && time(l.updatedAt) > time(r.deletedAt)) { out.set(l.id, l); toPush.set(l.id, l); }
        continue;
      }
      const l = localById.get(r.id);
      if (!l) { out.set(r.id, r); pulled += 1; }
      else if (time(r.updatedAt) > time(l.updatedAt)) { out.set(r.id, { ...l, ...r }); pulled += 1; }
      else { out.set(r.id, l); if (time(l.updatedAt) > time(r.updatedAt)) toPush.set(l.id, l); }
    }
    for (const l of local) {
      if (!remoteIds.has(l.id) && !pending[l.id]) { out.set(l.id, l); toPush.set(l.id, l); }
    }
    for (const id of Object.keys(pending)) if (!remoteIds.has(id)) deletionClear.push(id);

    // Samme saksnummer opprettet på to enheter: den eldste beholder nummeret
    let list = [...out.values()];
    const groups = new Map();
    for (const c of list) { const k = norm(c.number); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    let highest = 1000;
    for (const c of list) { const m = text(c.number).match(/^INC-(\d+)$/i); if (m) highest = Math.max(highest, Number(m[1])); }
    const renumbered = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
      for (const c of group.slice(1)) {
        highest += 1;
        const fixed = { ...c, number: `INC-${highest}`, updatedAt: stamp };
        out.set(c.id, fixed); toPush.set(c.id, fixed); renumbered.push(fixed.number);
      }
    }
    list = [...out.values()];
    return { cases: list, toPush: [...toPush.values()], deletionPush, deletionClear, pulled, renumbered };
  }

  /* ---------- Konfigurasjon og innlogging ---------- */
  function readStored() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {}; } catch (error) { return {}; }
  }

  function getConfig() {
    const stored = readStored();
    const file = global.IKT_CONFIG || {};
    const pick = (a, b) => (text(a).trim() ? text(a).trim() : text(b).trim());
    return {
      url: pick(stored.url, file.supabaseUrl).replace(/\/+$/, ''),
      anonKey: pick(stored.anonKey, file.supabaseAnonKey),
      requireLogin: stored.requireLogin ?? file.requireLogin ?? true,
      email: text(stored.email),
      session: stored.session || null
    };
  }

  function saveConfig(patch) {
    const next = { ...readStored(), ...patch };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    return getConfig();
  }

  function clearConfig() { localStorage.removeItem(CONFIG_KEY); setStatus({ state: 'off' }); }
  function isConfigured() { const c = getConfig(); return validateConfig(c.url, c.anonKey).ok; }

  async function authRequest(cfg, grant, body) {
    let res;
    try {
      res = await fetch(`${cfg.url}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) { throw new CloudError('Ingen kontakt med Supabase. Sjekk URL-en og nettforbindelsen.', 'network'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new CloudError(grant === 'password' ? 'Feil e-post eller passord.' : 'Innloggingen har utløpt. Logg inn på nytt.', 'auth', res.status);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000, email: data.user?.email || body.email || '' };
  }

  async function signIn(email, password) {
    const cfg = getConfig();
    const check = validateConfig(cfg.url, cfg.anonKey);
    if (!check.ok) throw new CloudError(check.message, 'config');
    const session = await authRequest(cfg, 'password', { email: text(email).trim(), password });
    saveConfig({ email: session.email, session });
    setStatus({ state: 'syncing', message: 'Logget inn' });
    requestSync(100);
    return session;
  }

  function signOut() {
    saveConfig({ session: null });
    setStatus(isConfigured() && getConfig().requireLogin ? { state: 'auth' } : { state: isConfigured() ? 'idle' : 'off' });
  }

  async function accessToken(cfg) {
    const s = cfg.session;
    if (!s) return null;
    if (Date.now() < s.expiresAt - 60000) return s.accessToken;
    try {
      const fresh = await authRequest(cfg, 'refresh_token', { refresh_token: s.refreshToken });
      saveConfig({ session: fresh });
      return fresh.accessToken;
    } catch (error) { saveConfig({ session: null }); throw error; }
  }

  function explain(status, body) {
    let info = {};
    try { info = JSON.parse(body); } catch (error) { info = { message: body }; }
    const msg = text(info.message || info.error_description || info.hint || body).slice(0, 200);
    if (info.code === 'PGRST205' || info.code === '42P01' || status === 404) return new CloudError('Tabellen «helpnotes_tickets» finnes ikke. Kjør supabase/schema.sql i Supabase → SQL Editor.', 'schema', status);
    if (status === 401 || status === 403 || info.code === '42501') return new CloudError('Ingen tilgang til Supabase. Sjekk at policyene fra supabase/schema.sql er opprettet.', 'auth', status);
    return new CloudError(msg || `Feil fra Supabase (${status}).`, 'server', status);
  }

  async function api(cfg, path, options = {}) {
    const token = await accessToken(cfg);
    const headers = { apikey: cfg.anonKey, 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (cfg.anonKey.split('.').length === 3) headers.Authorization = `Bearer ${cfg.anonKey}`;
    let res;
    try { res = await fetch(`${cfg.url}/rest/v1/${path}`, { method: options.method || 'GET', headers, body: options.body ? JSON.stringify(options.body) : undefined }); }
    catch (error) { throw new CloudError('Ingen nettforbindelse til Supabase.', 'network'); }
    if (!res.ok) throw explain(res.status, await res.text().catch(() => ''));
    return res;
  }

  async function pullAll(cfg) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const res = await api(cfg, `${TABLE}?select=*&order=updated_at.desc`, { headers: { 'Range-Unit': 'items', Range: `${from}-${from + PAGE - 1}` } });
      const page = await res.json();
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  }

  async function pushRows(cfg, rows) {
    for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
      await api(cfg, `${TABLE}?on_conflict=id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: rows.slice(i, i + PUSH_CHUNK) });
    }
  }

  async function markDeleted(cfg, ids, deletions) {
    for (const id of ids) {
      const at = deletions[id] || new Date().toISOString();
      await api(cfg, `${TABLE}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { deleted_at: at, updated_at: at } });
    }
  }

  async function testConnection(draft) {
    const check = validateConfig(draft.url, draft.anonKey);
    if (!check.ok) return { ok: false, message: check.message };
    const cfg = { ...getConfig(), url: check.url, anonKey: check.anonKey, requireLogin: draft.requireLogin !== false };
    try {
      await api(cfg, `${TABLE}?select=id&limit=1`);
      if (cfg.requireLogin && !cfg.session) return { ok: true, message: 'Tilkoblingen virker. Logg inn for å lagre og hente saker.' };
      return { ok: true, message: 'Tilkoblingen virker, og tabellen «helpnotes_tickets» er klar.' };
    } catch (error) { return { ok: false, message: error.message }; }
  }

  /* ---------- Synkronisering ---------- */
  let ctx = null;
  let status = { state: 'off', message: 'Kun lokal lagring', at: null };
  const listeners = [];
  let syncing = false;
  let queued = false;
  let timer = 0;
  let interval = 0;

  function describe(s) {
    const clock = s.at ? new Date(s.at).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : '';
    switch (s.state) {
      case 'off': return { label: 'Kun lokalt', detail: 'Ikke koblet til Supabase. Sakene lagres kun på denne enheten.' };
      case 'idle': return { label: 'Koblet til', detail: 'Klar til å synkronisere.' };
      case 'syncing': return { label: 'Synkroniserer …', detail: 'Sender og henter endringer.' };
      case 'synced': return { label: `Synkronisert ${clock}`, detail: s.message || 'Alt er oppdatert i Supabase.' };
      case 'offline': return { label: 'Frakoblet', detail: s.message || 'Ingen nettforbindelse. Endringer sendes når du er på nett igjen.' };
      case 'auth': return { label: 'Logg inn', detail: s.message || 'Logg inn for å synkronisere sakene.' };
      case 'error': return { label: 'Synkfeil', detail: s.message || 'Noe gikk galt under synkroniseringen.' };
      default: return { label: '', detail: '' };
    }
  }

  function setStatus(patch) {
    status = { ...status, message: '', ...patch };
    const view = { ...status, ...describe(status) };
    listeners.forEach(fn => { try { fn(view); } catch (error) { console.warn(error); } });
  }

  function attach(context) { ctx = context; startTimers(); refreshIdleStatus(); }

  function refreshIdleStatus() {
    if (!isConfigured()) return setStatus({ state: 'off' });
    const cfg = getConfig();
    if (cfg.requireLogin && !cfg.session) return setStatus({ state: 'auth' });
    if (status.state === 'off' || status.state === 'auth') setStatus({ state: 'idle' });
  }

  function startTimers() {
    if (interval || typeof window === 'undefined') return;
    interval = setInterval(() => { if (document.visibilityState === 'visible') requestSync(0); }, SYNC_INTERVAL_MS);
    window.addEventListener('online', () => requestSync(200));
    window.addEventListener('offline', () => { if (isConfigured()) setStatus({ state: 'offline' }); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(300); });
  }

  function requestSync(delay = 800) {
    if (!ctx || !isConfigured()) return;
    clearTimeout(timer);
    timer = setTimeout(sync, delay);
  }

  async function sync() {
    if (!ctx) return { ok: false };
    const cfg = getConfig();
    if (!validateConfig(cfg.url, cfg.anonKey).ok) { setStatus({ state: 'off' }); return { ok: false }; }
    if (cfg.requireLogin && !cfg.session) { setStatus({ state: 'auth' }); return { ok: false }; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus({ state: 'offline' }); return { ok: false }; }
    if (syncing) { queued = true; return { ok: false }; }
    syncing = true;
    setStatus({ state: 'syncing' });
    try {
      const remote = (await pullAll(cfg)).map(fromRow);
      const result = merge(ctx.getCases(), remote, ctx.getDeletions());
      ctx.applyMerge(result.cases);
      if (result.toPush.length) await pushRows(cfg, result.toPush.map(toRow));
      const deletions = ctx.getDeletions();
      if (result.deletionPush.length) await markDeleted(cfg, result.deletionPush, deletions);
      const cleared = [...result.deletionClear, ...result.deletionPush];
      if (cleared.length) ctx.clearDeletions(cleared);
      const parts = [];
      if (result.pulled) parts.push(`${result.pulled} hentet`);
      if (result.toPush.length) parts.push(`${result.toPush.length} sendt`);
      if (result.renumbered.length) parts.push(`saksnummer endret: ${result.renumbered.join(', ')}`);
      setStatus({ state: 'synced', at: Date.now(), message: parts.length ? parts.join(' · ') : 'Alt er oppdatert i Supabase.' });
      return { ok: true, ...result };
    } catch (error) {
      const kind = error.kind || 'error';
      if (kind === 'network') setStatus({ state: 'offline', message: error.message });
      else if (kind === 'auth') setStatus({ state: 'auth', message: error.message });
      else setStatus({ state: 'error', message: error.message });
      return { ok: false, error };
    } finally {
      syncing = false;
      if (queued) { queued = false; requestSync(300); }
    }
  }

  const api_ = {
    TABLE, CONFIG_KEY,
    getConfig, saveConfig, clearConfig, isConfigured, validateConfig,
    signIn, signOut, testConnection,
    attach, requestSync, syncNow: sync, refreshStatus: refreshIdleStatus,
    onStatus(fn) { listeners.push(fn); fn({ ...status, ...describe(status) }); },
    getStatus() { return { ...status, ...describe(status) }; },
    _internals: { merge, toRow, fromRow, decodeJwtRole, explain }
  };

  global.IKTCloud = api_;
  if (typeof module !== 'undefined' && module.exports) module.exports = api_;
})(typeof window !== 'undefined' ? window : globalThis);
