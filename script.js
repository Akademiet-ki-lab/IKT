(() => {
  'use strict';

  const STORAGE_KEY = 'ikt_school_tickets_v2';
  const TECHNICIANS = ['Elev 1 - Alex', 'Elev 2 - Nora', 'Elev 3 - Jonas'];
  const CATEGORIES = ['#Hardware', '#Programvare', '#Nettverk', '#Feide', '#Skriver', '#Annet'];
  const templates = {
    feide: {category:'#Feide', symptom:'Brukeren får ikke logget inn med Feide og har glemt passordet.', cause:'Passordet er glemt eller utløpt.', action:'Veiledet brukeren til skolens rutine for passordbytte. Testet innlogging sammen med brukeren.', status:'Løst'},
    disk: {category:'#Hardware', symptom:'Brukeren får varsel om at disken er full og kan ikke lagre nye filer.', cause:'Lagringsplassen er brukt opp av lokale filer og midlertidige data.', action:'Gikk gjennom lagringsoversikten, fjernet unødvendige midlertidige filer og flyttet dokumenter til godkjent skylagring.', status:'Løst'},
    wifi: {category:'#Nettverk', symptom:'Enheten kobler ikke til skolens Wi-Fi eller mister forbindelsen.', cause:'Nettverksprofilen var utdatert / tilkoblingen var falt ut.', action:'Kontrollerte Wi-Fi, koblet fra og til skolens nettverk på nytt og testet tilkoblingen.', status:'Løst'},
    print: {category:'#Skriver', symptom:'Dokumentet blir stående i utskriftskøen og kommer ikke ut.', cause:'Utskriftskøen hadde en fastlåst jobb.', action:'Tømte utskriftskøen, la inn jobben på nytt og bekreftet utskrift.', status:'Løst'},
    slow: {category:'#Hardware', symptom:'PC-en oppleves treg og programmer bruker lang tid på å åpne.', cause:'Mange åpne programmer / enheten trengte omstart.', action:'Lagret åpne arbeider, startet enheten på nytt og testet at ytelsen var bedre.', status:'Løst'}
  };

  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let cases = loadCases();
  let editingId = null;
  let logMode = 'table';
  let currentFormStep = 0;
  let expandedLogId = null;
  let logFiltersOpen = false;

  function isDemoCase(item){ return String(item?.id || '').startsWith('demo-inc-'); }
  function cleanCases(value){
    if (!Array.isArray(value)) return [];
    const validStatuses = ['Løst','Venter på deler/bruker','Eskalert til IKT-ansvarlig'];
    const validPriorities = ['Lav','Middels','Høy','Haster'];
    const now = new Date().toISOString();
    const cleanDate = value => {
      const date = new Date(value || now);
      return Number.isNaN(date.getTime()) ? now : date.toISOString();
    };
    return value
      .filter(item => item && typeof item === 'object' && item.id && item.number && !isDemoCase(item))
      .map(item => {
        const rawStatus = String(item.status || 'Venter på deler/bruker');
        const status = rawStatus === 'Venter' ? 'Venter på deler/bruker' : rawStatus === 'Eskalert' ? 'Eskalert til IKT-ansvarlig' : rawStatus;
        const rawCategory = String(item.category || '#Annet');
        const category = rawCategory.startsWith('#') ? rawCategory : `#${rawCategory}`;
        return {
          ...item,
          id:String(item.id),
          number:String(item.number).trim(),
          technician:String(item.technician || 'Ukjent tekniker'),
          user:String(item.user || 'Ukjent bruker'),
          room:String(item.room || ''),
          equipment:String(item.equipment || ''),
          serial:String(item.serial || ''),
          loanId:String(item.loanId || ''),
          category:CATEGORIES.includes(category) ? category : '#Annet',
          priority:validPriorities.includes(item.priority) ? item.priority : 'Middels',
          symptom:String(item.symptom || ''),
          cause:String(item.cause || ''),
          action:String(item.action || ''),
          shiftNotes:String(item.shiftNotes || ''),
          status:validStatuses.includes(status) ? status : 'Venter på deler/bruker',
          createdAt:cleanDate(item.createdAt),
          updatedAt:cleanDate(item.updatedAt || item.createdAt)
        };
      });
  }

  function writeInitialCases(value){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
    catch (error) { console.warn('Kunne ikke oppdatere lokal sakslogg:', error); }
  }

  function removeLegacyStorage(){
    try { localStorage.removeItem('ikt-pulten-cases-v1'); }
    catch (error) { console.warn('Kunne ikke rydde eldre lokal lagring:', error); }
  }

  function loadCases(){
    let stored;
    try { stored = localStorage.getItem(STORAGE_KEY); }
    catch (error) { console.warn('Kunne ikke lese lokal sakslogg:', error); return []; }

    if (stored !== null) {
      let value;
      try { value = JSON.parse(stored); }
      catch (error) { console.warn('Saksloggen hadde ugyldig JSON og starter tom:', error); value = []; }
      const cleaned = cleanCases(value);
      if (!Array.isArray(value) || JSON.stringify(cleaned) !== JSON.stringify(value)) writeInitialCases(cleaned);
      removeLegacyStorage();
      return cleaned;
    }

    let legacy;
    try { legacy = localStorage.getItem('ikt-pulten-cases-v1'); }
    catch (error) { console.warn('Kunne ikke lese eldre sakslogg:', error); }
    if (legacy !== null && legacy !== undefined) {
      let previous = [];
      try { previous = JSON.parse(legacy); }
      catch (error) { console.warn('Eldre sakslogg hadde ugyldig JSON:', error); }
      const migrated = cleanCases(previous);
      writeInitialCases(migrated);
      removeLegacyStorage();
      return migrated;
    }
    writeInitialCases([]);
    return [];
  }

  function persist(nextCases=cases){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextCases));
      cases = nextCases;
      return true;
    } catch (error) {
      toast('Kunne ikke lagre lokalt. Kontroller ledig lagringsplass i nettleseren.', 'error');
      return false;
    }
  }

  function escapeAttr(value){ return safe(value).replace(/`/g, '&#96;'); }

  function toast(message, type='success'){
    const node = document.createElement('div');
    node.className = `toast flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl ${type==='error'?'border-[#764449] bg-[#332326] text-[#ffd1d1]':'border-[#3e574c] bg-[#202c27] text-[#d5f7e6]'}`;
    node.innerHTML = `<i class="fa-solid ${type==='error'?'fa-circle-exclamation':'fa-circle-check'}"></i><span>${safe(message)}</span>`;
    $('#toast-region').append(node);
    setTimeout(() => node.remove(), 3800);
  }

  function updateStorageIndicator(){
    const indicator = $('#storage-indicator');
    const label = $('#storage-status-label');
    const probeKey = `__ikt_storage_probe_${Date.now()}`;
    try {
      localStorage.setItem(probeKey, 'ok');
      localStorage.removeItem(probeKey);
      indicator.classList.remove('storage-unavailable');
      label.textContent = 'Lokal lagring er aktiv';
    } catch (error) {
      indicator.classList.add('storage-unavailable');
      label.textContent = 'Lokal lagring er utilgjengelig';
    }
  }

  function nextNumber(){
    let highest = 1000;
    cases.forEach(item => { const match = String(item.number || '').match(/^INC-(\d+)$/i); if (match) highest = Math.max(highest, Number(match[1])); });
    let candidate;
    do { candidate = `INC-${highest + 1}`; highest++; } while (cases.some(item => item.number === candidate));
    return candidate;
  }

  function setView(view, updateHash=true){
    if (!['dashboard','new','log'].includes(view)) view = 'dashboard';
    $$('.view').forEach(section => section.classList.toggle('hidden', section.id !== `view-${view}`));
    $$('.nav-btn[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    if (updateHash) {
      const target = view === 'log' ? '#log' : view === 'new' ? '#new' : '#dashboard';
      if (location.hash !== target) history.replaceState(null, '', target);
    }
    if (view === 'log') renderLog();
    window.scrollTo({top:0, behavior:'smooth'});
  }

  function showFormStep(index){
    const steps = $$('.form-step');
    const stepNames = ['Saksinfo','Problem','Løsning','Status'];
    currentFormStep = Math.max(0, Math.min(index, steps.length - 1));
    steps.forEach((step,stepIndex) => step.classList.toggle('hidden', stepIndex !== currentFormStep));
    $$('.step-indicator').forEach((button,stepIndex) => {
      button.classList.toggle('active', stepIndex === currentFormStep);
      button.classList.toggle('complete', stepIndex < currentFormStep);
      button.disabled = stepIndex > currentFormStep;
      button.setAttribute('aria-current', stepIndex === currentFormStep ? 'step' : 'false');
    });
    $('#step-progress-fill').style.width = `${currentFormStep / (steps.length - 1) * 100}%`;
    $('#step-back').disabled = currentFormStep === 0;
    $('#step-next').hidden = currentFormStep === steps.length - 1;
    $('#submit-case').hidden = currentFormStep !== steps.length - 1;
    $('#step-caption').textContent = `Trinn ${currentFormStep + 1} av ${steps.length}: ${stepNames[currentFormStep]}`;
    updateStepControls();
  }

  function validateCurrentStep(){
    const step = $(`.form-step[data-form-step="${currentFormStep}"]`);
    for (const field of step.querySelectorAll('input,select,textarea')) {
      if (!field.checkValidity()) {
        field.reportValidity();
        field.focus();
        return false;
      }
    }
    return true;
  }

  function updateStepControls(){
    const step = $(`.form-step[data-form-step="${currentFormStep}"]`);
    const valid = [...step.querySelectorAll('input,select,textarea')].every(field => field.checkValidity());
    $('#step-next').disabled = !valid;
    $('#submit-case').disabled = !valid;
    $('#step-validation-hint').hidden = valid;
  }

  function statusClass(status){ return status === 'Løst' ? 'status-lost' : status === 'Venter på deler/bruker' ? 'status-venter' : 'status-eskalert'; }
  function shortStatus(status){ return status === 'Løst' ? 'Løst' : status === 'Venter på deler/bruker' ? 'Venter' : 'Eskalert'; }
  function priorityClass(priority){ return `priority-${({'Lav':'lav','Middels':'middels','Høy':'hoy','Haster':'haster'})[priority] || 'lav'}`; }
  function prettyDate(value){ const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Ukjent dato' : new Intl.DateTimeFormat('no-NO', {dateStyle:'medium',timeStyle:'short'}).format(date); }

  function renderTicketChart(){
    const today = new Date();
    today.setHours(0,0,0,0);
    const days = Array.from({length:7}, (_,index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - 6 + index);
      return date;
    });
    const counts = days.map(day => cases.filter(item => {
      const created = new Date(item.createdAt);
      return created.getFullYear() === day.getFullYear() && created.getMonth() === day.getMonth() && created.getDate() === day.getDate();
    }).length);
    const max = Math.max(1, ...counts);
    const left = 48, right = 710, top = 24, bottom = 178;
    const points = counts.map((count,index) => ({
      x:left + index * (right-left) / 6,
      y:bottom - count / max * (bottom-top),
      count
    }));
    const linePath = points.map((point,index) => `${index?'L':'M'} ${point.x} ${point.y}`).join(' ');
    const areaPath = `${linePath} L ${right} ${bottom} L ${left} ${bottom} Z`;
    const labels = points.map((point,index) => `<text class="chart-axis-label" x="${point.x}" y="207" text-anchor="middle">${safe(new Intl.DateTimeFormat('no-NO',{weekday:'short'}).format(days[index]).replace('.',''))}</text>`).join('');
    const grid = [0,.5,1].map(fraction => {
      const y = bottom - fraction * (bottom-top);
      const value = Math.round(max * fraction);
      return `<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text class="chart-axis-label" x="34" y="${y+4}" text-anchor="end">${value}</text>`;
    }).join('');
    const dots = points.map(point => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4"><title>${point.count} saker</title></circle>`).join('');
    const weekTotal = counts.reduce((sum,count) => sum + count,0);
    $('#ticket-chart').innerHTML = `<svg viewBox="0 0 720 220" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="ticket-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#91adff" stop-opacity=".3"/><stop offset="100%" stop-color="#91adff" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${areaPath}"/><path class="chart-line" d="${linePath}"/>${dots}${labels}</svg>${weekTotal===0?'<div class="chart-empty">Ingen saker registrert de siste 7 dagene</div>':''}`;
    $('#chart-week-total').textContent = `${weekTotal} ${weekTotal === 1 ? 'sak' : 'saker'} siste 7 dager`;
  }

  function renderDashboard(){
    const total = cases.length;
    const solved = cases.filter(item => item.status === 'Løst').length;
    const waiting = cases.filter(item => item.status === 'Venter på deler/bruker').length;
    const escalated = cases.filter(item => item.status === 'Eskalert til IKT-ansvarlig').length;
    $('#stat-total').textContent = total;
    $('#stat-lost').textContent = solved;
    $('#stat-venter').textContent = waiting;
    $('#stat-eskalert').textContent = escalated;
    $('#nav-count').textContent = total ? `(${total})` : '';
    const resolutionRate = total ? Math.round(solved / total * 100) : 0;
    $('#resolution-rate').textContent = `${resolutionRate}%`;
    $('#resolution-progress').style.width = `${Math.min(resolutionRate / 90 * 100,100)}%`;
    $('#solved-share').textContent = `${resolutionRate}% av sakene`;
    renderTicketChart();

    const categoryCounts = CATEGORIES.map(category => ({category, count:cases.filter(item => item.category === category).length}));
    const max = Math.max(1, ...categoryCounts.map(row => row.count));
    $('#category-bars').innerHTML = total ? categoryCounts.map(row => `<div class="category-row"><div class="category-row-top"><strong>${safe(row.category)}</strong><span>${row.count}</span></div><div class="category-track"><div class="category-fill" style="width:${row.count/max*100}%"></div></div></div>`).join('') : '<p class="dashboard-empty">Kategorifordelingen vises når den første saken er registrert.</p>';

    const stats = TECHNICIANS.map(name => {
      const own = cases.filter(item => item.technician === name);
      return {name,total:own.length,solved:own.filter(item => item.status === 'Løst').length};
    }).sort((a,b) => b.total-a.total || b.solved-a.solved);
    const medals = ['fa-medal text-[#ca8a04]','fa-award text-[#71717a]','fa-award text-[#a16207]'];
    $('#leaderboard').innerHTML = stats.map((row,index) => `<div class="tech-row"><span class="tech-rank"><i class="fa-solid ${medals[index]}"></i></span><span class="tech-name">${safe(row.name)}</span><span class="tech-solved">${row.solved} løst</span><span class="tech-total">${row.total}</span></div>`).join('');

    const recent = [...cases].sort((a,b) => new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt)).slice(0,4);
    $('#recent-cases').innerHTML = recent.length ? recent.map(item => `<div class="recent-row"><span class="recent-number">${safe(item.number)}</span><span class="recent-meta"><strong>${safe(item.user)}</strong><small>${safe(item.category||'#Annet')} · ${safe(prettyDate(item.updatedAt||item.createdAt))}</small></span><span class="recent-status ${statusClass(item.status)}">${safe(shortStatus(item.status))}</span></div>`).join('') : `<div class="dashboard-empty">Ingen saker ennå. Opprett en ny sak for å komme i gang.</div>`;
  }

  function updateTechFilter(){
    const select = $('#filter-tech');
    const selected = select.value;
    const techs = [...new Set([...TECHNICIANS, ...cases.map(item => item.technician).filter(Boolean)])];
    select.innerHTML = '<option value="">Alle teknikere</option>' + techs.map(name => `<option value="${escapeAttr(name)}">${safe(name)}</option>`).join('');
    if (techs.includes(selected)) select.value = selected;
  }

  function matchesFilters(item){
    const query = $('#search-cases').value.trim().toLocaleLowerCase('no');
    const haystack = [item.number,item.user,item.room,item.equipment,item.serial,item.symptom,item.cause,item.action,item.shiftNotes,item.loanId,item.technician,item.category,item.priority,item.status].join(' ').toLocaleLowerCase('no');
    return (!query || haystack.includes(query)) && (!$('#filter-status').value || item.status === $('#filter-status').value) && (!$('#filter-tech').value || item.technician === $('#filter-tech').value) && (!$('#filter-category').value || item.category === $('#filter-category').value);
  }

  function cardMarkup(item){
    const details = [
      ['Bruker & klasse/rom',[item.user,item.room].filter(Boolean).join(' · ')],
      ['Utstyr & serienummer',[item.equipment,item.serial].filter(Boolean).join(' · ')],
      ['Utlåns-ID',item.loanId],['Symptom',item.symptom],['Årsak',item.cause],['Tiltak',item.action],['Interne skift-notater',item.shiftNotes]
    ];
    return `<article class="ticket-card mb-4"><div class="ticket-head flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div class="flex flex-wrap items-center gap-2"><span class="mono text-sm font-bold text-[#c4d1ff]">${safe(item.number)}</span><span class="text-[#596372]">/</span><span class="text-xs text-[#d1d7e1]">${safe(item.category||'#Annet')}</span><span class="priority-pill ${priorityClass(item.priority)}">${safe(item.priority||'Middels')} prioritet</span></div><div class="flex items-center gap-2"><span class="status-pill ${statusClass(item.status)}">${safe(item.status)}</span><div class="flex gap-1 ml-1"><button class="icon-btn" data-action="edit" data-id="${escapeAttr(item.id)}" aria-label="Rediger ${escapeAttr(item.number)}" title="Rediger"><i class="fa-solid fa-pen"></i></button><button class="icon-btn" data-action="print" data-id="${escapeAttr(item.id)}" aria-label="Skriv ut saksnotat ${escapeAttr(item.number)}" title="Skriv ut saksnotat"><i class="fa-solid fa-print"></i></button><button class="icon-btn" data-action="receipt" data-id="${escapeAttr(item.id)}" aria-label="Skriv ut kvittering for ${escapeAttr(item.number)}" title="Skriv ut kvittering"><i class="fa-solid fa-file-signature"></i></button><button class="icon-btn delete" data-action="delete" data-id="${escapeAttr(item.id)}" aria-label="Slett ${escapeAttr(item.number)}" title="Slett"><i class="fa-solid fa-trash-can"></i></button></div></div></div><div class="ticket-grid grid" style="grid-template-columns:minmax(0,38%) minmax(0,62%)">${details.map(([label,value]) => `<div class="label-cell border-t border-[#333a46] bg-[#2e3543] text-xs font-bold text-[#dfe4ec]">${label}</div><div class="ticket-value border-t border-[#333a46] px-4 py-3 text-sm text-[#c9d0db] whitespace-pre-wrap break-words">${value ? safe(value) : '<span class="text-[#667180] italic">Ikke oppgitt</span>'}</div>`).join('')}</div><div class="flex flex-wrap justify-between gap-2 px-4 py-3 border-t border-[#333a46] text-[11px] text-[#8490a0]"><span><i class="fa-solid fa-user-gear mr-1.5"></i>${safe(item.technician)}</span><span><i class="fa-regular fa-clock mr-1.5"></i>${safe(prettyDate(item.updatedAt||item.createdAt))}</span></div></article>`;
  }

  function tableMarkup(items){
    const detail = (label,value) => `<div class="log-detail-item"><span>${safe(label)}</span><p>${value ? safe(value) : '<em>Ikke oppgitt</em>'}</p></div>`;
    const rows = items.map(item => {
      const expanded = expandedLogId === item.id;
      const created = new Date(item.createdAt);
      const time = Number.isNaN(created.getTime()) ? '—' : `${created.toLocaleDateString('no-NO',{day:'2-digit',month:'2-digit'})} ${created.toLocaleTimeString('no-NO',{hour:'2-digit',minute:'2-digit'})}`;
      const expandedDetails = `<div class="log-expanded"><section class="log-detail-section"><h4>Problem og løsning</h4><div class="log-detail-grid">${detail('Symptom',item.symptom)}${detail('Årsak',item.cause)}${detail('Tiltak',item.action)}</div></section><section class="log-detail-section"><h4>Bruker og utstyr</h4><div class="log-detail-grid">${detail('Bruker',item.user)}${detail('Klasse / rom',item.room)}${detail('Utstyr',item.equipment)}${detail('Serienummer',item.serial)}${detail('Utlåns-ID',item.loanId)}</div></section><section class="log-detail-section"><h4>Internt notat</h4><div class="log-detail-grid">${detail('Beskjed til neste tekniker',item.shiftNotes)}</div></section><div class="log-expanded-footer"><div class="log-tags"><span>${safe(item.category||'#Annet')}</span><span>${safe(item.priority||'Middels')} prioritet</span><span>Tekniker: ${safe(item.technician||'—')}</span><span>Oppdatert ${safe(prettyDate(item.updatedAt||item.createdAt))}</span></div><div class="log-actions"><button class="log-action" data-action="edit" data-id="${escapeAttr(item.id)}" title="Rediger sak"><i class="fa-solid fa-pen"></i><span>Rediger</span></button><button class="log-action" data-action="print" data-id="${escapeAttr(item.id)}" title="Skriv ut saksnotat"><i class="fa-solid fa-print"></i><span>Saksnotat</span></button><button class="log-action" data-action="receipt" data-id="${escapeAttr(item.id)}" title="Skriv ut kvittering"><i class="fa-solid fa-file-signature"></i><span>Kvittering</span></button><button class="log-action danger" data-action="delete" data-id="${escapeAttr(item.id)}" title="Slett sak"><i class="fa-solid fa-trash-can"></i><span>Slett</span></button></div></div></div>`;
      return `<article class="log-entry ${expanded?'is-expanded':''}"><button type="button" class="log-main-row" data-expand-id="${escapeAttr(item.id)}" aria-expanded="${expanded}" aria-label="${expanded?'Lukk':'Åpne'} sak ${escapeAttr(item.number)}"><span class="log-chevron"><i class="fa-solid fa-chevron-down"></i></span><span class="log-priority ${priorityClass(item.priority)}">${safe(item.priority||'Middels')}</span><time class="log-time" datetime="${escapeAttr(item.createdAt||'')}">${safe(time)}</time><span class="log-ticket-number">${safe(item.number)}</span><span class="log-summary"><strong>${safe(item.user||'Ukjent bruker')}</strong><span>${safe(item.symptom||'Beskrivelse mangler – åpne saken for detaljer')}</span></span><span class="status-pill ${statusClass(item.status)}">${safe(item.status)}</span><span class="log-technician">${safe(item.technician||'—')}</span></button>${expanded?expandedDetails:''}</article>`;
    }).join('');
    return `<div class="interactive-log-table"><div class="log-column-head"><span class="log-col-chevron"></span><span class="log-col-priority">Prioritet</span><span class="log-col-time">Dato / tid</span><span class="log-col-number">Saksnr.</span><span>Bruker og problem</span><span>Status</span><span>Tekniker</span></div><div class="log-rows">${rows}</div></div>`;
  }

  function renderLog(){
    updateTechFilter();
    const items = [...cases].filter(matchesFilters).sort((a,b) => new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt));
    $('#results-count').textContent = `${items.length} ${items.length===1?'sak':'saker'}${items.length!==cases.length?` av ${cases.length}`:''}`;
    const activeFilters = ['filter-status','filter-tech','filter-category'].filter(id => $('#'+id).value).length;
    $('#active-filter-count').textContent = activeFilters;
    $('#active-filter-count').classList.toggle('hidden', activeFilters === 0);
    $('#toggle-log-filters').classList.toggle('is-active', logFiltersOpen || activeFilters > 0);
    $('#toggle-log-filters').setAttribute('aria-expanded', String(logFiltersOpen));
    $('#log-filter-panel').hidden = !logFiltersOpen;
    $('#table-mode').classList.toggle('active', logMode === 'table');
    $('#cards-mode').classList.toggle('active', logMode === 'cards');
    if (items.length) {
      $('#case-list').innerHTML = logMode === 'cards' ? items.map(cardMarkup).join('') : tableMarkup(items);
    } else if (cases.length === 0) {
      $('#case-list').innerHTML = `<div class="log-empty"><span class="log-empty-icon"><i class="fa-regular fa-folder-open"></i></span><h3>Ingen saker ennå</h3><p>Registrer en sak for å starte loggen. Nye saker vises her.</p><button type="button" class="log-empty-button" data-action="new-case"><i class="fa-solid fa-plus"></i> Registrer første sak</button></div>`;
    } else {
      $('#case-list').innerHTML = `<div class="log-empty"><span class="log-empty-icon"><i class="fa-solid fa-magnifying-glass"></i></span><h3>Ingen saker passer søket</h3><p>Prøv et annet ord eller nullstill søket og filtrene.</p><button type="button" class="log-empty-button" data-action="clear-log-search"><i class="fa-solid fa-rotate-left"></i> Vis alle saker</button></div>`;
    }
  }

  function resetForm(){
    $('#case-form').reset();
    $('#technician-other').value = '';
    $('#technician-other').required = false;
    $('#technician-other').classList.add('hidden');
    $('#case-number').value = nextNumber();
    editingId = null;
    $('#form-heading').innerHTML = 'Registrer <span class="text-[#9db6ff]">ny sak</span>';
    $('#submit-case').innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Lagre saksnotat';
    $('#cancel-edit').classList.add('hidden');
    showFormStep(0);
  }

  function beginEdit(item){
    editingId = item.id;
    $('#form-heading').innerHTML = 'Rediger <span class="text-[#9db6ff]">sak</span>';
    $('#submit-case').innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Lagre endringer';
    $('#cancel-edit').classList.remove('hidden');
    const techSelect = $('#technician');
    if (TECHNICIANS.includes(item.technician)) {
      techSelect.value = item.technician;
      $('#technician-other').required = false;
      $('#technician-other').classList.add('hidden');
    } else {
      techSelect.value = '__other';
      $('#technician-other').required = true;
      $('#technician-other').classList.remove('hidden');
      $('#technician-other').value = item.technician || '';
    }
    for (const key of ['number','user','room','equipment','serial','category','priority','symptom','cause','action','shiftNotes','loanId','status']) {
      const field = $(`[name="${key}"]`);
      if (field) field.value = item[key] || '';
    }
    showFormStep(0);
    setView('new');
    $('#user').focus();
  }

  function formData(){
    const data = Object.fromEntries(new FormData($('#case-form')).entries());
    data.technician = data.technician === '__other' ? $('#technician-other').value.trim() : data.technician;
    for (const key of Object.keys(data)) if (typeof data[key] === 'string') data[key] = data[key].trim();
    return data;
  }

  function submitCase(event){
    event.preventDefault();
    if (currentFormStep < $$('.form-step').length - 1) {
      if (validateCurrentStep()) showFormStep(currentFormStep + 1);
      return;
    }
    const data = formData();
    if (!data.technician) { toast('Velg eller skriv inn en tekniker.', 'error'); return; }
    if (!$('#case-form').reportValidity()) return;
    const duplicate = cases.some(item => item.number.toLocaleLowerCase() === data.number.toLocaleLowerCase() && item.id !== editingId);
    if (duplicate) {
      $('#case-number').setCustomValidity('Dette saksnummeret er allerede i bruk.');
      $('#case-number').reportValidity();
      $('#case-number').setCustomValidity('');
      return;
    }
    const now = new Date().toISOString();
    if (editingId) {
      const updatedCases = cases.map(item => item.id === editingId ? {...item,...data,updatedAt:now} : item);
      if (!persist(updatedCases)) return;
      toast(`Sak ${data.number} er oppdatert.`);
    } else {
      const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const newCase = {id,...data,createdAt:now,updatedAt:now};
      if (!persist([...cases,newCase])) return;
      toast(`Sak ${data.number} er lagret.`);
    }
    renderDashboard();
    resetForm();
    setView('log');
  }

  function deleteCase(id){
    const item = cases.find(row => row.id === id);
    if (!item || !confirm(`Vil du slette sak ${item.number}? Dette kan ikke angres.`)) return;
    const remainingCases = cases.filter(row => row.id !== id);
    if (!persist(remainingCases)) return;
    renderDashboard();
    renderLog();
    toast(`Sak ${item.number} er slettet.`);
  }

  function printCase(item, receipt=false){
    if (!item) return;
    const isReceipt = receipt;
    const fields = isReceipt ? [
      ['Mottatt tidspunkt',prettyDate(new Date().toISOString())],['Saksnummer',item.number],['Elev / innlevert av',item.user],['Klasse / rom',item.room],['Utstyr',item.equipment],['Serienummer / maskin-ID',item.serial],['Utlåns-ID',item.loanId],['Mottakende tekniker',item.technician],['Medfølgende tilbehør',''],['Synlige skader / merknader','']
    ] : [
      ['Saksnummer',item.number],['Dato',prettyDate(item.createdAt)],['Tekniker',item.technician],['Bruker',item.user],['Klasse / rom',item.room],['Utstyr',item.equipment],['Serienummer / maskin-ID',item.serial],['Utlåns-ID',item.loanId],['Kategori',item.category],['Prioritet',item.priority],['Status',item.status],['Symptom',item.symptom],['Årsak',item.cause],['Tiltak',item.action],['Interne skift-notater',item.shiftNotes]
    ];
    const lines = fields.map(([label,value]) => `<tr><td>${safe(label)}</td><td class="${isReceipt&&!value?'print-lines':''}">${safe(value||'')}</td></tr>`).join('');
    $('#print-area').innerHTML = `<div class="print-sheet"><h1>${isReceipt?'Utstyrsinnlevering':'Saksnotat'} · IKT-support</h1><div class="print-meta">${isReceipt?'Ta vare på denne kvitteringen og vis den ved henting.':'Skolens elevdrevne brukerstøtte'} · ${safe(item.number)}</div><table class="print-table"><tbody>${lines}</tbody></table>${isReceipt?'<p style="margin-top:18px;font-size:12px">Enheten oppbevares forsvarlig av skolens IKT-support. Kontakt IKT-pulten for spørsmål om status.</p>':''}<div class="print-signatures"><div>${isReceipt?'Signatur bruker':'Tekniker'}</div><div>${isReceipt?'Mottatt dato / signatur':'Dato'}</div></div></div>`;
    window.print();
  }

  function download(name,content,type){
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv(){
    const columns = [['number','Saksnummer'],['createdAt','Opprettet'],['updatedAt','Sist oppdatert'],['technician','Tekniker'],['user','Bruker'],['room','Klasse/rom'],['equipment','Utstyr'],['serial','Serienummer'],['loanId','Utlåns-ID'],['category','Kategori'],['priority','Prioritet'],['symptom','Symptom'],['cause','Årsak'],['action','Tiltak'],['shiftNotes','Interne skift-notater'],['status','Status']];
    const quote = value => {
      const text = String(value ?? '');
      const spreadsheetSafe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${spreadsheetSafe.replace(/"/g,'""')}"`;
    };
    const csv = '\ufeff' + [columns.map(([,label]) => quote(label)).join(';'),...cases.map(item => columns.map(([key]) => quote(item[key])).join(';'))].join('\r\n');
    download(`ikt-saker-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
    toast('CSV-filen er lastet ned.');
  }

  function exportJson(){
    download(`ikt-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({format:'ikt-pulten-backup',version:2,exportedAt:new Date().toISOString(),cases},null,2), 'application/json');
    toast('JSON-backup er lastet ned.');
  }

  async function importJson(file){
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed.cases;
      if (!Array.isArray(incoming) || incoming.some(item => !item || typeof item !== 'object' || !item.number || !item.id)) throw new Error('Ugyldig backupformat.');
      const cleanedIncoming = cleanCases(incoming);
      const removedDemoCount = incoming.length - cleanedIncoming.length;
      const mode = cases.length ? confirm(`Importen inneholder ${cleanedIncoming.length} saker.\n\nVelg OK for å slå sammen med ${cases.length} eksisterende saker.\nVelg Avbryt for å erstatte alle eksisterende saker.`) : true;
      let result;
      if (mode) {
        const merged = new Map(cases.map(item => [item.id,item]));
        cleanedIncoming.forEach(item => merged.set(String(item.id),item));
        result = [...merged.values()];
      } else result = cleanedIncoming;
      const numbers = new Set();
      for (const item of result) {
        const normalizedNumber = item.number.trim().toLocaleLowerCase('no');
        if (numbers.has(normalizedNumber)) throw new Error(`Saksnummeret ${item.number} forekommer flere ganger i importen.`);
        numbers.add(normalizedNumber);
      }
      if (!persist(result)) return;
      renderDashboard();
      renderLog();
      toast(`${cleanedIncoming.length} saker importert${removedDemoCount ? ` · ${removedDemoCount} demoeksempler utelatt` : ''}.`);
    } catch (error) {
      toast(`Import mislyktes: ${error.message||'Kunne ikke lese filen.'}`, 'error');
    }
  }

  $$('.nav-btn[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $$('[data-goto]').forEach(button => button.addEventListener('click', () => { if (button.dataset.goto === 'new') resetForm(); setView(button.dataset.goto); }));
  $('#case-form').addEventListener('submit', submitCase);
  $('#case-form').addEventListener('reset', () => setTimeout(() => {
    if (editingId) {
      const original = cases.find(item => item.id === editingId);
      if (original) beginEdit(original);
    } else {
      $('#case-number').value = nextNumber();
      showFormStep(0);
    }
    updateStepControls();
  }, 0));
  $('#case-form').addEventListener('input', updateStepControls);
  $('#case-form').addEventListener('change', updateStepControls);
  $('#cancel-edit').addEventListener('click', () => { resetForm(); setView('log'); });
  $('#step-next').addEventListener('click', () => { if (validateCurrentStep()) showFormStep(currentFormStep + 1); });
  $('#step-back').addEventListener('click', () => showFormStep(currentFormStep - 1));
  $$('.step-indicator').forEach(button => button.addEventListener('click', () => {
    const destination = Number(button.dataset.stepGo);
    if (destination <= currentFormStep) showFormStep(destination);
  }));
  $('#technician').addEventListener('change', event => {
    const other = event.target.value === '__other';
    $('#technician-other').classList.toggle('hidden', !other);
    $('#technician-other').required = other;
    if (other) $('#technician-other').focus();
    updateStepControls();
  });
  $('#case-number').addEventListener('input', event => event.target.setCustomValidity(''));
  $$('[data-template]').forEach(button => button.addEventListener('click', () => {
    const template = templates[button.dataset.template];
    for (const [key,value] of Object.entries(template)) { const field = $(`[name="${key}"]`); if (field) field.value = value; }
    if (currentFormStep !== 0 || validateCurrentStep()) showFormStep(1);
    toast('Hurtigmal fylt inn. Tilpass teksten før du lagrer.');
  }));
  ['search-cases','filter-status','filter-tech','filter-category'].forEach(id => $('#'+id).addEventListener(id === 'search-cases' ? 'input' : 'change', renderLog));
  $('#toggle-log-filters').addEventListener('click', () => { logFiltersOpen = !logFiltersOpen; renderLog(); });
  $('#clear-log-filters').addEventListener('click', () => {
    $('#filter-status').value = '';
    $('#filter-tech').value = '';
    $('#filter-category').value = '';
    renderLog();
  });
  $('#cards-mode').addEventListener('click', () => { logMode='cards'; expandedLogId=null; renderLog(); });
  $('#table-mode').addEventListener('click', () => { logMode='table'; renderLog(); });
  $('#case-list').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button) {
      if (button.dataset.action === 'new-case') { resetForm(); setView('new'); return; }
      if (button.dataset.action === 'clear-log-search') {
        $('#search-cases').value = '';
        $('#filter-status').value = '';
        $('#filter-tech').value = '';
        $('#filter-category').value = '';
        logFiltersOpen = false;
        renderLog();
        return;
      }
      const item = cases.find(row => row.id === button.dataset.id);
      if (button.dataset.action === 'delete') deleteCase(button.dataset.id);
      if (button.dataset.action === 'edit' && item) beginEdit(item);
      if (button.dataset.action === 'print') printCase(item, false);
      if (button.dataset.action === 'receipt') printCase(item, true);
      return;
    }
    const row = event.target.closest('[data-expand-id]');
    if (row) {
      const id = row.dataset.expandId;
      expandedLogId = expandedLogId === id ? null : id;
      renderLog();
    }
  });
  $('#export-csv').addEventListener('click', exportCsv);
  $('#export-json').addEventListener('click', exportJson);
  $('#import-trigger').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', event => { const file=event.target.files[0]; if (file) importJson(file); event.target.value=''; });
  window.addEventListener('hashchange', () => setView(location.hash === '#log' ? 'log' : location.hash === '#new' ? 'new' : 'dashboard', false));
  $('#case-number').value = nextNumber();
  showFormStep(0);
  updateStorageIndicator();
  renderDashboard();
  setView(location.hash === '#log' ? 'log' : location.hash === '#new' ? 'new' : 'dashboard', false);
})();
