(() => {
  'use strict';
  const STORE = { config: 'ruangsoal.config.v1', profile: 'ruangsoal.profile.v1', packs: 'ruangsoal.packs.v1', draft: 'ruangsoal.draft.v1', downloads: 'ruangsoal.downloads.v1' };
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const esc = (value = '') => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const publicConfig = window.RUANGSOAL_CONFIG || {};
  const config = { gasUrl: publicConfig.appsScriptUrl || '', oauthClientId: publicConfig.googleClientId || '' };
  let profile = read(STORE.profile, null);
  let packs = read(STORE.packs, []);
  let generatedPack = null;
  let schoolLogoData = '';
  let schoolLogoPromise = Promise.resolve('');
  let toastTimer;
  const bridgeRequests = new Map();

  function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000); }
  function onBridgeMessage(event) {
    let host; try { host = new URL(event.origin).hostname; } catch { return; }
    if (!(host === 'script.google.com' || host.endsWith('.googleusercontent.com'))) return;
    const message = event.data;
    if (!message || message.channel !== 'ruangsoal') return;
    const pending = bridgeRequests.get(message.id);
    if (pending) { clearTimeout(pending.timer); bridgeRequests.delete(message.id); pending.resolve(message.result); }
  }
  function bridgeUrl() {
    if (!config.gasUrl) return Promise.reject(new Error('Masukkan URL Google Apps Script di Pengaturan.'));
    let url;
    try { url = new URL(config.gasUrl); } catch { return Promise.reject(new Error('URL Google Apps Script tidak valid.')); }
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !url.pathname.includes('/macros/s/')) return Promise.reject(new Error('Gunakan URL deployment Apps Script resmi yang diawali https://script.google.com/macros/s/.'));
    return Promise.resolve(url.href);
  }
  async function callBridge(request) {
    const endpoint = await bridgeUrl();
    const frame = $('#gas-bridge');
    if (!frame) throw new Error('Frame koneksi Apps Script tidak ditemukan. Muat ulang aplikasi.');
    const frameName = 'ruangsoal-gas-bridge';
    frame.setAttribute('name', frameName);
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { bridgeRequests.delete(id); reject(new Error('Permintaan ke Apps Script melewati batas waktu.')); }, 120000);
      bridgeRequests.set(id, { resolve, reject, timer });
      window.addEventListener('message', onBridgeMessage);
      const form = document.createElement('form');
      form.method = 'post'; form.action = endpoint; form.setAttribute('target', frameName); form.hidden = true;
      [[ 'id', id ], [ 'origin', window.location.origin ], [ 'request', JSON.stringify(request) ]].forEach(([name, value]) => {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
      form.remove();
    });
  }
  async function callApi(action, data = {}) {
    const response = await callBridge({ action, token: profile?.idToken, ...data });
    if (!response?.ok) throw new Error(response?.error || 'Permintaan tidak berhasil.');
    return response;
  }
  function page(name) {
    if (['admin', 'pengaturan'].includes(name) && !profile?.guest && profile?.role !== 'admin') { toast('Menu ini hanya tersedia untuk admin.'); name = 'beranda'; }
    const pages = { beranda: 'dashboard-page', 'buat-soal': 'builder-page', 'bank-soal': 'bank-page', riwayat: 'history-page', pengaturan: 'settings-page', admin: 'admin-page', panduan: 'guide-page', naskah: 'review-page', hasil: 'results-page' };
    $$('.page-view').forEach(el => { el.hidden = true; });
    const target = $('#' + (pages[name] || pages.beranda)); if (target) target.hidden = false;
    $$('.nav-item,.mobile-nav button').forEach(el => el.classList.toggle('active', el.dataset.page === name));
    const labels = { beranda: ['Beranda', '/ Ringkasan'], 'buat-soal': ['Buat soal', '/ Rancang paket'], 'bank-soal': ['Bank soal', '/ Koleksi'], riwayat: ['Riwayat', '/ Aktivitas'], pengaturan: ['Pengaturan', '/ Preferensi'], admin: ['Admin', '/ Kelola pengguna'], panduan: ['Panduan', '/ Bantuan'], naskah: ['Buat soal', '/ Atur naskah'], hasil: ['Buat soal', '/ Pratinjau'] };
    const label = labels[name] || labels.beranda; $('#crumb-parent').textContent = label[0]; $('#crumb-current').textContent = label[1];
    $('.sidebar').classList.remove('open'); window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'bank-soal') { renderPacks('bank-list', packs); if (!profile?.guest) refreshPacks().then(() => renderPacks('bank-list', packs)).catch(error => toast(error.message)); }
    if (name === 'riwayat') { renderPacks('history-list', packs); if (!profile?.guest) refreshPacks().then(() => renderPacks('history-list', packs)).catch(error => toast(error.message)); }
    if (name === 'admin') loadAdminUsers();
    if (name === 'pengaturan') showConfig();
  }
  function showSignedIn() {
    $('#login-screen').hidden = true; $('#app-shell').hidden = false;
    $('#user-name').textContent = profile?.name || 'Guru'; $('#user-avatar').textContent = (profile?.name || 'G').trim().charAt(0).toUpperCase();
    $('#account-email').textContent = profile?.email || 'Mode pratinjau';
    $('#welcome-name').textContent = profile?.name ? ', ' + profile.name.split(' ')[0] : ', Guru';
    $$('.admin-only').forEach(item => { const guestSettings = profile?.guest && item.dataset.page === 'pengaturan'; item.hidden = !(profile?.role === 'admin' || guestSettings); });
    $('#account-status').textContent = `Masuk sebagai ${profile?.email || 'mode pratinjau'} · ${profile?.role || 'demo'}.`;
    updateDashboard(); applyOAuthConfig();
  }
  function showLogin() { $('#account-menu').hidden = true; $('#account-menu-toggle').setAttribute('aria-expanded', 'false'); $('#app-shell').hidden = true; $('#login-screen').hidden = false; applyOAuthConfig(); }
  function setLoginLoading(active, message) {
    $('#login-loading').hidden = !active;
    if (message) $('#login-loading').querySelector('b').textContent = message;
  }
  function applyOAuthConfig() {
    const hint = $('#login-hint');
    if (!config.oauthClientId) { hint.textContent = 'Login Google aktif setelah admin mengisi Client ID di config.js.'; return; }
    hint.textContent = 'Gunakan akun Google untuk masuk.';
    let attempts = 0;
    const wait = () => {
      if (!window.google?.accounts?.id) { if (++attempts < 40) setTimeout(wait, 250); else hint.textContent = 'Layanan login Google belum termuat. Periksa koneksi internet dan muat ulang.'; return; }
      window.google.accounts.id.initialize({ client_id: config.oauthClientId, callback: onGoogleCredential, auto_select: false });
      $('#google-button').replaceChildren();
      window.google.accounts.id.renderButton($('#google-button'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 350 });
    };
    wait();
  }
  async function onGoogleCredential(response) {
    setLoginLoading(true, 'Menyiapkan ruang kerja Anda');
    $('#login-hint').textContent = 'Sedang memverifikasi akun Google dan memuat data Anda…';
    try {
      const payload = JSON.parse(atob(response.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      const aud = payload.aud;
      if (aud !== config.oauthClientId || !payload.email_verified) throw new Error('Akun Google belum dapat diverifikasi.');
      if (!config.gasUrl) throw new Error('Admin perlu mengisi config.js dengan URL Apps Script terlebih dahulu.');
      profile = { name: payload.name || payload.email, email: payload.email, picture: payload.picture || '', idToken: response.credential };
      const session = await callApi('me');
      profile = { ...profile, ...session.user, idToken: response.credential };
      await refreshPacks(); write(STORE.profile, profile); $('#question-form').reset(); restoreDraft(); showSignedIn(); page('beranda'); toast('Berhasil masuk.');
    } catch (err) {
      profile = null;
      const message = err && err.message ? err.message : 'Login gagal. Coba muat ulang halaman.';
      $('#login-hint').textContent = 'Login belum berhasil: ' + message;
      toast(message);
    } finally { setLoginLoading(false); }
  }
  async function refreshPacks() {
    if (profile?.guest) { packs = read(STORE.packs, []); return; }
    const response = await callApi('listPacks'); packs = response.packs || []; updateDashboard();
  }
  async function resumeSession() {
    setLoginLoading(true, 'Memulihkan sesi Anda');
    try {
      const session = await callApi('me'); profile = { ...profile, ...session.user };
      await refreshPacks(); write(STORE.profile, profile); showSignedIn();
    } catch (error) { profile = null; packs = []; localStorage.removeItem(STORE.profile); setLoginLoading(false); showLogin(); toast(error.message); }
    finally { setLoginLoading(false); }
  }
  async function loadAdminUsers() {
    const holder = $('#user-list'); holder.textContent = 'Memuat daftar…';
    try {
      const response = await callApi('listUsers');
      if (!response.users.length) { holder.textContent = 'Belum ada pengguna.'; return; }
      holder.innerHTML = `<table class="users-table"><thead><tr><th>Nama</th><th>Email</th><th>Peran</th><th>Status</th></tr></thead><tbody>${response.users.map(user => `<tr><td>${esc(user.name)}</td><td>${esc(user.email)}</td><td><span class="role-pill">${user.role === 'admin' ? 'Admin' : 'Pengguna'}</span></td><td>${user.status === 'active' ? 'Aktif' : 'Nonaktif'}</td></tr>`).join('')}</tbody></table>`;
    } catch (error) { holder.textContent = error.message; }
  }
  function parseCsv(text, defaultRole = 'user') {
    text = text.replace(/^\uFEFF/, '').trim();
    let delimiter = ';';
    const firstLine = text.split(/\r?\n/, 1)[0];
    const separatorHint = firstLine.match(/^sep=(.)$/i);
    if (separatorHint) { delimiter = separatorHint[1]; text = text.slice(firstLine.length).replace(/^\r?\n/, ''); }
    else {
      const counts = [',', ';', '\t'].map(char => { let quoted = false, count = 0; for (const c of firstLine) { if (c === '"') quoted = !quoted; else if (c === char && !quoted) count++; } return { char, count }; }).sort((a, b) => b.count - a.count);
      if (counts[0].count) delimiter = counts[0].char;
    }
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
      else cell += char;
    }
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
    const headings = (rows[0] || []).map(normalize);
    const findColumn = names => headings.findIndex(value => names.includes(value));
    const nameColumn = findColumn(['nama', 'namalengkap', 'name', 'fullname']);
    const emailColumn = findColumn(['email', 'emailgoogle', 'alamatemail']);
    const roleColumn = findColumn(['peran', 'role', 'hakakses', 'jenisakun']);
    const hasHeader = nameColumn >= 0 || emailColumn >= 0 || roleColumn >= 0;
    if (hasHeader) rows.shift();
    const nameIndex = hasHeader ? nameColumn : 0;
    const emailIndex = hasHeader ? emailColumn : 1;
    const roleIndex = hasHeader ? roleColumn : 2;
    return rows.filter(cols => cols.some(Boolean)).map(cols => {
      const roleValue = String(roleIndex >= 0 ? cols[roleIndex] || '' : '').trim().toLowerCase();
      const role = ['admin', 'administrator'].includes(roleValue) ? 'admin' : ['pengguna', 'user', 'guru'].includes(roleValue) ? 'user' : defaultRole;
      return { name: nameIndex >= 0 ? cols[nameIndex] || '' : '', email: emailIndex >= 0 ? cols[emailIndex] || '' : '', role };
    });
  }
  function downloadUserTemplate() {
    const csv = '\uFEFFsep=;\r\nNama;Email;Peran\r\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'format-impor-pengguna.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  function updateDashboard() {
    const total = packs.reduce((sum, pack) => sum + (pack.questions?.length || pack.total || 0), 0);
    const downloadsKey = `${STORE.downloads}.${profile?.email || 'preview'}`;
    $('#stat-questions').textContent = total; $('#stat-packs').textContent = packs.length; $('#stat-downloads').textContent = read(downloadsKey, 0);
    const recent = $('#recent-list');
    if (!packs.length) { recent.className = 'empty-state'; recent.textContent = 'Belum ada paket soal. Paket yang dibuat akan muncul di sini.'; return; }
    recent.className = '';
    recent.innerHTML = packs.slice(0, 3).map(p => `<div class="pack-card"><div><h3>${esc(p.title)}</h3><p>${esc(p.subject)} · ${esc(p.grade)} · ${p.total || p.questions?.length || 0} soal</p></div><button class="text-button" data-open-pack="${esc(p.id)}">Buka →</button></div>`).join('');
    $$('[data-open-pack]', recent).forEach(btn => btn.addEventListener('click', () => openPack(btn.dataset.openPack)));
  }
  function renderPacks(id, list) {
    const holder = $('#' + id);
    if (!list.length) { holder.innerHTML = '<article class="panel empty-state">Belum ada paket soal tersimpan.</article>'; return; }
    holder.innerHTML = list.map(p => `<article class="pack-card"><div><h3>${esc(p.title)}</h3><p>${esc(p.subject)} · ${esc(p.grade)} · ${p.total || p.questions?.length || 0} soal</p></div><div class="pack-actions"><button data-open-pack="${esc(p.id)}">Buka</button><button data-delete-pack="${esc(p.id)}">Hapus</button></div></article>`).join('');
    $$('[data-open-pack]', holder).forEach(btn => btn.addEventListener('click', () => openPack(btn.dataset.openPack)));
    $$('[data-delete-pack]', holder).forEach(btn => btn.addEventListener('click', async () => {
      try {
        if (profile?.guest) { packs = packs.filter(p => p.id !== btn.dataset.deletePack); write(STORE.packs, packs); }
        else { await callApi('deletePack', { id: btn.dataset.deletePack }); packs = packs.filter(p => p.id !== btn.dataset.deletePack); }
        renderPacks(id, packs); updateDashboard(); toast('Paket dihapus.');
      } catch (error) { toast(error.message); }
    }));
  }
  function openPack(id) { const found = packs.find(p => p.id === id); if (found) { generatedPack = found; renderResult(found); page('hasil'); } }
  function formData() {
    const selectedTypes = $$('.type-row', $('#question-types')).map(row => ({ type: $('input[type=checkbox]', row).dataset.type, count: Math.max(0, Number($('input[type=number]', row).value) || 0), checked: $('input[type=checkbox]', row).checked })).filter(x => x.checked && x.count > 0);
    const total = selectedTypes.reduce((sum, item) => sum + item.count, 0);
    return { subject: $('#subject').value.trim(), grade: $('#grade').value.trim(), objective: $('#objective').value.trim(), material: $('#material').value.trim(), difficulty: $('input[name=difficulty]:checked')?.value || 'Campuran', bloom: $$('input[name=bloom]:checked').map(x => x.value), types: selectedTypes, total, images: $('input[name=images]:checked')?.value === 'relevant' };
  }
  function updateTotal() {
    const total = $$('.type-row', $('#question-types')).reduce((sum, row) => sum + ($('input[type=checkbox]', row).checked ? Math.max(0, Number($('input[type=number]', row).value) || 0) : 0), 0);
    $('#total-count').textContent = `${total} soal`;
    const checkedTypes = $$('.type-row', $('#question-types')).filter(row => $('input[type=checkbox]', row).checked);
    checkedTypes.forEach(row => { $('input[type=number]', row).required = true; });
    saveDraft();
  }
  function draftKey() { return `${STORE.draft}.${profile?.email || 'preview'}`; }
  function saveDraft() {
    const draft = { subject: $('#subject').value, grade: $('#grade').value, objective: $('#objective').value, material: $('#material').value,
      difficulty: $('input[name=difficulty]:checked')?.value, bloom: $$('input[name=bloom]:checked').map(x => x.value), images: $('input[name=images]:checked')?.value,
      types: $$('.type-row', $('#question-types')).map(row => ({ type: $('input[type=checkbox]', row).dataset.type, checked: $('input[type=checkbox]', row).checked, count: $('input[type=number]', row).value })) };
    write(draftKey(), draft);
  }
  function restoreDraft() {
    const draft = read(draftKey(), null); if (!draft) return;
    ['subject', 'grade', 'objective', 'material'].forEach(id => { if (draft[id]) $('#' + id).value = draft[id]; });
    if (draft.difficulty) { const radio = $(`input[name="difficulty"][value="${CSS.escape(draft.difficulty)}"]`); if (radio) radio.checked = true; }
    const blooms = Array.isArray(draft.bloom) ? draft.bloom : draft.bloom ? [draft.bloom] : [];
    $$('input[name="bloom"]').forEach(box => { box.checked = blooms.includes(box.value); });
    if (draft.images) { const imageRadio = $(`input[name="images"][value="${CSS.escape(draft.images)}"]`); if (imageRadio) imageRadio.checked = true; }
    (draft.types || []).forEach(item => { const row = $$('.type-row', $('#question-types')).find(x => $('input[type=checkbox]', x).dataset.type === item.type); if (row) { $('input[type=checkbox]', row).checked = !!item.checked; $('input[type=number]', row).value = item.count ?? 0; } });
    updateTotal();
  }
  function paperOptions() {
    const specificInstructions = {};
    $$('[data-specific-instruction]').forEach(input => { specificInstructions[input.dataset.specificInstruction] = input.value.trim(); });
    return { government: $('#government-name')?.value.trim() || '', department: $('#department-name')?.value.trim() || '', school: $('#school-name')?.value.trim() || '', address: $('#school-address')?.value.trim() || '', contact: $('#school-contact')?.value.trim() || '', logo: schoolLogoData, year: $('#school-year')?.value.trim() || '', title: $('#exam-title')?.value.trim() || 'Asesmen', semester: $('#semester')?.value || '', date: $('#exam-date')?.value.trim() || '', duration: $('#duration')?.value.trim() || '', instructions: $('#instructions')?.value.trim() || 'Bacalah setiap soal dengan teliti.', specificInstructions, includeKey: $('#include-key').checked, includeBlueprint: $('#include-blueprint').checked };
  }
  function makePromptData() { return { ...formData(), paper: paperOptions() }; }
  function defaultSpecificInstruction(type) {
    if (type.startsWith('Pilihan ganda')) return 'Pilihlah satu jawaban yang paling tepat.';
    if (type === 'Pilihan jamak') return 'Pilih semua jawaban yang benar.';
    if (type === 'Isian singkat') return 'Isilah jawaban dengan singkat dan tepat.';
    if (type === 'Uraian') return 'Jawablah pertanyaan dengan jelas dan sistematis.';
    if (type === 'Benar / salah') return 'Tuliskan Benar atau Salah untuk setiap pernyataan.';
    return 'Kerjakan soal berikut dengan teliti.';
  }
  function sectionType(type) { return type.startsWith('Pilihan ganda') ? 'Pilihan ganda' : type; }
  function renderSpecificInstructions(types) {
    const holder = $('#specific-instructions');
    const previous = Object.fromEntries($$('[data-specific-instruction]', holder).map(input => [input.dataset.specificInstruction, input.value]));
    const sections = [...new Set(types.map(group => sectionType(group.type)))];
    holder.innerHTML = sections.map((type, index) => `<label class="field"><span>Petunjuk khusus ${String.fromCharCode(65 + index)} · ${esc(type)}</span><textarea rows="2" data-specific-instruction="${esc(type)}">${esc(previous[type] ?? defaultSpecificInstruction(type))}</textarea></label>`).join('');
  }
  function compressSchoolLogo(file) {
    if (!file) return Promise.resolve('');
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) return Promise.reject(new Error('Logo harus berupa PNG, JPG, atau WebP maksimal 5 MB.'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Logo tidak dapat dibaca.'));
      reader.onload = () => {
        const image = new Image(); image.onerror = () => reject(new Error('File logo tidak valid.'));
        image.onload = () => { const scale = Math.min(1, 240 / image.width, 160 / image.height); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', .78)); };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function fallbackQuestions(data) {
    const result = [];
    data.types.forEach(group => { for (let i = 0; i < group.count; i++) result.push({ number: result.length + 1, type: group.type, question: `[Contoh pratinjau ${group.type.toLowerCase()} tentang ${data.material}]`, options: group.type.startsWith('Pilihan ganda') ? ['Pilihan jawaban A', 'Pilihan jawaban B', 'Pilihan jawaban C', ...(group.type.includes('D') ? ['Pilihan jawaban D'] : []), ...(group.type.includes('E') ? ['Pilihan jawaban E'] : [])] : [], answer: '', explanation: '', bloom: data.bloom[0] || '', indicator: '' }); });
    return result;
  }
  async function generate(data) {
    if (!config.gasUrl || profile?.guest) { return { id: crypto.randomUUID(), title: `${data.subject} · ${data.material}`, ...data, paper: data.paper, questions: fallbackQuestions(data), demo: true, createdAt: new Date().toISOString() }; }
    const result = await callBridge({ action: 'generate', token: profile?.idToken, payload: data }); if (!result?.ok) throw new Error(result?.error || 'Pembuatan soal gagal.');
    return { id: crypto.randomUUID(), ...data, paper: data.paper, questions: result.questions || [], createdAt: new Date().toISOString() };
  }
  function examHeader(pack, paper, subtitle) {
    const logo = paper.logo ? `<img class="school-logo" src="${esc(paper.logo)}" alt="Logo sekolah">` : '<span class="school-logo-placeholder" aria-hidden="true"></span>';
    const identity = [paper.government, paper.department, paper.school].filter(Boolean).map((line, index) => `<div class="institution-line ${index === 2 ? 'school-name' : ''}">${esc(line)}</div>`).join('');
    return `<header class="exam-header"><div class="institution-heading">${logo}<div class="institution-copy">${identity}<div class="institution-contact">${esc(paper.address || '')}${paper.address && paper.contact ? ' · ' : ''}${esc(paper.contact || '')}</div></div><span class="school-logo-placeholder right" aria-hidden="true"></span></div><div class="header-rule"></div><h1>${esc(paper.title || 'Asesmen')}</h1><div class="exam-semester">${esc(paper.semester || '')}${paper.year ? ' · Tahun Ajaran ' + esc(paper.year) : ''}</div>${subtitle ? `<div class="sheet-subtitle">${esc(subtitle)}</div>` : ''}<div class="exam-facts"><div><span>Mata Pelajaran</span><b>${esc(pack.subject || '—')}</b></div><div><span>Hari / Tanggal</span><b>${esc(paper.date || '____________________________')}</b></div><div><span>Kelas</span><b>${esc(pack.grade || '—')}</b></div><div><span>Alokasi Waktu</span><b>${esc(paper.duration || '________________')}</b></div></div></header>`;
  }
  function orderedQuestionGroups(pack, questions) {
    const order = (pack.types || []).map(group => sectionType(group.type));
    questions.forEach(q => { const type = sectionType(q.type || 'Soal'); if (!order.includes(type)) order.push(type); });
    return [...new Set(order)].map(type => ({ type, questions: questions.filter(q => sectionType(q.type || 'Soal') === type) })).filter(group => group.questions.length);
  }
  function instructionList(value) {
    const items = String(value || '').split(/\r?\n/).map(item => item.replace(/^\s*\d+[.)]?\s*/, '').trim()).filter(Boolean);
    return items.length ? `<ol class="general-instructions">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ol>` : '';
  }
  function questionPaperHtml(pack) {
    const paper = pack.paper || {};
    const questions = pack.questions || [];
    const groups = orderedQuestionGroups(pack, questions);
    let html = `<section class="paper-page question-page">${examHeader(pack, paper)}<div class="general-instruction-block"><b>Petunjuk Umum</b>${instructionList(paper.instructions)}</div>`;
    for (const [groupIndex, group] of groups.entries()) {
      const firstVariant = pack.types?.find(item => sectionType(item.type) === group.type)?.type;
      const specific = paper.specificInstructions?.[group.type] || paper.specificInstructions?.[firstVariant] || defaultSpecificInstruction(group.type);
      html += `<section class="question-group"><h2><span>${String.fromCharCode(65 + groupIndex)}.</span> ${esc(specific)}</h2><ol class="question-list" start="${group.questions[0].number || questions.indexOf(group.questions[0]) + 1}">`;
      group.questions.forEach(q => {
        const imageSrc = q.imageData || q.imageUrl || (q.imageSvg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(q.imageSvg) : '');
        const safeImage = /^data:image\/(png|jpeg|webp|svg\+xml);/i.test(imageSrc) || /^https:\/\//i.test(imageSrc) ? imageSrc : '';
        html += `<li class="paper-question" value="${q.number || questions.indexOf(q) + 1}"><div>${esc(q.question || '')}</div>${q.options?.length ? `<ol class="answer-options" type="a">${q.options.map(option => `<li>${esc(option)}</li>`).join('')}</ol>` : ''}${safeImage ? `<img class="question-illustration" src="${esc(safeImage)}" alt="Ilustrasi soal">` : ''}</li>`;
      });
      html += '</ol></section>';
    }
    html += '</section>';
    if (paper.includeBlueprint) html += `<section class="paper-page blueprint-page">${examHeader(pack, paper, 'Kisi-kisi Soal')}<table class="blueprint-table"><thead><tr><th>No.</th><th>Tujuan Pembelajaran</th><th>Materi</th><th>Indikator Soal</th><th>Level Kognitif</th><th>Bentuk</th></tr></thead><tbody>${questions.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(pack.objective || '')}</td><td>${esc(pack.material || '')}</td><td>${esc(q.indicator || q.question || '')}</td><td>${esc(q.bloom || pack.bloom?.[0] || '')}</td><td>${esc(q.type || '')}</td></tr>`).join('')}</tbody></table></section>`;
    if (paper.includeKey) {
      const multipleChoice = questions.map((q, i) => ({ q, number: q.number || i + 1 })).filter(item => String(item.q.type || '').startsWith('Pilihan ganda'));
      const otherAnswers = questions.map((q, i) => ({ q, number: q.number || i + 1 })).filter(item => !String(item.q.type || '').startsWith('Pilihan ganda'));
      const keyRows = [];
      for (let i = 0; i < multipleChoice.length; i += 10) {
        const left = multipleChoice.slice(i, i + 5), right = multipleChoice.slice(i + 5, i + 10);
        for (let row = 0; row < 5; row++) {
          const cell = item => { if (!item) return '<td></td><td></td>'; const match = String(item.q.answer || '').trim().match(/^[a-e](?=$|[\s.)-])/i); return `<td class="key-number">${item.number}</td><td class="key-answer">${esc(match ? match[0].toLowerCase() : '—')}</td>`; };
          keyRows.push(`<tr>${cell(left[row])}${cell(right[row])}</tr>`);
        }
      }
      const otherList = otherAnswers.length ? `<h2 class="other-key-title">Kunci jawaban jenis soal lainnya</h2><ol class="other-key-list">${otherAnswers.map(({ q, number }) => `<li value="${number}"><b>${esc(q.type || 'Soal')}:</b> ${esc(q.answer || '—')}</li>`).join('')}</ol>` : '';
      html += `<section class="paper-page answer-page">${examHeader(pack, paper, 'Kunci Jawaban')}${multipleChoice.length ? `<table class="answer-key-table"><thead><tr><th>No.</th><th>Kunci</th><th>No.</th><th>Kunci</th></tr></thead><tbody>${keyRows.join('')}</tbody></table>` : ''}${otherList}</section>`;
    }
    return html;
  }
  function renderResult(pack) {
    $('#result-content').innerHTML = questionPaperHtml(pack);
    $('#result-toolbar').hidden = false;
  }
  async function wordDocument(pack) {
    const paper = pack.paper || {}, questions = pack.questions || [], groups = orderedQuestionGroups(pack, questions);
    const style = `@page{size:21.5cm 33cm;margin:1.6cm 1.5cm}body,div,p,table,td,th,li,ol,h1,h2{font-family:Arial,sans-serif;color:#111}body{font-size:12pt;line-height:1.45;margin:0}table{border-collapse:collapse}.exam-header{margin-bottom:16pt}.institution-heading{width:100%;border-bottom:3px double #111}.institution-heading td{vertical-align:middle;padding:0 0 8pt}.institution-logo{width:74px;height:70px}.institution-copy{text-align:center;font-weight:bold}.institution-line{font-size:12pt}.institution-line.school-name{font-size:14pt;text-transform:uppercase}.institution-contact{font-size:10pt;font-weight:normal;margin-top:3pt}.exam-title{text-align:center;font-size:16pt;font-weight:bold;text-transform:uppercase;margin:12pt 0 2pt}.exam-semester{text-align:center;font-weight:bold;margin-bottom:12pt}.sheet-subtitle{text-align:center;font-weight:bold;font-size:12pt;margin:3pt 0 10pt}.exam-facts{width:100%;margin:10pt 0 14pt}.exam-facts td{padding:3pt 10pt 3pt 0;vertical-align:top;font-size:12pt}.exam-facts td:nth-child(1),.exam-facts td:nth-child(3){width:19%}.exam-facts td:nth-child(2),.exam-facts td:nth-child(4){width:31%}.exam-facts .fact-label{color:#333}.exam-facts .fact-value{font-weight:bold}.general-instruction-block{margin:12pt 0}.general-instruction-block b{display:block;font-size:12pt}.general-instructions{margin:3pt 0;padding-left:24pt}.question-group{margin:12pt 0}.question-group h2{font-size:12pt;font-weight:bold;margin:0 0 7pt}.question-list{padding-left:28pt;margin:0}.paper-question{font-size:12pt;text-align:justify;padding-left:3pt;margin:0 0 12pt;page-break-inside:avoid}.answer-options{font-size:12pt;text-align:justify;list-style-type:lower-alpha;padding-left:24pt;margin:4pt 0 0}.answer-options li{padding:1pt 2pt;text-align:justify}.question-illustration{display:block;width:70%;max-height:230pt;margin:8pt auto}.blueprint-table,.answer-key-table{width:100%;font-size:10pt;table-layout:fixed}.blueprint-table th,.blueprint-table td,.answer-key-table th,.answer-key-table td{border:1px solid #555;padding:5pt;vertical-align:top;font-size:10pt}.blueprint-table th,.answer-key-table th{background:#eee;text-align:center}.answer-key-table{font-size:11pt;margin-top:12pt}.answer-key-table td{text-align:center;height:23pt}.answer-key-table .key-number,.answer-key-table .key-answer{width:25%;font-weight:bold}.other-key-title{font-size:12pt;font-weight:bold;margin:18pt 0 6pt}.other-key-list{padding-left:25pt}.other-key-list li{font-size:12pt;padding:3pt 0;text-align:justify}`;
    const page = (content, first = false) => `${first ? '' : '<br clear="all" style="page-break-before:always;mso-special-character:line-break">'}${content}`;
    const header = subtitle => {
      const identity = [paper.government, paper.department, paper.school].filter(Boolean).map((line, index, arr) => `<div class="institution-line${line === paper.school ? ' school-name' : ''}">${esc(line)}</div>`).join('');
      const logo = paper.logo ? `<img class="institution-logo" src="${esc(paper.logo)}" alt="Logo sekolah">` : '';
      return `<div class="exam-header"><table class="institution-heading"><tr><td style="width:82px;text-align:center">${logo}</td><td class="institution-copy">${identity}<div class="institution-contact">${esc([paper.address, paper.contact].filter(Boolean).join(' · '))}</div></td><td style="width:82px"></td></tr></table><div class="exam-title">${esc(paper.title || 'Asesmen')}</div><div class="exam-semester">${esc(paper.semester || '')}${paper.year ? ' · Tahun Ajaran ' + esc(paper.year) : ''}</div>${subtitle ? `<div class="sheet-subtitle">${esc(subtitle)}</div>` : ''}<table class="exam-facts"><tr><td class="fact-label">Mata Pelajaran</td><td class="fact-value">${esc(pack.subject || '—')}</td><td class="fact-label">Hari / Tanggal</td><td class="fact-value">${esc(paper.date || '________________________')}</td></tr><tr><td class="fact-label">Kelas</td><td class="fact-value">${esc(pack.grade || '—')}</td><td class="fact-label">Alokasi Waktu</td><td class="fact-value">${esc(paper.duration || '________________')}</td></tr></table></div>`;
    };
    let html = '';
    let questionBody = '';
    for (const [groupIndex, group] of groups.entries()) {
      const firstVariant = pack.types?.find(item => sectionType(item.type) === group.type)?.type;
      const specific = paper.specificInstructions?.[group.type] || paper.specificInstructions?.[firstVariant] || defaultSpecificInstruction(group.type);
      questionBody += `<div class="question-group"><h2>${String.fromCharCode(65 + groupIndex)}. ${esc(specific)}</h2><ol class="question-list" start="${group.questions[0].number || questions.indexOf(group.questions[0]) + 1}">`;
      for (const q of group.questions) {
        let rawImage = q.imageData || q.imageUrl || '';
        if (q.imageSvg) {
          try {
            const svgBlob = new Blob([q.imageSvg], { type: 'image/svg+xml;charset=utf-8' }), svgUrl = URL.createObjectURL(svgBlob);
            rawImage = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => { try { const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth || 900; canvas.height = image.naturalHeight || 520; canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/png')); } catch (error) { reject(error); } finally { URL.revokeObjectURL(svgUrl); } }; image.onerror = () => { URL.revokeObjectURL(svgUrl); reject(new Error('Ilustrasi tidak dapat disiapkan untuk Word.')); }; image.src = svgUrl; });
          } catch (error) { rawImage = ''; }
        }
        const img = /^data:image\/(png|jpeg|webp|svg\+xml);/i.test(rawImage) || /^https:\/\//i.test(rawImage) ? `<img class="question-illustration" src="${esc(rawImage)}" alt="Ilustrasi soal">` : '';
        questionBody += `<li class="paper-question" value="${q.number || questions.indexOf(q) + 1}">${esc(q.question || '')}${q.options?.length ? `<ol class="answer-options" type="a">${q.options.map(option => `<li>${esc(option)}</li>`).join('')}</ol>` : ''}${img}</li>`;
      }
      questionBody += '</ol></div>';
    }
    html = page(`${header('')}<div class="general-instruction-block"><b>Petunjuk Umum</b>${instructionList(paper.instructions)}</div>${questionBody}`, true);
    if (paper.includeBlueprint) html += page(`${header('Kisi-kisi Soal')}<table class="blueprint-table"><thead><tr><th>No.</th><th>Tujuan Pembelajaran</th><th>Materi</th><th>Indikator Soal</th><th>Level Kognitif</th><th>Bentuk</th></tr></thead><tbody>${questions.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(pack.objective || '')}</td><td>${esc(pack.material || '')}</td><td>${esc(q.indicator || q.question || '')}</td><td>${esc(q.bloom || pack.bloom?.[0] || '')}</td><td>${esc(q.type || '')}</td></tr>`).join('')}</tbody></table>`);
    if (paper.includeKey) {
      const mc = questions.map((q, i) => ({ q, number: q.number || i + 1 })).filter(x => String(x.q.type || '').startsWith('Pilihan ganda'));
      const other = questions.map((q, i) => ({ q, number: q.number || i + 1 })).filter(x => !String(x.q.type || '').startsWith('Pilihan ganda'));
      let rows = '';
      for (let i = 0; i < mc.length; i += 10) { const left = mc.slice(i, i + 5), right = mc.slice(i + 5, i + 10); for (let j = 0; j < 5; j++) { const cell = x => { if (!x) return '<td></td><td></td>'; const m = String(x.q.answer || '').trim().match(/^[a-e](?=$|[\s.)-])/i); return `<td class="key-number">${x.number}</td><td class="key-answer">${esc(m ? m[0].toLowerCase() : '—')}</td>`; }; rows += `<tr>${cell(left[j])}${cell(right[j])}</tr>`; } }
      html += page(`${header('Kunci Jawaban')}${mc.length ? `<table class="answer-key-table"><thead><tr><th>No.</th><th>Kunci</th><th>No.</th><th>Kunci</th></tr></thead><tbody>${rows}</tbody></table>` : ''}${other.length ? `<h2 class="other-key-title">Kunci jawaban jenis soal lainnya</h2><ol class="other-key-list">${other.map(x => `<li value="${x.number}"><b>${esc(x.q.type || 'Soal')}:</b> ${esc(x.q.answer || '—')}</li>`).join('')}</ol>` : ''}`);
    }
    return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>${html}</body></html>`;
  }
  async function downloadWord() {
    const button = $('#download-word'), label = button.innerHTML;
    button.disabled = true; button.innerHTML = '<span class="button-spinner"></span> Menyiapkan Word…';
    await new Promise(resolve => requestAnimationFrame(resolve));
    try {
      const documentHtml = await wordDocument(generatedPack);
      const blob = new Blob(['\ufeff', documentHtml], { type: 'application/msword' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${safeFile(generatedPack.title)}.doc`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); countDownload();
    } finally { button.disabled = false; button.innerHTML = label; }
  }
  function safeFile(name = 'paket-soal') { return name.normalize('NFKD').replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'paket-soal'; }
  function countDownload() { const key = `${STORE.downloads}.${profile?.email || 'preview'}`; write(key, read(key, 0) + 1); updateDashboard(); }
  async function savePack() {
    if (!generatedPack) return;
    const button = $('#save-pack'), label = button.innerHTML;
    button.disabled = true; button.innerHTML = '<span class="button-spinner"></span> Menyimpan…';
    await new Promise(resolve => requestAnimationFrame(resolve));
    try {
      if (profile?.guest) { const index = packs.findIndex(p => p.id === generatedPack.id); if (index >= 0) packs[index] = generatedPack; else packs.unshift(generatedPack); write(STORE.packs, packs); toast('Paket tersimpan di perangkat ini saja.'); }
      else { const response = await callApi('savePack', { pack: generatedPack }); packs = [response.pack, ...packs.filter(p => p.id !== response.pack.id)]; toast('Paket tersimpan di akun Anda.'); }
      updateDashboard();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; button.innerHTML = label; }
  }
  function showConfig() {
    $('#gas-url').value = config.gasUrl || '';
    $('#oauth-client').value = config.oauthClientId || '';
    $('#settings-status').textContent = config.gasUrl && config.oauthClientId ? 'Koneksi sudah diisi dari config.js.' : 'Belum dikonfigurasi. Admin perlu mengisi config.js lalu menerbitkan ulang situs.';
  }
  function init() {
    showConfig();
    $('#preview-button').hidden = Boolean(config.gasUrl && config.oauthClientId);
    if (profile?.guest) { showSignedIn(); }
    else if (profile?.idToken) resumeSession();
    else { profile = null; packs = []; showLogin(); }
    restoreDraft(); updateTotal();
    document.addEventListener('click', event => { const link = event.target.closest('[data-page]'); if (link) { event.preventDefault(); page(link.dataset.page); } });
    $('#preview-button').addEventListener('click', () => { profile = { name: 'Guru Demo', email: '', idToken: '', guest: true }; showSignedIn(); page('beranda'); toast('Mode pratinjau. Paket tersimpan di perangkat ini saja.'); });
    $('#menu-toggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
    $('#account-menu-toggle').addEventListener('click', event => { event.stopPropagation(); const menu = $('#account-menu'); menu.hidden = !menu.hidden; $('#account-menu-toggle').setAttribute('aria-expanded', String(!menu.hidden)); });
    document.addEventListener('click', event => { if (!event.target.closest('.profile')) { $('#account-menu').hidden = true; $('#account-menu-toggle').setAttribute('aria-expanded', 'false'); } });
    $('#signout-button').addEventListener('click', () => { profile = null; packs = []; generatedPack = null; $('#question-form').reset(); $('#result-content').replaceChildren(); $('#result-toolbar').hidden = true; page('beranda'); localStorage.removeItem(STORE.profile); showLogin(); });
    $('#question-form').addEventListener('input', event => { if (event.target.matches('.type-row input[type=number],.type-row input[type=checkbox]')) updateTotal(); else saveDraft(); });
    $('#question-form').addEventListener('change', () => { saveDraft(); updateTotal(); });
    $('#question-form').addEventListener('submit', event => { event.preventDefault(); const data = formData(); if (!$('#question-form').reportValidity()) return; if (!data.bloom.length) { toast('Pilih minimal satu level Taksonomi Bloom.'); return; } if (!data.total || !data.types.length) { toast('Pilih minimal satu jenis soal dan isi jumlahnya.'); return; } if (data.total > 100) { toast('Jumlah seluruh soal maksimal 100 dalam satu paket.'); return; } renderSpecificInstructions(data.types); if (!$('#instructions').value.trim()) $('#instructions').value = '1. Berdoalah sebelum mengerjakan soal.\n2. Bacalah setiap soal dengan teliti.\n3. Periksa kembali jawaban sebelum dikumpulkan.'; page('naskah'); });
    $('#school-logo').addEventListener('change', event => {
      const preview = $('#school-logo-preview');
      preview.hidden = true;
      schoolLogoPromise = compressSchoolLogo(event.target.files[0]).then(data => { schoolLogoData = data; preview.src = data; preview.hidden = !data; return data; }).catch(error => { schoolLogoData = ''; event.target.value = ''; preview.hidden = true; toast(error.message); return ''; });
    });
    $('#paper-form').addEventListener('submit', async event => {
      event.preventDefault(); await schoolLogoPromise; const data = makePromptData(); page('hasil');
      const attemptGeneration = async () => {
        $('#result-toolbar').hidden = true; $('#generation-status').hidden = false; $('#generation-status').className = 'notice is-info is-loading'; $('#generation-status').setAttribute('role', 'status'); $('#generation-status').textContent = 'Gemini sedang menyusun soal. Proses ini bisa memerlukan waktu hingga satu menit…'; $('#result-content').innerHTML = '';
        try {
          generatedPack = await generate(data); generatedPack.title = `${data.subject} · ${data.material}`;
          renderResult(generatedPack); $('#generation-status').hidden = generatedPack.demo ? false : true;
          if (generatedPack.demo) { $('#generation-status').className = 'notice is-info'; $('#generation-status').innerHTML = '<b>Mode pratinjau:</b> Contoh ini belum dibuat AI. Hubungkan URL Apps Script untuk mengaktifkan generator.'; }
        } catch (error) {
          $('#generation-status').hidden = false; $('#generation-status').className = 'notice is-error';
          $('#generation-status').innerHTML = `<div><b>Belum berhasil membuat soal.</b> ${esc(error.message || 'Terjadi kesalahan. Silakan coba lagi.')}<div class="retry-row"><button id="retry-generation" class="button secondary" type="button"><svg><use href="#i-refresh"/></svg>Coba lagi</button></div></div>`;
          $('#retry-generation').addEventListener('click', attemptGeneration, { once: true });
        }
      };
      await attemptGeneration();
    });
    $('#settings-page').addEventListener('click', event => { if (event.target.matches('[data-refresh-config]')) showConfig(); });
    $('#add-user-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('#add-user-submit'), status = $('#add-user-status');
      button.disabled = true; button.innerHTML = '<span class="button-spinner"></span> Menambahkan pengguna…'; status.textContent = 'Sedang menyimpan akun. Mohon tunggu agar tidak terjadi input ganda.';
      try { await callApi('addUser', { user: { name: $('#new-user-name').value.trim(), email: $('#new-user-email').value.trim(), role: $('#new-user-role').value } }); event.target.reset(); status.textContent = 'Pengguna berhasil ditambahkan.'; toast('Pengguna ditambahkan.'); loadAdminUsers(); }
      catch (error) { status.textContent = 'Belum berhasil menambahkan pengguna: ' + error.message; }
      finally { button.disabled = false; button.textContent = 'Tambah pengguna'; }
    });
    $('#import-users').addEventListener('click', async () => {
      const file = $('#user-csv').files[0]; if (!file) { $('#import-status').textContent = 'Pilih berkas CSV terlebih dahulu.'; return; }
      const button = $('#import-users'), status = $('#import-status'); button.disabled = true; button.innerHTML = '<span class="button-spinner"></span> Menyiapkan impor…'; status.textContent = 'Sedang membaca dan memeriksa berkas…';
      try {
        const users = parseCsv(await file.text(), $('#import-default-role').value);
        if (!users.length) throw new Error('Berkas belum berisi data pengguna.');
        status.textContent = `Sedang mengimpor ${users.length} baris pengguna. Mohon tunggu…`; button.innerHTML = '<span class="button-spinner"></span> Mengimpor pengguna…';
        const result = await callApi('importUsers', { users });
        status.textContent = `Impor selesai: ${result.imported.added} ditambahkan, ${result.imported.updated} diperbarui, ${result.imported.skipped} dilewati.`; loadAdminUsers();
      } catch (error) { status.textContent = 'Impor belum berhasil: ' + error.message; }
      finally { button.disabled = false; button.textContent = 'Impor pengguna'; }
    });
    $('#download-user-template').addEventListener('click', downloadUserTemplate);
    $('#refresh-users').addEventListener('click', loadAdminUsers);
    $('#save-pack').addEventListener('click', savePack); $('#download-word').addEventListener('click', downloadWord);
    $('#print-pdf').addEventListener('click', async event => { const button = event.currentTarget, label = button.innerHTML; button.disabled = true; button.innerHTML = '<span class="button-spinner"></span> Menyiapkan cetak…'; await new Promise(resolve => requestAnimationFrame(resolve)); countDownload(); window.print(); setTimeout(() => { button.disabled = false; button.innerHTML = label; }, 800); });
    $('#question-form').addEventListener('change', saveDraft);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
