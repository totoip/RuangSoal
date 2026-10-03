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
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
      else cell += char;
    }
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    if (rows[0]?.[0]?.toLowerCase() === 'email') rows.shift();
    return rows.map(cols => ({ email: cols[0] || '', name: cols[1] || (cols[0] || '').split('@')[0], role: (cols[2] || 'user').toLowerCase() === 'admin' ? 'admin' : 'user' })).filter(user => user.email);
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
    return { school: $('#school-name').value.trim() || 'Nama Sekolah', year: $('#school-year').value.trim(), title: $('#exam-title').value.trim() || 'Asesmen', semester: $('#semester').value, teacher: $('#teacher-name').value.trim(), duration: $('#duration').value.trim(), instructions: $('#instructions').value.trim() || 'Bacalah setiap soal dengan teliti.', includeKey: $('#include-key').checked, includeBlueprint: $('#include-blueprint').checked };
  }
  function makePromptData() { return { ...formData(), paper: paperOptions() }; }
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
  function renderResult(pack) {
    const paper = pack.paper || paperOptions();
    const content = $('#result-content');
    const questions = pack.questions || [];
    const header = (title) => `<h2>${esc(paper.school || 'Nama Sekolah')}</h2><div class="paper-meta">${esc(title || paper.title || 'Asesmen')}<br>${esc(pack.subject || '')} · ${esc(pack.grade || '')} ${paper.semester ? '· ' + esc(paper.semester) : ''} ${paper.year ? '· Tahun Ajaran ' + esc(paper.year) : ''}${paper.teacher ? '<br>Guru: ' + esc(paper.teacher) : ''}</div><hr>`;
    let html = `<section class="paper-page question-page">${header(paper.title)}<div class="paper-details"><span>Nama: ______________________________</span><span>Kelas: _____________________</span><span>Hari/Tanggal: ____________________</span><span>Waktu: ${esc(paper.duration || '__________')}</span></div><p><b>Petunjuk:</b> ${esc(paper.instructions || '')}</p>`;
    questions.forEach((q, index) => {
      html += `<div class="paper-question"><b>${index + 1}.</b> ${esc(q.question || '')}`;
      if (q.options?.length) html += `<ol class="answer-options" type="A">${q.options.map(option => `<li>${esc(option)}</li>`).join('')}</ol>`;
      else html += '<p>Jawaban: __________________________________________________</p>';
      if (q.imageDescription) html += `<p><i>[Ilustrasi: ${esc(q.imageDescription)}]</i></p>`;
      html += '</div>';
    });
    html += '</section>';
    if (paper.includeKey) html += `<section class="paper-page answer-page">${header('Kunci Jawaban')}<h3>Kunci Jawaban</h3><ol>${questions.map(q => `<li>${esc(q.answer || 'Perlu dilengkapi')} ${q.explanation ? '— ' + esc(q.explanation) : ''}</li>`).join('')}</ol></section>`;
    if (paper.includeBlueprint) html += `<section class="paper-page blueprint-page">${header('Kisi-kisi Soal')}<h3>Kisi-kisi Soal</h3><div class="blueprint-table-wrap"><table><thead><tr><th>No.</th><th>Tujuan Pembelajaran</th><th>Materi</th><th>Indikator Soal</th><th>Level Kognitif</th><th>Bentuk</th></tr></thead><tbody>${questions.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(pack.objective)}</td><td>${esc(pack.material)}</td><td>${esc(q.indicator || q.question || '')}</td><td>${esc(q.bloom || pack.bloom?.[0] || '')}</td><td>${esc(q.type || '')}</td></tr>`).join('')}</tbody></table></div></section>`;
    content.innerHTML = html; $('#result-toolbar').hidden = false;
  }
  function wordDocument(pack) {
    const paper = pack.paper || {};
    const questions = pack.questions || [];
    const header = title => `<h2>${esc(paper.school || 'Nama Sekolah')}</h2><p class="paper-meta">${esc(title)}<br>${esc(pack.subject || '')} · ${esc(pack.grade || '')} ${paper.semester ? '· ' + esc(paper.semester) : ''} ${paper.year ? '· Tahun Ajaran ' + esc(paper.year) : ''}${paper.teacher ? '<br>Guru: ' + esc(paper.teacher) : ''}</p><hr>`;
    const questionHtml = questions.map((q, i) => `<div class="q"><p><b>${i + 1}.</b> ${esc(q.question || '')}</p>${q.options?.length ? `<ol type="A">${q.options.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p>Jawaban: _________________________________</p>'}${q.imageDescription ? `<p><i>[Ilustrasi: ${esc(q.imageDescription)}]</i></p>` : ''}</div>`).join('');
    let pages = `<section class="paper-page">${header(paper.title || 'Asesmen')}<p>Nama: __________________________　Kelas: __________　Tanggal: __________</p><p>Waktu: ${esc(paper.duration || '________')}<br><b>Petunjuk:</b> ${esc(paper.instructions || '')}</p>${questionHtml}</section>`;
    if (paper.includeKey) pages += `<section class="paper-page">${header('Kunci Jawaban')}<h3>Kunci Jawaban</h3><ol>${questions.map(q => `<li>${esc(q.answer || 'Perlu dilengkapi')}${q.explanation ? ' — ' + esc(q.explanation) : ''}</li>`).join('')}</ol></section>`;
    if (paper.includeBlueprint) pages += `<section class="paper-page">${header('Kisi-kisi Soal')}<h3>Kisi-kisi Soal</h3><table><tr><th>No.</th><th>Tujuan Pembelajaran</th><th>Materi</th><th>Indikator</th><th>Level</th><th>Bentuk</th></tr>${questions.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(pack.objective)}</td><td>${esc(pack.material)}</td><td>${esc(q.indicator || q.question)}</td><td>${esc(q.bloom || '')}</td><td>${esc(q.type || '')}</td></tr>`).join('')}</table></section>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:11pt Arial;margin:0;color:#111}h1,h2{text-align:center}hr{border:0;border-top:3px double #000}table{border-collapse:collapse;width:100%;font-size:8pt;table-layout:fixed}td,th{border:1px solid #444;padding:5px;overflow-wrap:anywhere}li{margin:4px 0}.q{margin:13px 0;break-inside:avoid}.paper-page{break-after:page;page-break-after:always}.paper-page:last-child{break-after:auto;page-break-after:auto}.paper-meta{text-align:center}.paper-details{display:grid;grid-template-columns:1fr 1fr;gap:4px}</style></head><body>${pages}</body></html>`;
  }
  function downloadWord() {
    const blob = new Blob(['\ufeff', wordDocument(generatedPack)], { type: 'application/msword' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${safeFile(generatedPack.title)}.doc`; link.click(); URL.revokeObjectURL(link.href); countDownload();
  }
  function safeFile(name = 'paket-soal') { return name.normalize('NFKD').replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'paket-soal'; }
  function countDownload() { const key = `${STORE.downloads}.${profile?.email || 'preview'}`; write(key, read(key, 0) + 1); updateDashboard(); }
  async function savePack() {
    if (!generatedPack) return;
    try {
      if (profile?.guest) { const index = packs.findIndex(p => p.id === generatedPack.id); if (index >= 0) packs[index] = generatedPack; else packs.unshift(generatedPack); write(STORE.packs, packs); toast('Paket tersimpan di perangkat ini saja.'); }
      else { const response = await callApi('savePack', { pack: generatedPack }); packs = [response.pack, ...packs.filter(p => p.id !== response.pack.id)]; toast('Paket tersimpan di akun Anda.'); }
      updateDashboard();
    } catch (error) { toast(error.message); }
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
    $('#question-form').addEventListener('submit', event => { event.preventDefault(); const data = formData(); if (!$('#question-form').reportValidity()) return; if (!data.bloom.length) { toast('Pilih minimal satu level Taksonomi Bloom.'); return; } if (!data.total || !data.types.length) { toast('Pilih minimal satu jenis soal dan isi jumlahnya.'); return; } if (data.total > 100) { toast('Jumlah seluruh soal maksimal 100 dalam satu paket.'); return; } page('naskah'); });
    $('#paper-form').addEventListener('submit', async event => {
      event.preventDefault(); const data = makePromptData(); page('hasil');
      $('#result-toolbar').hidden = true; $('#generation-status').hidden = false; $('#generation-status').className = 'notice is-info is-loading'; $('#generation-status').setAttribute('role', 'status'); $('#generation-status').textContent = 'Gemini sedang menyusun soal. Proses ini bisa memerlukan waktu hingga satu menit…'; $('#result-content').innerHTML = '';
      try {
        generatedPack = await generate(data); generatedPack.title = `${data.subject} · ${data.material}`;
        renderResult(generatedPack); $('#generation-status').hidden = generatedPack.demo ? false : true;
        if (generatedPack.demo) { $('#generation-status').className = 'notice is-info'; $('#generation-status').innerHTML = '<b>Mode pratinjau:</b> Contoh ini belum dibuat AI. Hubungkan URL Apps Script untuk mengaktifkan generator.'; }
      } catch (error) { $('#generation-status').hidden = false; $('#generation-status').className = 'notice is-error'; $('#generation-status').innerHTML = `<b>Belum berhasil membuat soal.</b> ${esc(error.message || 'Terjadi kesalahan. Silakan coba lagi.')}`; }
    });
    $('#settings-page').addEventListener('click', event => { if (event.target.matches('[data-refresh-config]')) showConfig(); });
    $('#add-user-form').addEventListener('submit', async event => {
      event.preventDefault();
      try { await callApi('addUser', { user: { name: $('#new-user-name').value.trim(), email: $('#new-user-email').value.trim(), role: $('#new-user-role').value } }); event.target.reset(); toast('Pengguna ditambahkan.'); loadAdminUsers(); }
      catch (error) { toast(error.message); }
    });
    $('#import-users').addEventListener('click', async () => {
      const file = $('#user-csv').files[0]; if (!file) { toast('Pilih file CSV terlebih dahulu.'); return; }
      try { const users = parseCsv((await file.text()).replace(/^\uFEFF/, '')); const result = await callApi('importUsers', { users }); $('#import-status').textContent = `${result.imported.added} ditambahkan, ${result.imported.updated} diperbarui, ${result.imported.skipped} dilewati.`; loadAdminUsers(); }
      catch (error) { $('#import-status').textContent = error.message; }
    });
    $('#refresh-users').addEventListener('click', loadAdminUsers);
    $('#save-pack').addEventListener('click', savePack); $('#download-word').addEventListener('click', downloadWord);
    $('#print-pdf').addEventListener('click', () => { countDownload(); window.print(); });
    $('#question-form').addEventListener('change', saveDraft);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
