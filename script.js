(() => {
  'use strict';

  /* ---------- Konstanter ---------- */
  const STORAGE_KEY = 'ikt_school_tickets_v2';
  const DELETIONS_KEY = 'ikt_pending_deletions';
  const DRAFT_KEY = 'ikt_case_draft';
  const LAST_TECH_KEY = 'ikt_last_technician';
  const BACKUP_KEY = 'ikt_last_backup';
  const LEGACY_KEY = 'ikt-pulten-cases-v1';
  const TECHNICIANS = ['Aksel', 'Wajid', 'Qasim'];
  const LEGACY_TECHNICIANS = { 'elev 1 - alex': 'Aksel', alex: 'Aksel', 'elev 2 - nora': 'Wajid', nora: 'Wajid', 'elev 3 - jonas': 'Qasim', jonas: 'Qasim' };
  const CATEGORIES = ['#Hardware', '#Programvare', '#Nettverk', '#Feide', '#Skriver', '#Annet'];
  const PRIORITIES = ['Lav', 'Middels', 'Høy', 'Haster'];
  const PRIORITY_RANK = { Haster: 4, 'Høy': 3, Middels: 2, Lav: 1 };
  const STATUS = { SOLVED: 'Løst', WAITING: 'Venter på deler/bruker', ESCALATED: 'Eskalert til IKT-ansvarlig' };
  const STATUSES = Object.values(STATUS);
  const STATUS_META = [[STATUS.SOLVED, 'Løst', 'good'], [STATUS.WAITING, 'Venter', 'wait'], [STATUS.ESCALATED, 'Eskalert', 'alert']];
  const VIEWS = ['dashboard', 'new', 'log'];
  const VIEW_TITLES = { dashboard: 'Oversikt', new: 'Saksnotat', log: 'Sakslogg' };
  const REQUIRED = [['technician', 'Hvem du er'], ['user', 'Hvem som trenger hjelp'], ['category', 'Hva som er galt'], ['symptom', 'Fortell med egne ord'], ['status', 'Hva som skjedde']];
  const PAGE_SIZE = 50;
  const BACKUP_STALE_DAYS = 7;

  const templates = {
    feide: { category: '#Feide', symptom: 'Brukeren får ikke logget inn med Feide og har glemt passordet.', cause: 'Passordet er glemt eller utløpt.', action: 'Veiledet brukeren til skolens rutine for passordbytte. Testet innlogging sammen med brukeren.' },
    disk: { category: '#Hardware', symptom: 'Brukeren får varsel om at disken er full og kan ikke lagre nye filer.', cause: 'Lagringsplassen er brukt opp av lokale filer og midlertidige data.', action: 'Gikk gjennom lagringsoversikten, fjernet unødvendige midlertidige filer og flyttet dokumenter til godkjent skylagring.' },
    wifi: { category: '#Nettverk', symptom: 'Enheten kobler ikke til skolens Wi-Fi eller mister forbindelsen.', cause: 'Nettverksprofilen var utdatert / tilkoblingen var falt ut.', action: 'Kontrollerte Wi-Fi, koblet fra og til skolens nettverk på nytt og testet tilkoblingen.' },
    print: { category: '#Skriver', symptom: 'Dokumentet blir stående i utskriftskøen og kommer ikke ut.', cause: 'Utskriftskøen hadde en fastlåst jobb.', action: 'Tømte utskriftskøen, la inn jobben på nytt og bekreftet utskrift.' },
    slow: { category: '#Hardware', symptom: 'PC-en oppleves treg og programmer bruker lang tid på å åpne.', cause: 'Mange åpne programmer / enheten trengte omstart.', action: 'Lagret åpne arbeider, startet enheten på nytt og testet at ytelsen var bedre.' }
  };

  /* ---------- Hjelpefunksjoner ---------- */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const text = value => String(value ?? '');
  const safe = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
  const sameNumber = (a, b) => text(a).trim().toLocaleLowerCase('nb') === text(b).trim().toLocaleLowerCase('nb');
  const cloud = window.IKTCloud || {
    SQL: '', getConfig: () => ({ url: '', anonKey: '', requireLogin: true, email: '', session: null }), saveConfig() {}, clearConfig() {}, isConfigured: () => false,
    signIn: async () => { throw new Error('Skysynk er ikke tilgjengelig.'); }, signOut() {}, testConnection: async () => ({ ok: false, message: 'Skysynk er ikke tilgjengelig.' }),
    attach() {}, requestSync() {}, syncNow: async () => ({ ok: false }), refreshStatus() {}, onStatus(fn) { fn({ state: 'off', label: 'Kun lokalt', detail: '' }); }, validateConfig: () => ({ ok: false, message: '' })
  };

  /* Anonymisering: personer lagres som «Elev 3» (nummerert per klasse) eller «Lærer 2» */
  const ANON_RE = /^(Elev|Lærer) \d+$/;
  const normClass = value => text(value).replace(/\s+/g, '').toLocaleUpperCase('nb');
  const whoLabel = c => c.user ? (c.room ? `${c.user} (${c.room})` : c.user) : 'Ukjent bruker';

  const initial = name => (text(name).trim()[0] || '?').toLocaleUpperCase('nb');
  const avatar = (name, small = false) => `<span class="avatar"${small ? ' style="width:30px;height:30px;font-size:17px"' : ''} title="${safe(name || 'Ukjent tekniker')}">${safe(initial(name))}</span>`;

  function validDate(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
  function prettyDate(value) { const d = validDate(value); return d ? new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }).format(d) : 'Ukjent dato'; }
  function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function dayLabel(value) {
    const d = validDate(value); if (!d) return 'Ukjent dato';
    const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 86400000);
    if (diff <= 0) return 'I dag';
    if (diff === 1) return 'I går';
    if (diff < 7) { const w = new Intl.DateTimeFormat('nb-NO', { weekday: 'long' }).format(d); return w[0].toUpperCase() + w.slice(1); }
    return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(d);
  }
  function shortTime(value) {
    const d = validDate(value); if (!d) return '—';
    const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 86400000);
    if (diff <= 0) return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
    if (diff === 1) return 'i går';
    return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
  }
  function ageText(value) {
    const d = validDate(value); if (!d) return '';
    const minutes = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (minutes < 60) return 'nå nylig';
    if (minutes < 1440) return `${Math.round(minutes / 60)} t siden`;
    return `${Math.round(minutes / 1440)} d siden`;
  }
  const statusClass = s => s === STATUS.SOLVED ? 'status-lost' : s === STATUS.WAITING ? 'status-venter' : 'status-eskalert';
  const statusTone = s => s === STATUS.SOLVED ? 'good' : s === STATUS.WAITING ? 'wait' : 'alert';
  const shortStatus = s => (STATUS_META.find(m => m[0] === s) || [0, 'Ukjent'])[1];
  const priorityTone = p => ({ Lav: 'lav', Middels: 'middels', 'Høy': 'hoy', Haster: 'haster' })[p] || 'middels';

  const ART_ATTR = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
  const ART = {
    empty: `<svg class="empty-art" viewBox="0 0 150 110" ${ART_ATTR}><rect x="30" y="22" width="90" height="62" rx="8" opacity=".35"/><rect x="22" y="32" width="90" height="62" rx="8" opacity=".6"/><rect x="14" y="42" width="90" height="62" rx="8" fill="#ffffff"/><path d="M30 62h40M30 74h58M30 86h28" opacity=".7"/><circle cx="112" cy="40" r="17" fill="#ffffff" stroke="#286fec"/><path d="M104 40l6 6 11-12" stroke="#286fec"/></svg>`,
    search: `<svg class="empty-art" viewBox="0 0 150 110" ${ART_ATTR}><rect x="18" y="20" width="84" height="70" rx="8" opacity=".5"/><path d="M32 40h40M32 54h56M32 68h30" opacity=".6"/><circle cx="100" cy="62" r="22" fill="#ffffff" stroke="#286fec"/><path d="M92 62h16M116 78l16 16" stroke="#286fec"/></svg>`,
    clear: `<svg class="clear-art" viewBox="0 0 80 80" ${ART_ATTR}><circle cx="40" cy="40" r="25" stroke="#286fec"/><path d="M28 41l9 9 16-18" stroke="#286fec"/><path d="M40 6v7M40 67v7M6 40h7M67 40h7M16 16l5 5M59 59l5 5M64 16l-5 5M21 59l-5 5" opacity=".45"/></svg>`
  };

  /* ---------- Tilstand ---------- */
  let cases = loadCases();
  let deletions = loadDeletions();
  let editingId = null;
  let currentView = 'dashboard';
  let logMode = 'list';
  let openCaseId = null;
  let visibleCount = PAGE_SIZE;
  let formDirty = false;
  let draftTimer = 0;
  let searchTimer = 0;
  let keepTechOnEnter = false;
  let whoManual = false; // true når brukeren selv har skrevet nummeret
  let legacyUser = ''; // gammelt navn på en sak som ble lagret før anonymisering
  let localAvailable = true;
  const filters = { query: '', status: '', tech: '', category: '' };

  /* ---------- Data: rensing, lasting og lagring ---------- */
  function isDemoCase(item) { return text(item?.id).startsWith('demo-inc-'); }
  function normalizeTechnician(name) { const value = text(name).trim(); return LEGACY_TECHNICIANS[value.toLocaleLowerCase('nb')] || value; }

  function cleanCases(value) {
    if (!Array.isArray(value)) return [];
    const now = new Date().toISOString();
    const cleanDate = input => { const d = validDate(input || now); return d ? d.toISOString() : now; };
    return value
      .filter(item => item && typeof item === 'object' && item.id && item.number && !isDemoCase(item) && !item.deletedAt)
      .map(item => {
        const { deletedAt, ...rest } = item;
        const raw = text(item.status);
        const status = raw === 'Venter' ? STATUS.WAITING : raw === 'Eskalert' ? STATUS.ESCALATED : raw;
        const rawCategory = text(item.category || '#Annet');
        const category = rawCategory.startsWith('#') ? rawCategory : `#${rawCategory}`;
        return {
          ...rest, id: text(item.id), number: text(item.number).trim(), technician: normalizeTechnician(item.technician),
          user: text(item.user), room: text(item.room), equipment: text(item.equipment), serial: text(item.serial), loanId: text(item.loanId),
          category: CATEGORIES.includes(category) ? category : '#Annet', priority: PRIORITIES.includes(item.priority) ? item.priority : 'Middels',
          symptom: text(item.symptom), cause: text(item.cause), action: text(item.action), shiftNotes: text(item.shiftNotes),
          status: STATUSES.includes(status) ? status : STATUS.WAITING, createdAt: cleanDate(item.createdAt), updatedAt: cleanDate(item.updatedAt || item.createdAt)
        };
      });
  }

  function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (error) { console.warn('Kunne ikke skrive', key, error); return false; } }

  function loadCases() {
    let stored;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (error) { localAvailable = false; return []; }
    if (stored !== null) {
      let value; try { value = JSON.parse(stored); } catch (error) { value = []; }
      const cleaned = cleanCases(value);
      if (!Array.isArray(value) || JSON.stringify(cleaned) !== JSON.stringify(value)) writeJson(STORAGE_KEY, cleaned);
      try { localStorage.removeItem(LEGACY_KEY); } catch (error) { /* ignorer */ }
      return cleaned;
    }
    let legacy = null; try { legacy = localStorage.getItem(LEGACY_KEY); } catch (error) { /* ignorer */ }
    let migrated = [];
    if (legacy !== null) { try { migrated = cleanCases(JSON.parse(legacy)); } catch (error) { migrated = []; } }
    writeJson(STORAGE_KEY, migrated);
    try { localStorage.removeItem(LEGACY_KEY); } catch (error) { /* ignorer */ }
    return migrated;
  }

  function loadDeletions() {
    try { const value = JSON.parse(localStorage.getItem(DELETIONS_KEY) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch (error) { return {}; }
  }

  function persist(nextCases, nextDeletions = deletions) {
    if (!writeJson(STORAGE_KEY, nextCases) || !writeJson(DELETIONS_KEY, nextDeletions)) {
      toast('Kunne ikke lagre lokalt. Kontroller ledig lagringsplass i nettleseren.', 'error');
      return false;
    }
    cases = nextCases; deletions = nextDeletions;
    cloud.requestSync();
    return true;
  }

  /* ---------- Meldinger ---------- */
  function toast(message, type = 'success', options = {}) {
    const region = $('#toast-region');
    while (region.children.length >= 3) region.firstElementChild.remove();
    const node = document.createElement('div');
    node.className = `toast toast-${type}`;
    node.setAttribute('role', type === 'error' ? 'alert' : 'status');
    node.innerHTML = `${icon(type === 'error' ? 'alert-circle' : 'check-circle')}<span>${safe(message)}</span>`;
    if (options.actionLabel) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'toast-action'; button.textContent = options.actionLabel;
      button.addEventListener('click', () => { node.remove(); options.onAction?.(); });
      node.append(button);
    }
    region.append(node);
    setTimeout(() => node.remove(), options.duration || 3800);
  }

  /* ---------- Skystatus i grensesnittet ---------- */
  function updateCloudUI(view) {
    const label = !localAvailable && view.state === 'off' ? 'Lagring utilgjengelig' : view.label;
    $$('[data-cloud-state]').forEach(el => { el.dataset.cloudState = view.state; });
    $$('[data-cloud-label]').forEach(el => { el.textContent = label; });
    $('#footer-storage').textContent = view.state === 'off' ? 'Saksdata lagres lokalt på denne enheten' : 'Saksdata lagres lokalt og synkroniseres med Supabase';
    $$('[data-cloud-sync]').forEach(el => { el.title = view.detail || 'Synkroniser sakslogg med Supabase'; });
  }

  function updateBackupStatus() {
    const element = $('#backup-status');
    let stamp = null; try { stamp = Number(localStorage.getItem(BACKUP_KEY)) || null; } catch (error) { /* ignorer */ }
    const days = stamp ? Math.floor((Date.now() - stamp) / 86400000) : null;
    element.textContent = !stamp ? (cases.length ? 'Ingen JSON-backup tatt ennå' : 'Ingen JSON-backup tatt') : days <= 0 ? 'Siste JSON-backup: i dag' : `Siste JSON-backup: ${days} ${days === 1 ? 'dag' : 'dager'} siden`;
    element.classList.toggle('is-stale', cases.length > 0 && (!stamp || days >= BACKUP_STALE_DAYS));
  }

  /* ---------- Navigasjon ---------- */
  const viewFromHash = () => { const v = location.hash.replace('#', ''); return VIEWS.includes(v) ? v : 'dashboard'; };
  function navigate(view) { if (location.hash === `#${view}`) applyView(view); else location.hash = view; }

  function canLeaveForm(next) {
    if (currentView !== 'new' || next === 'new') return true;
    flushDraft();
    if (editingId) {
      if (formDirty && !confirm('Du har ulagrede endringer i saken. Vil du forlate skjemaet uten å lagre?')) return false;
      resetForm();
    }
    return true;
  }

  function applyView(view, moveFocus = true) {
    const previous = currentView;
    currentView = view;
    document.body.dataset.page = view;
    if (view === 'log' && previous !== 'log') {
      if (!keepTechOnEnter) filters.tech = '';
      keepTechOnEnter = false;
    }
    $$('.view').forEach(section => section.classList.toggle('hidden', section.id !== `view-${view}`));
    $$('[data-view]').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (button.classList.contains('side-new')) return;
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    document.title = `Helpnotes · ${VIEW_TITLES[view]}`;
    if (view === 'log') { visibleCount = PAGE_SIZE; renderLog(); }
    if (view === 'dashboard') renderDashboard();
    renderSidebar();
    window.scrollTo(0, 0);
    if (!moveFocus) return;
    if (view === 'new' && window.matchMedia('(pointer:fine)').matches) $(currentRole() === 'teacher' ? '#who-input' : '#student-class').focus({ preventScroll: true });
    else $(`#view-${view} [data-view-heading]`)?.focus({ preventScroll: true });
  }

  /* ---------- Komponist (ny sak / rediger) ---------- */
  function renderChoices() {
    const CATEGORY_INFO = { '#Hardware': ['hard-drive', 'Maskin / utstyr', 'PC, skjerm, mus'], '#Programvare': ['grid', 'Program / app', 'Noe åpner eller virker ikke'], '#Nettverk': ['wifi', 'Internett', 'Wi-Fi og nett'], '#Feide': ['key', 'Innlogging', 'Feide og passord'], '#Skriver': ['printer', 'Skriver', 'Utskrift'], '#Annet': ['info', 'Noe annet', 'Passer ikke over'] };
    const STATUS_INFO = { good: ['check-circle', 'Fikset!', 'Problemet er løst'], wait: ['clock', 'Må vente', 'Venter på deler eller brukeren'], alert: ['alert-triangle', 'Trenger hjelp', 'Sendes til IKT-ansvarlig'] };
    const choice = (name, value, tone, [iconName, title, hint]) => `<label class="choice" data-tone="${tone}"><input type="radio" name="${name}" value="${safe(value)}"><span class="choice-body"><span class="choice-icon"><svg class="icon" aria-hidden="true"><use href="#i-${iconName}"/></svg></span><strong>${safe(title)}</strong><small>${safe(hint)}</small></span></label>`;
    $('#category-chips').innerHTML = CATEGORIES.map(c => choice('category', c, 'blue', CATEGORY_INFO[c] || ['info', c, ''])).join('');
    $('#status-seg').innerHTML = STATUS_META.map(([value, , tone]) => choice('status', value, tone, STATUS_INFO[tone])).join('');
    $('#filter-category').innerHTML = '<option value="">Alle kategorier</option>' + CATEGORIES.map(c => `<option>${safe(c)}</option>`).join('');
    $('#role-seg').innerHTML = choice('role', 'student', 'blue', ['layers', 'Elev', 'Velg klasse og nummer']) + choice('role', 'teacher', 'blue', ['file-text', 'Lærer', 'Uten klasse']);
    $('#technician').innerHTML = `<option value="">Velg tekniker</option>${TECHNICIANS.map(n => `<option value="${safe(n)}">${safe(n)}</option>`).join('')}<option value="__other">Annen tekniker …</option>`;
  }

  const radioValue = name => $(`#case-form input[name="${name}"]:checked`)?.value || '';
  const setRadio = (name, value) => $$(`#case-form input[name="${name}"]`).forEach(input => { input.checked = input.value === value; });
  function techValue() { const v = $('#technician').value; return v === '__other' ? $('#technician-other').value.trim() : v; }
  function syncTechnicianOther() { const other = $('#technician').value === '__other'; $('#technician-other').classList.toggle('hidden', !other); }

  const currentRole = () => radioValue('role') === 'teacher' ? 'teacher' : 'student';
  const rolePrefix = role => role === 'teacher' ? 'Lærer' : 'Elev';
  const keepsLegacy = () => !!legacyUser && $('#who-input').value.trim() === legacyUser;
  function classValue() { const raw = $('#student-class').value; return currentRole() === 'teacher' ? '' : keepsLegacy() ? raw.trim() : normClass(raw); }

  // Nummer som allerede er i bruk: per klasse for elever, felles for lærere
  function usedNumbers(role, room) {
    const re = new RegExp(`^${rolePrefix(role)} (\\d+)$`);
    const nums = new Set();
    cases.forEach(c => {
      const m = text(c.user).trim().match(re);
      if (m && (role === 'teacher' || normClass(c.room) === room)) nums.add(Number(m[1]));
    });
    return [...nums].sort((a, b) => a - b);
  }
  const nextLabel = (role, room) => `${rolePrefix(role)} ${(usedNumbers(role, room).pop() || 0) + 1}`;

  // «3», «elev 3» og «Elev 3» blir alle til «Elev 3»
  function parseWho(raw, role) {
    const m = text(raw).trim().match(/^(?:elev|lærer)?\s*(\d{1,4})$/i);
    return m && Number(m[1]) >= 1 ? `${rolePrefix(role)} ${Number(m[1])}` : '';
  }

  function whoValue() {
    const role = currentRole(), room = normClass($('#student-class').value), raw = $('#who-input').value.trim();
    if (keepsLegacy()) return legacyUser;
    if (role === 'student' && !room) return '';
    return parseWho(raw, role) || (raw ? '' : nextLabel(role, room));
  }

  // Fyller inn neste ledige nummer automatisk, med mindre brukeren har skrevet et eget
  function refreshWho() {
    const role = currentRole(), student = role === 'student', input = $('#who-input'), hint = $('#who-hint');
    const room = normClass($('#student-class').value);
    $('#class-field').classList.toggle('hidden', !student);
    $('#who-label').firstChild.textContent = rolePrefix(role);
    const blocked = student && !room && !keepsLegacy();
    input.disabled = blocked;
    input.placeholder = blocked ? 'Skriv klassen først' : 'Automatisk';
    if (blocked) { input.value = ''; whoManual = false; hint.textContent = ''; return; }
    if (!whoManual && !keepsLegacy()) input.value = nextLabel(role, room);
    const value = keepsLegacy() ? '' : parseWho(input.value, role);
    const used = value && usedNumbers(role, room).some(n => `${rolePrefix(role)} ${n}` === value);
    hint.textContent = !value ? '' : used ? `${value} finnes allerede${student ? ` i ${room}` : ''}. Saken knyttes til samme ${student ? 'elev' : 'lærer'}.` : `Ny ${student ? 'elev' : 'lærer'}${student ? ` i ${room}` : ''}.`;
  }

  function formValues() {
    return {
      technician: techValue(), number: $('#case-number').value.trim(), user: whoValue(), room: classValue(),
      category: radioValue('category'), symptom: $('#symptom').value.trim(), action: $('#action').value.trim(), cause: $('#cause').value.trim(),
      status: radioValue('status')
    };
  }

  function fillForm(v) {
    const tech = text(v.technician);
    if (TECHNICIANS.includes(tech)) $('#technician').value = tech;
    else if (tech) { $('#technician').value = '__other'; $('#technician-other').value = tech; }
    else $('#technician').value = '';
    syncTechnicianOther();
    $('#case-number').value = text(v.number);
    const user = text(v.user).trim();
    legacyUser = user && !ANON_RE.test(user) ? user : '';
    const role = /^Lærer \d+$/.test(user) ? 'teacher' : 'student';
    setRadio('role', role);
    $('#student-class').value = role === 'student' ? text(v.room) : '';
    const roomNow = role === 'student' ? normClass(v.room) : '';
    $('#who-input').value = user;
    whoManual = !!editingId || !!legacyUser || user !== nextLabel(role, roomNow);
    refreshWho();
    $('#symptom').value = text(v.symptom); $('#action').value = text(v.action); $('#cause').value = text(v.cause);
    setRadio('category', text(v.category)); setRadio('status', text(v.status));
  }

  const ALL_FIELDS = [...REQUIRED, ['room', 'Klasse']];
  function missingFields(values = formValues()) {
    return REQUIRED.filter(([key]) => !values[key]).map(m => m[0] === 'user' && currentRole() === 'student' && !values.room ? ['room', 'Klasse'] : m);
  }
  function fieldWrapper(key) { return ({ technician: '#technician', user: '#who-input', room: '#student-class', category: '#category-chips', symptom: '#symptom', status: '#status-seg' })[key]; }

  function updateFormStatus(markMissing = false) {
    const missing = missingFields();
    const el = $('#form-missing');
    el.textContent = missing.length ? `Mangler: ${missing.map(m => m[1]).join(', ')}` : 'Klar til å lagre';
    el.classList.toggle('is-ready', missing.length === 0);
    ALL_FIELDS.forEach(([key]) => {
      const wrapper = $(fieldWrapper(key))?.closest('.field');
      if (!wrapper) return;
      const isMissing = missing.some(m => m[0] === key);
      if (!isMissing) wrapper.classList.remove('is-missing'); else if (markMissing) wrapper.classList.add('is-missing');
    });
  }

  function saveDraft() {
    if (editingId) return;
    const v = formValues();
    const hasContent = ['user', 'room', 'symptom', 'action', 'cause', 'category', 'status'].some(k => v[k]);
    if (!hasContent) { try { localStorage.removeItem(DRAFT_KEY); } catch (error) { /* ignorer */ } $('#draft-status').textContent = ''; return; }
    if (writeJson(DRAFT_KEY, v)) $('#draft-status').textContent = `Utkast lagret kl. ${new Date().toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}`;
  }
  function scheduleDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); }
  function flushDraft() { if (draftTimer) { clearTimeout(draftTimer); draftTimer = 0; saveDraft(); } }
  function clearDraft() { clearTimeout(draftTimer); draftTimer = 0; try { localStorage.removeItem(DRAFT_KEY); } catch (error) { /* ignorer */ } $('#draft-status').textContent = ''; }

  function nextNumber() {
    let highest = 1000;
    cases.forEach(item => { const m = text(item.number).match(/^INC-(\d+)$/i); if (m) highest = Math.max(highest, Number(m[1])); });
    let candidate;
    do { highest += 1; candidate = `INC-${highest}`; } while (cases.some(item => sameNumber(item.number, candidate)));
    return candidate;
  }

  function setFormMode(editing, number = '') {
    $('#form-eyebrow').textContent = editing ? 'Rediger sak' : 'Ny sak';
    $('#form-heading').textContent = editing ? `Rediger ${number}` : 'Logg en sak';
    $('#form-lead').textContent = editing ? 'Endringene lagres når du trykker «Lagre endringer».' : 'Svar på fire små spørsmål. Det tar under ett minutt.';
    $('#submit-label').textContent = editing ? 'Lagre endringer' : 'Lagre sak';
    $('#submit-new').classList.toggle('hidden', editing);
    $('#cancel-edit').classList.toggle('hidden', !editing);
    $('#reset-form').textContent = editing ? 'Tilbakestill' : 'Start på nytt';
  }

  function resetForm({ keepDraft = false } = {}) {
    editingId = null;
    $('#case-form').reset();
    $('#technician-other').value = '';
    legacyUser = '';
    setRadio('role', 'student');
    whoManual = false;
    refreshWho();
    $('#case-number').value = nextNumber();
    let last = ''; try { last = localStorage.getItem(LAST_TECH_KEY) || ''; } catch (error) { /* ignorer */ }
    if (TECHNICIANS.includes(last)) $('#technician').value = last;
    syncTechnicianOther();
    $$('.is-missing').forEach(el => el.classList.remove('is-missing'));
    setFormMode(false);
    if (!keepDraft) clearDraft();
    formDirty = false;
    updateFormStatus();
  }

  function beginEdit(item) {
    editingId = item.id;
    $('#case-form').reset();
    fillForm(item);
    setFormMode(true, item.number);
    $$('.is-missing').forEach(el => el.classList.remove('is-missing'));
    formDirty = false;
    updateFormStatus();
    navigate('new');
  }

  function restoreDraft() {
    let draft = null; try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (error) { draft = null; }
    if (!draft || typeof draft !== 'object') return;
    if (!draft.number || cases.some(c => sameNumber(c.number, draft.number))) draft.number = nextNumber();
    fillForm(draft);
    $('#draft-status').textContent = 'Utkast gjenopprettet';
    updateFormStatus();
  }

  function submitCase(event) {
    event.preventDefault();
    const after = event.submitter?.dataset.after || 'log';
    const values = formValues();
    const missing = missingFields(values);
    if (missing.length) {
      updateFormStatus(true);
      const target = $(fieldWrapper(missing[0][0]));
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (target?.matches('input,textarea,select') ? target : target?.querySelector('input'))?.focus({ preventScroll: true });
      toast(`Fyll ut: ${missing.map(m => m[1]).join(', ')}`, 'error');
      return;
    }
    if (!values.number) values.number = nextNumber();
    if (cases.some(item => sameNumber(item.number, values.number) && item.id !== editingId)) {
      const field = $('#case-number');
      field.closest('.field').classList.add('is-missing');
      field.focus();
      $('#form-missing').textContent = 'Saksnummeret er allerede i bruk';
      toast('Saksnummeret er allerede i bruk.', 'error');
      return;
    }
    const now = new Date().toISOString();
    let savedId = editingId;
    if (editingId) {
      if (!persist(cases.map(item => item.id === editingId ? { ...item, ...values, updatedAt: now } : item))) return;
      toast(`Sak ${values.number} er oppdatert.`);
    } else {
      savedId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (!persist([...cases, { id: savedId, priority: 'Middels', ...values, createdAt: now, updatedAt: now }])) return;
      toast(`Sak ${values.number} er lagret.`);
    }
    try { localStorage.setItem(LAST_TECH_KEY, values.technician); } catch (error) { /* ignorer */ }
    const wasEditing = !!editingId;
    resetForm();
    refreshAll();
    if (after === 'new' && !wasEditing) { $(currentRole() === 'teacher' ? '#who-input' : '#student-class').focus(); window.scrollTo(0, 0); return; }
    openCaseId = savedId;
    navigate('log');
  }

  /* ---------- Endring, sletting og angre ---------- */
  function updateStatus(id, status) {
    const item = cases.find(c => c.id === id);
    if (!item || item.status === status) return;
    if (!persist(cases.map(c => c.id === id ? { ...c, status, updatedAt: new Date().toISOString() } : c))) return;
    refreshAll();
    toast(`${item.number}: status er satt til «${shortStatus(status)}».`);
  }

  function deleteCase(id) {
    const index = cases.findIndex(row => row.id === id);
    if (index < 0) return;
    const item = cases[index];
    if (!persist(cases.filter(row => row.id !== id), { ...deletions, [id]: new Date().toISOString() })) return;
    if (openCaseId === id) openCaseId = null;
    refreshAll();
    toast(`Sak ${item.number} er slettet.`, 'success', { actionLabel: 'Angre', duration: 8000, onAction: () => restoreCase(item, index) });
  }

  function restoreCase(item, index) {
    if (cases.some(row => row.id === item.id || sameNumber(row.number, item.number))) { toast('Kunne ikke angre: saksnummeret er allerede i bruk.', 'error'); return; }
    const next = [...cases]; next.splice(Math.min(index, next.length), 0, { ...item, updatedAt: new Date().toISOString() });
    const { [item.id]: removed, ...restDeletions } = deletions;
    if (!persist(next, restDeletions)) return;
    refreshAll();
    toast(`Sak ${item.number} er gjenopprettet.`);
  }

  /* ---------- Visning: oversikt ---------- */
  function renderTicketChart() {
    const today = dayStart(new Date());
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() - 6 + i); return d; });
    const counts = days.map(day => cases.filter(c => { const d = validDate(c.createdAt); return d && d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate(); }).length);
    const total = counts.reduce((a, b) => a + b, 0);
    const max = Math.max(1, ...counts);
    const weekday = new Intl.DateTimeFormat('nb-NO', { weekday: 'short' });
    const longDate = new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#ticket-chart').innerHTML = days.map((day, i) => {
      const n = counts[i], height = n ? Math.max(8, n / max * 100) : 0;
      const label = `${longDate.format(day)}: ${n} ${n === 1 ? 'sak' : 'saker'}`;
      return `<div class="bar-col${i === 6 ? ' is-today' : ''}${n === max && n > 0 ? ' is-peak' : ''}" title="${safe(label)}"><span class="bar-value">${n}</span><div class="bar-track"><div class="bar-fill" style="height:${height}%"></div></div><span class="bar-day">${safe(weekday.format(day).replace('.', ''))}</span></div>`;
    }).join('') + (total === 0 ? '<div class="chart-empty">Ingen saker de siste 7 dagene</div>' : '');
    $('#chart-week-total').textContent = `${total} ${total === 1 ? 'sak' : 'saker'}`;
    $('#ticket-chart').setAttribute('aria-label', `Saker registrert per dag de siste sju dagene: ${days.map((day, i) => `${longDate.format(day)} ${counts[i]}`).join(', ')}`);
  }

  function renderDashboard() {
    const now = new Date();
    const h = now.getHours();
    const greeting = h < 5 ? 'God natt' : h < 10 ? 'God morgen' : h < 12 ? 'God formiddag' : h < 18 ? 'God ettermiddag' : 'God kveld';
    const dateText = new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    $('#greeting-eyebrow').innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-clock"/></svg><span>${safe(dateText[0].toUpperCase() + dateText.slice(1))}</span>`;

    const total = cases.length;
    const count = s => cases.filter(c => c.status === s).length;
    const solved = count(STATUS.SOLVED);
    const openCount = total - solved;
    const title = $('#greeting-title');
    if (!total) { title.innerHTML = `${safe(greeting)}, <em>ingen saker ennå</em>`; $('#hero-lede').textContent = 'Logg den første saken for å komme i gang.'; }
    else if (!openCount) { title.innerHTML = `${safe(greeting)}, <em>alt er fulgt opp</em>`; $('#hero-lede').textContent = `${total} ${total === 1 ? 'sak er' : 'saker er'} løst. Ingenting venter på deg akkurat nå.`; }
    else {
      title.innerHTML = `${safe(greeting)}, <em>${openCount} ${openCount === 1 ? 'sak trenger' : 'saker trenger'} deg</em>`;
      const esc = count(STATUS.ESCALATED), wait = count(STATUS.WAITING);
      $('#hero-lede').textContent = [wait ? `${wait} venter på deler eller bruker` : '', esc ? `${esc} er eskalert til IKT-ansvarlig` : ''].filter(Boolean).join(' · ') + '.';
    }
    const plural = n => `${n} ${n === 1 ? 'sak' : 'saker'}`;
    $('#card-count-lost').textContent = plural(solved); $('#card-count-wait').textContent = plural(count(STATUS.WAITING)); $('#card-count-esc').textContent = plural(count(STATUS.ESCALATED));
    $('#stat-total').textContent = total; $('#stat-lost').textContent = solved;
    $('#stat-venter').textContent = count(STATUS.WAITING); $('#stat-eskalert').textContent = count(STATUS.ESCALATED);
    const rate = total ? Math.round(solved / total * 100) : 0;
    $('#solved-share').textContent = `${rate}% av sakene`;
    $('#resolution-rate').textContent = `${rate}%`;
    $('#resolution-progress').style.setProperty('--p', rate);
    $('#hero-meter-fill').style.width = `${rate}%`;
    $('#resolution-progress').setAttribute('aria-label', `Løsningsgrad: ${rate} prosent løst`);
    $('.hero-meter').setAttribute('aria-label', total ? `Andel løste saker: ${rate} prosent, ${solved} av ${total}` : 'Ingen saker ennå');
    $('#hero-meter-text').textContent = total ? `${rate} % løst · ${solved} av ${total}` : 'Ingen saker ennå';
    $('#goal-gap').textContent = !total ? 'Mål 90 %' : rate >= 90 ? 'Målet er nådd' : `${90 - rate} % til målet`;
    renderTicketChart();
    updateBackupStatus();

    const byCategory = CATEGORIES.map(category => ({ category, n: cases.filter(c => c.category === category).length }));
    const maxCat = Math.max(1, ...byCategory.map(r => r.n));
    $('#category-bars').innerHTML = total ? byCategory.map(r => `<div class="category-row"><div class="category-row-top"><strong>${safe(r.category)}</strong><span>${r.n}</span></div><div class="category-track"><div class="category-fill" style="width:${r.n / maxCat * 100}%"></div></div></div>`).join('') : '<p class="empty-note">Kategorifordelingen vises når første sak er registrert.</p>';

    const attention = cases.filter(c => c.status !== STATUS.SOLVED)
      .sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0) || new Date(a.updatedAt) - new Date(b.updatedAt)).slice(0, 5);
    $('#attention-list').innerHTML = attention.length
      ? attention.map(c => `<button type="button" class="attention-row" data-open-id="${safe(c.id)}">${avatar(c.technician)}<span class="attention-main"><strong>${safe(whoLabel(c))}</strong><span>${safe(c.number)} · ${safe(c.symptom || c.category)}</span></span><span class="prio prio-${priorityTone(c.priority)}">${safe(c.priority)}</span><span class="attention-age">${safe(ageText(c.updatedAt))}</span><span class="status-pill ${statusClass(c.status)}">${safe(shortStatus(c.status))}</span></button>`).join('')
      : `<div class="attention-clear">${ART.clear}<div><h3>${total ? 'Alt er fulgt opp' : 'Her er det rolig'}</h3><p>${total ? 'Ingen saker venter eller er eskalert akkurat nå.' : 'Når du logger en sak, dukker den opp her så lenge den ikke er løst.'}</p></div></div>`;

    const rows = TECHNICIANS.map(name => { const own = cases.filter(c => c.technician === name); return { name, total: own.length, solved: own.filter(c => c.status === STATUS.SOLVED).length }; });
    const others = cases.filter(c => !TECHNICIANS.includes(c.technician));
    if (others.length) rows.push({ name: 'Andre teknikere', total: others.length, solved: others.filter(c => c.status === STATUS.SOLVED).length });
    rows.sort((a, b) => b.total - a.total || b.solved - a.solved);
    $('#leaderboard').innerHTML = rows.map((r, i) => `<div class="leader-row${i === 0 && r.total > 0 ? ' is-leader' : ''}">${avatar(r.name)}<span class="leader-name"><strong>${safe(r.name)}</strong><small>${r.solved} løst av ${r.total}</small><span class="leader-bar"><i style="width:${r.total ? Math.round(r.solved / r.total * 100) : 0}%"></i></span></span><span class="leader-total">${r.total}</span></div>`).join('');
  }

  function renderSidebar() {
    const open = c => c.status !== STATUS.SOLVED;
    $('#nav-count').textContent = cases.length ? String(cases.length) : '';
    const openAll = cases.filter(open).length;
    const allActive = currentView === 'log' && !filters.tech;
    const allRow = `<button type="button" class="tech-link${allActive ? ' active' : ''}" data-tech="" title="Vis saker fra alle teknikere"><span class="avatar">${icon('layers')}</span><span>Alle teknikere</span><span class="count">${openAll || ''}</span></button>`;
    $('#side-technicians').innerHTML = allRow + TECHNICIANS.map(name => {
      const n = cases.filter(c => c.technician === name && open(c)).length;
      const active = currentView === 'log' && filters.tech === name;
      return `<button type="button" class="tech-link${active ? ' active' : ''}" data-tech="${safe(name)}" title="Vis saker for ${safe(name)}">${avatar(name)}<span>${safe(name)}</span><span class="count">${n || ''}</span></button>`;
    }).join('');
  }

  /* ---------- Visning: sakslogg ---------- */
  function updateTechFilter() {
    const select = $('#filter-tech');
    const names = [...new Set([...TECHNICIANS, ...cases.map(c => c.technician).filter(Boolean)])];
    select.innerHTML = '<option value="">Alle teknikere</option>' + names.map(n => `<option value="${safe(n)}">${safe(n)}</option>`).join('');
    select.value = names.includes(filters.tech) ? filters.tech : '';
    if (select.value !== filters.tech) filters.tech = select.value;
  }

  function matches(c, ignoreStatus = false) {
    if (!ignoreStatus && filters.status && c.status !== filters.status) return false;
    if (filters.tech && c.technician !== filters.tech) return false;
    if (filters.category && c.category !== filters.category) return false;
    if (!filters.query) return true;
    return [c.number, c.user, c.room, c.equipment, c.serial, c.symptom, c.cause, c.action, c.shiftNotes, c.loanId, c.technician, c.category, c.priority, c.status].join(' ').toLocaleLowerCase('nb').includes(filters.query);
  }
  const filteredCases = () => cases.filter(c => matches(c)).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  const filtersActive = () => !!(filters.query || filters.status || filters.tech || filters.category);

  function renderTabs() {
    const base = cases.filter(c => matches(c, true));
    const order = [STATUS.WAITING, STATUS.ESCALATED, STATUS.SOLVED];
    const tabs = [['', 'Alle', base.length, 'blue'], ...order.map(value => [value, shortStatus(value), base.filter(c => c.status === value).length, statusTone(value)])];
    $('#status-tabs').innerHTML = tabs.map(([value, label, n, tone]) => `<button type="button" class="seg-tab${filters.status === value ? ' is-active' : ''}" data-tone="${tone}" aria-pressed="${filters.status === value}" data-status-tab="${safe(value)}"><i class="tab-dot"></i>${label}<span class="count">${n}</span></button>`).join('');
  }

  function rowMarkup(c) {
    return `<button type="button" class="case-row tone-${statusTone(c.status)}${openCaseId === c.id ? ' is-selected' : ''}" data-open-id="${safe(c.id)}" aria-label="Åpne sak ${safe(c.number)}">${avatar(c.technician)}<span class="case-body"><span class="case-top"><strong>${safe(whoLabel(c))}</strong><span class="case-number">${safe(c.number)}</span><time class="case-time" datetime="${safe(c.updatedAt)}">${safe(shortTime(c.updatedAt))}</time></span><span class="case-snippet">${safe(c.symptom || 'Ingen beskrivelse registrert')}</span><span class="case-tags"><span class="tag">${safe(c.category)}</span><span class="prio prio-${priorityTone(c.priority)}">${safe(c.priority)}</span><span class="case-by">${safe(c.technician || '—')}</span></span></span><span class="case-side"><span class="status-pill ${statusClass(c.status)}">${safe(shortStatus(c.status))}</span></span></button>`;
  }

  function listMarkup(items) {
    let last = '';
    return `<div class="list-card">${items.map(c => { const label = dayLabel(c.updatedAt); const divider = label !== last ? `<div class="day-divider">${safe(label)}</div>` : ''; last = label; return divider + rowMarkup(c); }).join('')}</div>`;
  }

  function cardsMarkup(items) {
    return `<div class="case-grid">${items.map(c => `<button type="button" class="case-card${openCaseId === c.id ? ' is-selected' : ''}" data-open-id="${safe(c.id)}" aria-label="Åpne sak ${safe(c.number)}"><span class="case-card-top"><span class="case-number">${safe(c.number)}</span><span class="status-pill ${statusClass(c.status)}">${safe(shortStatus(c.status))}</span></span><h4>${safe(whoLabel(c))}</h4><span class="case-snippet">${safe(c.symptom || 'Ingen beskrivelse registrert')}</span><span class="case-card-foot"><span class="case-tags"><span class="tag">${safe(c.category)}</span><span class="prio prio-${priorityTone(c.priority)}">${safe(c.priority)}</span></span>${avatar(c.technician, true)}</span></button>`).join('')}</div>`;
  }

  function tableMarkup(items) {
    const head = ['Saksnr.', 'Bruker', 'Problem', 'Kategori', 'Prioritet', 'Status', 'Tekniker', 'Oppdatert'];
    return `<div class="table-wrap"><table class="case-table"><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${items.map(c => `<tr class="${openCaseId === c.id ? 'is-selected' : ''}" data-open-id="${safe(c.id)}" tabindex="0" aria-label="Åpne sak ${safe(c.number)}"><td class="mono">${safe(c.number)}</td><td><strong>${safe(c.user ? whoLabel(c) : '—')}</strong></td><td class="cell-wrap">${safe(c.symptom)}</td><td>${safe(c.category)}</td><td><span class="prio prio-${priorityTone(c.priority)}">${safe(c.priority)}</span></td><td><span class="status-pill ${statusClass(c.status)}">${safe(shortStatus(c.status))}</span></td><td>${safe(c.technician || '—')}</td><td>${safe(shortTime(c.updatedAt))}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderLog() {
    updateTechFilter();
    renderTabs();
    const items = filteredCases();
    const shown = items.slice(0, visibleCount);
    $('#results-count').textContent = `${items.length} ${items.length === 1 ? 'sak' : 'saker'}${items.length !== cases.length ? ` av ${cases.length}` : ''}`;
    $('#clear-filters-wrap').classList.toggle('hidden', !filtersActive());
    $('#filter-category').value = filters.category;
    ['list', 'cards', 'table'].forEach(m => { const b = $(`#mode-${m}`); b.classList.toggle('active', logMode === m); b.setAttribute('aria-pressed', String(logMode === m)); });
    const list = $('#case-list');
    if (!items.length) {
      list.innerHTML = cases.length === 0
        ? `<div class="empty">${ART.empty}<h3>Ingen saker ennå</h3><p>Logg den første saken, så dukker den opp her.</p><button type="button" class="btn btn-primary" data-action="new-case">${icon('plus')}Logg første sak</button></div>`
        : `<div class="empty">${ART.search}<h3>Ingen saker passer</h3><p>Prøv et annet søkeord, eller nullstill filtrene.</p><button type="button" class="btn btn-secondary" data-action="clear-filters">${icon('undo')}Nullstill filtre</button></div>`;
    } else {
      const remaining = items.length - shown.length;
      const more = remaining > 0 ? `<div class="more-row"><button type="button" class="btn btn-secondary btn-sm" data-action="show-more">Vis ${Math.min(PAGE_SIZE, remaining)} flere (${remaining} igjen)</button></div>` : '';
      list.innerHTML = (logMode === 'cards' ? cardsMarkup(shown) : logMode === 'table' ? tableMarkup(shown) : listMarkup(shown)) + more;
    }
    renderDetail();
  }

  function detailItem(label, value) { return `<div class="detail-item"><span>${safe(label)}</span><p>${value ? safe(value) : '<em class="missing">Ikke oppgitt</em>'}</p></div>`; }

  function renderDetail() {
    const pane = $('#case-detail');
    const item = cases.find(c => c.id === openCaseId);
    const layout = $('#log-layout');
    if (!item || currentView !== 'log') {
      pane.hidden = true; pane.innerHTML = '';
      layout.classList.remove('has-detail'); document.body.classList.remove('has-detail');
      return;
    }
    const scroll = pane.scrollTop;
    pane.hidden = false; layout.classList.add('has-detail'); document.body.classList.add('has-detail');
    pane.innerHTML = `<div class="detail-head">${avatar(item.technician)}<div class="detail-title"><span class="case-number">${safe(item.number)}</span><h3>${safe(whoLabel(item))}</h3><span>${safe(item.technician || 'Ingen tekniker')} · ${safe(prettyDate(item.createdAt))}</span></div><button type="button" class="icon-btn" data-action="close-detail" aria-label="Lukk detaljer">${icon('x')}</button></div>
    <div class="detail-body">
      <div class="segmented detail-status" role="group" aria-label="Endre status">${STATUS_META.map(([value, label, tone]) => `<button type="button" data-status-set="${safe(value)}" data-tone="${tone}" aria-pressed="${item.status === value}" title="${safe(value)}">${label}</button>`).join('')}</div>
      <div class="detail-chips"><span class="tag">${safe(item.category)}</span><span class="prio prio-${priorityTone(item.priority)}">${safe(item.priority)} prioritet</span><span class="muted">Oppdatert ${safe(prettyDate(item.updatedAt))}</span></div>
      <section class="detail-section"><h4>Problem og løsning</h4><div class="detail-list">${detailItem('Symptom', item.symptom)}${detailItem('Årsak', item.cause)}${detailItem('Tiltak', item.action)}</div></section>
      <section class="detail-section"><h4>Hvem og utstyr</h4><div class="detail-list"><div class="detail-two">${detailItem('Elev / lærer', item.user)}${detailItem('Klasse / rom', item.room)}</div><div class="detail-two">${detailItem('Utstyr', item.equipment)}${detailItem('Serienummer', item.serial)}</div>${detailItem('Utlåns-ID', item.loanId)}</div></section>
      <section class="detail-section"><h4>Internt notat</h4><div class="detail-list">${detailItem('Beskjed til neste tekniker', item.shiftNotes)}</div></section>
      <div class="detail-actions"><button type="button" class="btn btn-primary" data-action="edit" data-id="${safe(item.id)}">${icon('pen')}Rediger sak</button><button type="button" class="btn btn-secondary btn-sm" data-action="print" data-id="${safe(item.id)}">${icon('printer')}Saksnotat</button><button type="button" class="btn btn-secondary btn-sm" data-action="receipt" data-id="${safe(item.id)}">${icon('file-text')}Kvittering</button><button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="${safe(item.id)}">${icon('trash')}Slett</button></div>
    </div>`;
    pane.scrollTop = scroll;
  }

  function openCase(id) {
    const closing = openCaseId === id;
    openCaseId = closing ? null : id;
    if (currentView !== 'log') { if (!closing) navigate('log'); return; }
    renderLog();
    if (!closing && window.matchMedia('(max-width:1099px)').matches) $('#case-detail').focus({ preventScroll: true });
  }

  function closeCase() {
    const id = openCaseId;
    openCaseId = null;
    renderLog();
    $(`[data-open-id="${CSS.escape(id || '')}"]`)?.focus({ preventScroll: true });
  }

  function goToLog(patch) {
    Object.assign(filters, patch);
    keepTechOnEnter = currentView !== 'log';
    $('#search-cases').value = filters.query;
    visibleCount = PAGE_SIZE;
    if (currentView === 'log') { renderLog(); renderSidebar(); } else navigate('log');
  }

  function updateSuggestions() {
    const uniq = key => [...new Set(cases.map(c => c[key]).filter(Boolean))].slice(0, 60);
    const fill = (id, values) => { $(id).innerHTML = values.map(v => `<option value="${safe(v)}"></option>`).join(''); };
    fill('#class-suggestions', [...new Set(cases.filter(c => ANON_RE.test(text(c.user).trim()) && c.room).map(c => normClass(c.room)))].sort().slice(0, 60));
    refreshWho();
  }

  function refreshAll() {
    if (openCaseId && !cases.some(c => c.id === openCaseId)) openCaseId = null;
    renderDashboard(); renderSidebar(); updateSuggestions();
    if (currentView === 'log') renderLog();
    if (!editingId && !formDirty && currentView !== 'new') $('#case-number').value = nextNumber();
  }

  /* ---------- Utskrift, eksport og import ---------- */
  function printCase(item, receipt = false) {
    if (!item) return;
    const fields = receipt
      ? [['Mottatt tidspunkt', prettyDate(new Date().toISOString())], ['Saksnummer', item.number], ['Elev / innlevert av', item.user], ['Klasse', item.room], ['Utstyr', item.equipment], ['Serienummer / maskin-ID', item.serial], ['Utlåns-ID', item.loanId], ['Mottakende tekniker', item.technician], ['Medfølgende tilbehør', ''], ['Synlige skader / merknader', '']]
      : [['Saksnummer', item.number], ['Dato', prettyDate(item.createdAt)], ['Tekniker', item.technician], ['Elev / lærer', item.user], ['Klasse', item.room], ['Utstyr', item.equipment], ['Serienummer / maskin-ID', item.serial], ['Utlåns-ID', item.loanId], ['Kategori', item.category], ['Prioritet', item.priority], ['Status', item.status], ['Symptom', item.symptom], ['Årsak', item.cause], ['Tiltak', item.action], ['Interne skift-notater', item.shiftNotes]];
    const lines = fields.map(([label, value]) => `<tr><td>${safe(label)}</td><td class="${receipt && !value ? 'print-lines' : ''}">${safe(value || '')}</td></tr>`).join('');
    $('#print-area').innerHTML = `<div class="print-sheet"><h1>${receipt ? 'Utstyrsinnlevering' : 'Saksnotat'} · IKT-support</h1><div class="print-meta">${receipt ? 'Ta vare på denne kvitteringen og vis den ved henting.' : 'Skolens elevdrevne brukerstøtte'} · ${safe(item.number)}</div><table class="print-table"><tbody>${lines}</tbody></table>${receipt ? '<p class="print-note">Enheten oppbevares forsvarlig av skolens IKT-support. Kontakt Helpnotes for spørsmål om status.</p>' : ''}<div class="print-signatures"><div>${receipt ? 'Signatur bruker' : 'Tekniker'}</div><div>${receipt ? 'Mottatt dato / signatur' : 'Dato'}</div></div></div>`;
    window.print();
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv() {
    const columns = [['number', 'Saksnummer'], ['createdAt', 'Opprettet'], ['updatedAt', 'Sist oppdatert'], ['technician', 'Tekniker'], ['user', 'Elev/lærer'], ['room', 'Klasse/rom'], ['equipment', 'Utstyr'], ['serial', 'Serienummer'], ['loanId', 'Utlåns-ID'], ['category', 'Kategori'], ['priority', 'Prioritet'], ['symptom', 'Symptom'], ['cause', 'Årsak'], ['action', 'Tiltak'], ['shiftNotes', 'Interne skift-notater'], ['status', 'Status']];
    const quote = value => { const raw = text(value); return `"${(/^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw).replace(/"/g, '""')}"`; };
    const csv = '\ufeff' + [columns.map(([, l]) => quote(l)).join(';'), ...cases.map(item => columns.map(([k]) => quote(item[k])).join(';'))].join('\r\n');
    download(`ikt-saker-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
    toast('CSV-filen er lastet ned.');
  }

  function exportJson() {
    download(`helpnotes-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'helpnotes-backup', version: 2, exportedAt: new Date().toISOString(), cases }, null, 2), 'application/json');
    try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (error) { /* ignorer */ }
    updateBackupStatus();
    toast('JSON-backup er lastet ned.');
  }

  async function importJson(file) {
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Filen er for stor (maks 20 MB).');
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed?.cases;
      if (!Array.isArray(incoming) || incoming.some(i => !i || typeof i !== 'object' || !i.number || !i.id)) throw new Error('Ugyldig backupformat.');
      const cleaned = cleanCases(incoming);
      const skipped = incoming.length - cleaned.length;
      const merge = cases.length ? confirm(`Importen inneholder ${cleaned.length} saker.\n\nVelg OK for å slå sammen med ${cases.length} eksisterende saker.\nVelg Avbryt for å erstatte alle eksisterende saker.`) : true;
      let result; let nextDeletions = deletions;
      if (merge) { const map = new Map(cases.map(c => [c.id, c])); cleaned.forEach(c => map.set(c.id, c)); result = [...map.values()]; }
      else {
        result = cleaned;
        const keep = new Set(cleaned.map(c => c.id)); const now = new Date().toISOString();
        nextDeletions = { ...deletions }; cases.forEach(c => { if (!keep.has(c.id)) nextDeletions[c.id] = now; });
      }
      cleaned.forEach(c => { delete nextDeletions[c.id]; });
      const seen = new Set();
      for (const c of result) { const k = c.number.toLocaleLowerCase('nb'); if (seen.has(k)) throw new Error(`Saksnummeret ${c.number} forekommer flere ganger.`); seen.add(k); }
      if (!persist(result, nextDeletions)) return;
      visibleCount = PAGE_SIZE; refreshAll();
      toast(`${cleaned.length} saker importert${skipped ? ` · ${skipped} eksempelsaker utelatt` : ''}.`);
    } catch (error) { toast(`Import mislyktes: ${error.message || 'Kunne ikke lese filen.'}`, 'error'); }
  }

  /* ---------- Hendelser ---------- */
  $$('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  $$('[data-cloud-sync]').forEach(button => button.addEventListener('click', async () => {
    const result = await cloud.syncNow();
    if (result.ok) toast('Sakslogg synkronisert med Supabase.'); else if (result.error) toast(result.error.message, 'error');
  }));
  $('.skip-link').addEventListener('click', event => { event.preventDefault(); $('#content').focus(); });
  window.addEventListener('hashchange', () => {
    const raw = location.hash.replace('#', '');
    if (raw && !VIEWS.includes(raw)) return;
    const next = viewFromHash();
    if (next === currentView) return;
    if (!canLeaveForm(next)) { keepTechOnEnter = false; history.replaceState(null, '', `#${currentView}`); return; }
    applyView(next);
  });
  window.addEventListener('beforeunload', event => { if (editingId && formDirty) { event.preventDefault(); event.returnValue = ''; } flushDraft(); });
  window.addEventListener('storage', event => {
    if (event.key === DELETIONS_KEY) { deletions = loadDeletions(); return; }
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    try { cases = cleanCases(JSON.parse(event.newValue || '[]')); } catch (error) { return; }
    refreshAll();
    toast('Sakene ble oppdatert fra en annen fane.');
  });

  const form = $('#case-form');
  form.addEventListener('submit', submitCase);
  form.addEventListener('input', () => { formDirty = true; scheduleDraft(); updateFormStatus(); });
  form.addEventListener('change', () => { formDirty = true; scheduleDraft(); updateFormStatus(); });
  $('#role-seg').addEventListener('change', () => { whoManual = false; refreshWho(); });
  $('#student-class').addEventListener('input', () => { whoManual = false; refreshWho(); });
  $('#student-class').addEventListener('change', event => { if (!keepsLegacy()) event.target.value = normClass(event.target.value); refreshWho(); });
  $('#who-input').addEventListener('input', () => { whoManual = true; refreshWho(); });
  $('#who-input').addEventListener('change', event => {
    if (keepsLegacy()) return;
    const value = parseWho(event.target.value, currentRole());
    if (value) event.target.value = value; else whoManual = false;
    refreshWho();
  });
  $('#technician').addEventListener('change', () => { syncTechnicianOther(); if ($('#technician').value === '__other') $('#technician-other').focus(); });
  $('#case-number').addEventListener('input', event => event.target.closest('.field').classList.remove('is-missing'));
  $('#cancel-edit').addEventListener('click', () => { resetForm(); navigate('log'); });
  $('#reset-form').addEventListener('click', () => {
    const original = editingId ? cases.find(c => c.id === editingId) : null;
    if (original) { form.reset(); fillForm(original); formDirty = false; updateFormStatus(); } else resetForm();
  });
  $$('[data-template]').forEach(button => button.addEventListener('click', () => {
    for (const [key, value] of Object.entries(templates[button.dataset.template])) {
      if (key === 'category') setRadio('category', value);
      else { const field = $(`#case-form [name="${key}"]`); if (field) field.value = value; }
    }
    formDirty = true; scheduleDraft(); updateFormStatus();
    if (text($('#action').value) || text($('#cause').value)) $('#symptom').scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast('Hurtigmal fylt inn. Velg prioritet og status.');
  }));

  $$('[data-new-status]').forEach(button => button.addEventListener('click', () => {
    if (editingId) resetForm({ keepDraft: true });
    setRadio('status', button.dataset.newStatus);
    formDirty = true; scheduleDraft(); updateFormStatus();
    navigate('new');
  }));

  const sidebarEl = $('#sidebar'), SIDEBAR_KEY = 'helpnotes_sidebar_collapsed';
  function setSidebar(collapsed, save = true) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    $('#sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
    $('#sidebar-toggle .sb-label').textContent = collapsed ? 'Vis' : 'Skjul';
    if (save) { try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (error) { /* ignorer */ } }
  }
  $('#sidebar-toggle').addEventListener('click', () => setSidebar(!document.body.classList.contains('sidebar-collapsed')));
  try { setSidebar(localStorage.getItem(SIDEBAR_KEY) === '1', false); } catch (error) { /* ignorer */ }
  $('#search-cases').addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filters.query = event.target.value.trim().toLocaleLowerCase('nb'); visibleCount = PAGE_SIZE; renderLog(); }, 150);
  });
  $('#filter-tech').addEventListener('change', event => { filters.tech = event.target.value; visibleCount = PAGE_SIZE; renderLog(); renderSidebar(); });
  $('#filter-category').addEventListener('change', event => { filters.category = event.target.value; visibleCount = PAGE_SIZE; renderLog(); });
  $('#status-tabs').addEventListener('click', event => { const tab = event.target.closest('[data-status-tab]'); if (tab) { filters.status = tab.dataset.statusTab; visibleCount = PAGE_SIZE; renderLog(); } });
  const clearFilters = () => { Object.assign(filters, { query: '', status: '', tech: '', category: '' }); $('#search-cases').value = ''; visibleCount = PAGE_SIZE; renderLog(); renderSidebar(); };
  $('#clear-filters').addEventListener('click', clearFilters);
  ['list', 'cards', 'table'].forEach(m => $(`#mode-${m}`).addEventListener('click', () => { logMode = m; renderLog(); }));
  $('#side-technicians').addEventListener('click', event => {
    const link = event.target.closest('[data-tech]'); if (!link) return;
    const name = link.dataset.tech;
    goToLog({ tech: currentView === 'log' && filters.tech === name ? '' : name, status: '' });
  });
  $('#attention-list').addEventListener('click', event => {
    const row = event.target.closest('[data-open-id]');
    if (!row) return;
    Object.assign(filters, { query: '', status: '', tech: '', category: '' });
    $('#search-cases').value = '';
    openCaseId = row.dataset.openId;
    navigate('log');
  });

  function handleListClick(event) {
    const action = event.target.closest('[data-action]');
    if (action) {
      const name = action.dataset.action;
      if (name === 'new-case') { resetForm(); navigate('new'); return true; }
      if (name === 'clear-filters') { clearFilters(); return true; }
      if (name === 'show-more') { visibleCount += PAGE_SIZE; renderLog(); return true; }
      if (name === 'close-detail') { closeCase(); return true; }
      const item = cases.find(c => c.id === action.dataset.id);
      if (!item) return true;
      if (name === 'edit') beginEdit(item);
      if (name === 'print') printCase(item, false);
      if (name === 'receipt') printCase(item, true);
      if (name === 'delete') deleteCase(item.id);
      return true;
    }
    return false;
  }
  $('#case-detail').addEventListener('click', event => {
    if (handleListClick(event)) return;
    const set = event.target.closest('[data-status-set]');
    if (set && openCaseId) updateStatus(openCaseId, set.dataset.statusSet);
  });
  $('#case-list').addEventListener('click', event => {
    if (handleListClick(event)) return;
    const row = event.target.closest('[data-open-id]');
    if (row) openCase(row.dataset.openId);
  });
  $('#case-list').addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-open-id]')) { event.preventDefault(); openCase(event.target.dataset.openId); }
  });
  $('#sheet-backdrop').addEventListener('click', closeCase);

  $('#export-csv').addEventListener('click', exportCsv);
  $('#export-json').addEventListener('click', exportJson);
  $('#import-trigger').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', event => { const file = event.target.files[0]; if (file) importJson(file); event.target.value = ''; });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (openCaseId && currentView === 'log') { closeCase(); return; }
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && currentView === 'new') { event.preventDefault(); form.requestSubmit($('#submit-case')); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'n' || event.key === 'N') { event.preventDefault(); navigate('new'); }
    else if (event.key === '/') { event.preventDefault(); navigate('log'); setTimeout(() => $('#search-cases').focus(), 60); }
  });

  /* ---------- Oppstart ---------- */
  renderChoices();
  try { localStorage.setItem('__ikt_probe', '1'); localStorage.removeItem('__ikt_probe'); } catch (error) { localAvailable = false; }
  cloud.onStatus(updateCloudUI);
  cloud.attach({
    getCases: () => cases,
    getDeletions: () => deletions,
    applyMerge: next => { const cleaned = cleanCases(next); if (writeJson(STORAGE_KEY, cleaned)) { cases = cleaned; refreshAll(); } },
    clearDeletions: ids => { const rest = { ...deletions }; ids.forEach(id => { delete rest[id]; }); deletions = rest; writeJson(DELETIONS_KEY, rest); }
  });
  resetForm({ keepDraft: true });
  restoreDraft();
  updateSuggestions();
  renderDashboard();
  renderSidebar();
  applyView(viewFromHash(), false);
  cloud.requestSync(400);
})();
