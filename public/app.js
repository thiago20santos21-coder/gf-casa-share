/* Casa Share — app logic */
(function () {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyCAlPFtxbhhsf1ZEpazvjGuYgrJN0_6aso',
    authDomain: 'gf-casa-share.firebaseapp.com',
    projectId: 'gf-casa-share',
    storageBucket: 'gf-casa-share.firebasestorage.app',
    messagingSenderId: '672847820302',
    appId: '1:672847820302:web:b1890e09213a8b95c66e5f'
  };

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  db.settings({ merge: true, cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });
  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    // Ignora se outra aba já ativou ou o navegador não permite
    console.warn('Firestore offline persistence:', err && err.code);
  });
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

  let currentUser = null;
  let userProfile = null;
  let currentGroup = null;
  let groupId = null;
  let authMode = 'login';
  let shopFilter = 'pending';
  let pixPayloadAtual = '';
  let deferredInstallPrompt = null;

  let unsubExpenses = null;
  let unsubShopping = null;
  let unsubMessages = null;
  let unsubGroup = null;

  let expenses = [];
  let shopping = [];
  let messages = [];

  // Notification dedupe / baseline
  const seenExpense = new Set();
  const seenShop = new Set();
  const seenMsg = new Set();
  let listenersReady = false;
  let snapshotWarmups = 0;
  const listenReady = { expenses: false, shopping: false, messages: false };
  let activePage = 'expenses';
  let notifPermission = (typeof Notification !== 'undefined' && Notification.permission) || 'default';

  function markCollectionReady(key) {
    if (listenReady[key]) return;
    listenReady[key] = true;
    // Notificações de despesa/chat não dependem umas das outras
    listenersReady = listenReady.expenses && listenReady.shopping && listenReady.messages;
  }

  function markSnapshotWarm() {
    // legado — preferir markCollectionReady
    snapshotWarmups += 1;
    if (snapshotWarmups >= 3) listenersReady = true;
  }

  const $ = (id) => document.getElementById(id);

  function escapeHTML(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function fmt(v) {
    return Number(v || 0).toFixed(2).replace('.', ',');
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  let confirmResolver = null;
  function appConfirm(message, opts) {
    const options = opts || {};
    return new Promise((resolve) => {
      if (confirmResolver) {
        confirmResolver(false);
        confirmResolver = null;
      }
      confirmResolver = resolve;
      $('confirm-title').textContent = options.title || 'Confirmar';
      $('confirm-message').textContent = message || '';
      const ok = $('confirm-ok');
      ok.textContent = options.okText || 'Confirmar';
      ok.className = 'btn btn-sm ' + (options.danger === false ? 'btn-primary' : 'btn-danger');
      ok.style.width = 'auto';
      ok.style.margin = '0';
      $('confirm-cancel').textContent = options.cancelText || 'Cancelar';
      $('confirm-modal').classList.add('active');
      ok.focus();
    });
  }
  function closeConfirm(result) {
    $('confirm-modal').classList.remove('active');
    if (confirmResolver) {
      const r = confirmResolver;
      confirmResolver = null;
      r(!!result);
    }
  }
  function showScreen(name) {
    ['boot-screen', 'auth-screen', 'group-screen', 'app-shell'].forEach((id) => {
      $(id).classList.toggle('hidden', id !== name);
    });
    try {
      updateInstallUI();
    } catch (_) {}
  }
  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0] || '')
      .join('')
      .toUpperCase() || '?';
  }
  function makeInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function authErrorMsg(err) {
    const code = (err && err.code) || '';
    const map = {
      'auth/email-already-in-use': 'Este e-mail já está em uso.',
      'auth/invalid-email': 'E-mail inválido.',
      'auth/weak-password': 'Senha fraca (mín. 6 caracteres).',
      'auth/user-not-found': 'Conta não encontrada.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/invalid-credential': 'E-mail ou senha inválidos.',
      'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco.',
      'auth/configuration-not-found':
        'Auth ainda não foi ativado no Firebase Console. Abra Authentication → Começar → E-mail/senha.',
      'auth/operation-not-allowed': 'Login por e-mail ainda não está habilitado no Firebase Console.'
    };
    return map[code] || (err && err.message) || 'Erro inesperado.';
  }

  /* ========== Offline queue (IndexedDB) ========== */
  const IDB_NAME = 'gf-casa-share-offline';
  const IDB_STORE = 'queue';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const dbx = req.result;
        if (!dbx.objectStoreNames.contains(IDB_STORE)) {
          dbx.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function queueAdd(op) {
    const dbx = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = dbx.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).add({ ...op, createdAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function queueAll() {
    const dbx = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = dbx.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function queueClearId(id) {
    const dbx = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = dbx.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function cacheKey(kind) {
    return 'casa_share_cache_' + (groupId || 'none') + '_' + kind;
  }

  function saveLocalCache(kind, data) {
    try {
      localStorage.setItem(cacheKey(kind), JSON.stringify({ at: Date.now(), data }));
    } catch (_) {}
  }

  function loadLocalCache(kind) {
    try {
      const raw = localStorage.getItem(cacheKey(kind));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.data != null ? parsed.data : null;
    } catch (_) {
      return null;
    }
  }

  function hydrateFromCache() {
    if (!groupId) return;
    const g = loadLocalCache('group');
    const e = loadLocalCache('expenses');
    const s = loadLocalCache('shopping');
    const m = loadLocalCache('messages');
    if (g) {
      currentGroup = g;
      try {
        renderGroupMeta();
      } catch (_) {}
    }
    if (Array.isArray(e)) {
      expenses = e;
      renderExpenses();
    }
    if (Array.isArray(s)) {
      shopping = s;
      renderShopping();
    }
    if (Array.isArray(m)) {
      messages = m;
      renderChat();
    }
  }

  async function updateOfflineUI() {
    const online = navigator.onLine;
    const pending = await queueCount();
    const live = $('pill-live');
    const off = $('pill-offline');
    if (live) live.classList.toggle('hidden', !online);
    if (!off) return;
    off.classList.toggle('hidden', online && pending === 0);
    if (!online) {
      off.textContent = pending ? `Offline — ${pending} na fila` : 'Offline — dados locais';
    } else if (pending) {
      off.classList.remove('hidden');
      off.textContent = `Sincronizando ${pending}…`;
    }
  }

  async function executeQueuedOp(op) {
    const refBase = () => db.collection('groups').doc(op.groupId);
    switch (op.action) {
      case 'addExpense':
        await refBase().collection('expenses').add(op.payload);
        break;
      case 'deleteExpense':
        await refBase().collection('expenses').doc(op.docId).delete();
        break;
      case 'clearExpenses':
        for (const id of op.docIds || []) {
          await refBase().collection('expenses').doc(id).delete();
        }
        break;
      case 'addShop':
        await refBase().collection('shopping').add(op.payload);
        break;
      case 'updateShop':
        await refBase().collection('shopping').doc(op.docId).update(op.payload);
        break;
      case 'deleteShop':
        await refBase().collection('shopping').doc(op.docId).delete();
        break;
      case 'addMessage':
        await refBase().collection('messages').add(op.payload);
        break;
      case 'updateMessage':
        await refBase().collection('messages').doc(op.docId).update(op.payload);
        break;
      case 'deleteMessage':
        await refBase().collection('messages').doc(op.docId).delete();
        break;
      case 'updateGroup':
        await refBase().update(op.payload);
        break;
      default:
        break;
    }
  }

  async function flushQueue() {
    if (!navigator.onLine) return;
    const items = await queueAll();
    if (!items.length) {
      await updateOfflineUI();
      return;
    }
    for (const item of items) {
      try {
        await executeQueuedOp(item);
        await queueClearId(item.id);
      } catch (err) {
        console.error('queue flush failed', item, err);
        break;
      }
    }
    const left = await queueCount();
    if (!left) toast('Alterações sincronizadas');
    await updateOfflineUI();
  }

  async function runWrite(op) {
    op.groupId = op.groupId || groupId;
    try {
      await executeQueuedOp(op);
      if (!navigator.onLine) {
        await updateOfflineUI();
        toast('Salvo offline — será sincronizado ao reconectar');
        return { offline: true };
      }
      return { offline: false };
    } catch (err) {
      const code = (err && err.code) || '';
      // Não enfileirar erros de permissão — nunca vão sincronizar
      if (code === 'permission-denied') {
        console.error('permission-denied', op, err);
        toast('Sem permissão para esta ação');
        return { offline: false, error: err };
      }
      await queueAdd(op);
      await updateOfflineUI();
      toast(navigator.onLine ? 'Sem conexão estável — salvo na fila' : 'Salvo offline — será sincronizado ao reconectar');
      return { offline: true, error: err };
    }
  }

  window.addEventListener('online', () => {
    updateOfflineUI();
    flushQueue();
  });
  window.addEventListener('offline', updateOfflineUI);

  /* ========== Notifications ========== */
  function canNotify() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  async function ensureNotifPermission(interactive) {
    const statusEl = $('notif-status');
    if (typeof Notification === 'undefined') {
      if (statusEl) statusEl.textContent = 'Este navegador não suporta notificações.';
      return false;
    }
    if (Notification.permission === 'granted') {
      notifPermission = 'granted';
      if (statusEl) statusEl.textContent = 'Notificações ativas neste aparelho.';
      return true;
    }
    if (Notification.permission === 'denied') {
      if (statusEl) statusEl.textContent = 'Bloqueadas nas configurações do navegador/sistema. Ative manualmente.';
      return false;
    }
    if (!interactive) {
      if (statusEl) statusEl.textContent = 'Toque em “Ativar notificações” para receber alertas.';
      return false;
    }
    const res = await Notification.requestPermission();
    notifPermission = res;
    if (res === 'granted') {
      if (statusEl) statusEl.textContent = 'Notificações ativas neste aparelho.';
      await notifyUser('Casa Share', 'Notificações ligadas. Você será avisado de chat e despesas.', 'notif-on', {
        force: true
      });
      return true;
    }
    if (statusEl) statusEl.textContent = 'Permissão negada.';
    return false;
  }

  function notifIconUrl() {
    try {
      return new URL('/icons/casa-192.png', self.location.origin).href;
    } catch (_) {
      return '/icons/casa-192.png';
    }
  }

  /**
   * @param {string} title
   * @param {string} body
   * @param {string} [tag]
   * @param {boolean|object} [opts] force, page ('chat'|'expenses'|'shopping'), url
   */
  async function notifyUser(title, body, tag, opts) {
    const options = typeof opts === 'boolean' ? { force: opts } : opts || {};
    if (!canNotify()) {
      if (!options.silentNoPerm) {
        toast((title ? title + ': ' : '') + (body || ''));
      }
      return false;
    }
    // Silencia só se a pessoa já está na mesma aba E o app está em foco
    const viewingSamePage =
      !document.hidden &&
      document.hasFocus() &&
      options.page &&
      activePage === options.page;
    if (!options.force && viewingSamePage) {
      toast((title ? title + ': ' : '') + (body || ''));
      return false;
    }
    const icon = notifIconUrl();
    const payload = {
      title: title || 'Casa Share',
      body: body || '',
      tag: tag || 'casa-update-' + Date.now(),
      icon,
      badge: icon,
      renotify: true,
      requireInteraction: !!options.requireInteraction,
      data: { url: options.url || '/' }
    };
    let shown = false;
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        icon,
        badge: icon,
        renotify: true,
        requireInteraction: payload.requireInteraction,
        data: payload.data
      });
      shown = true;
    } catch (err) {
      console.warn('SW notification failed', err);
    }
    // Fallback nativo (alguns Android/Chrome em primeiro plano)
    if (!shown || options.alsoNative) {
      try {
        const n = new Notification(payload.title, {
          body: payload.body,
          tag: payload.tag,
          icon,
          renotify: true
        });
        shown = true;
        n.onclick = () => {
          try {
            window.focus();
          } catch (_) {}
          n.close();
        };
      } catch (err2) {
        if (!shown) {
          toast(payload.title + ': ' + payload.body);
          return false;
        }
      }
    }
    return shown;
  }

  function shouldNotifyFromOther(authorUid) {
    if (!currentUser) return false;
    return String(authorUid || '') !== String(currentUser.uid || '');
  }

  /* ========== PIX / roles helpers ========== */
  function isCreator() {
    if (!currentGroup || !currentUser) return false;
    const createdBy = String(currentGroup.createdBy || '');
    const uid = String(currentUser.uid || '');
    return !!createdBy && createdBy === uid;
  }

  function adminIds() {
    return (currentGroup && Array.isArray(currentGroup.adminIds) ? currentGroup.adminIds : []) || [];
  }

  function isAdmin() {
    if (!currentUser || !currentGroup) return false;
    if (isCreator()) return true;
    return adminIds().includes(currentUser.uid);
  }

  function isUserAdmin(uid) {
    return adminIds().includes(uid);
  }

  function payingMembers() {
    const members = (currentGroup && currentGroup.members) || [];
    const creatorId = currentGroup && currentGroup.createdBy;
    return members.filter((m) => m.uid !== creatorId);
  }

  function payingCount() {
    return Math.max(0, payingMembers().length);
  }

  function isStandaloneDisplay() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function stripAccents(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isValidDdd(ddd) {
    const n = parseInt(ddd, 10);
    return n >= 11 && n <= 99;
  }

  /** Converte telefone BR para E.164 (+55…). Celular com 10 dígitos ganha o 9º dígito. */
  function normalizeBrPhoneDigits(digits) {
    let d = String(digits || '').replace(/\D/g, '');
    if (!d) return '';
    // Evita +55+55
    while (d.startsWith('55') && d.length > 11) {
      const rest = d.slice(2);
      if (rest.length === 10 || rest.length === 11) {
        d = rest;
        break;
      }
      if (rest.startsWith('55')) {
        d = rest;
        continue;
      }
      break;
    }
    // Já veio com 55 + nacional
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
      d = d.slice(2);
    }
    // Nacional 10 dígitos: DDD + 8 — celular antigo → insere 9
    if (d.length === 10 && isValidDdd(d.slice(0, 2))) {
      const ddd = d.slice(0, 2);
      const local = d.slice(2);
      if (/^[6-9]/.test(local)) {
        d = ddd + '9' + local; // 7999273882 → 79999273882
      }
    }
    // Nacional 11 dígitos com 9 após DDD
    if (d.length === 11 && isValidDdd(d.slice(0, 2)) && d.charAt(2) === '9') {
      return '+55' + d;
    }
    // Fixo 10 dígitos (após possível não-inserção)
    if (d.length === 10 && isValidDdd(d.slice(0, 2))) {
      return '+55' + d;
    }
    return '';
  }

  function normalizePixKey(raw) {
    const original = String(raw || '').trim();
    let chave = original.replace(/\s+/g, '');
    if (!chave) return '';

    // E-mail
    if (chave.includes('@')) return chave.toLowerCase();

    // Chave aleatória EVP (UUID)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave)) {
      return chave.toLowerCase();
    }

    const digits = chave.replace(/\D/g, '');

    // Telefone (com +, 55, 10 ou 11 dígitos nacionais)
    const looksPhone =
      chave.startsWith('+') ||
      /^55\d{10,11}$/.test(digits) ||
      (/^\d{10}$/.test(digits) && isValidDdd(digits.slice(0, 2)) && /^[6-9]/.test(digits.slice(2))) ||
      (/^\d{11}$/.test(digits) && isValidDdd(digits.slice(0, 2)) && digits.charAt(2) === '9');

    if (looksPhone) {
      const phone = normalizeBrPhoneDigits(digits);
      if (phone) return phone;
    }

    // CPF (11) / CNPJ (14) — só dígitos, sem tratar como telefone
    if (/^\d{11}$/.test(digits) || /^\d{14}$/.test(digits)) return digits;

    return chave;
  }

  function updatePixKeyPreview() {
    const el = $('pix-key-preview');
    if (!el) return;
    const raw = ($('cfg-pix-key') && $('cfg-pix-key').value) || '';
    const norm = normalizePixKey(raw);
    if (!raw.trim()) {
      el.textContent = 'A chave normalizada aparece aqui após digitar.';
      return;
    }
    if (!norm) {
      el.textContent = 'Não foi possível interpretar a chave.';
      return;
    }
    el.textContent =
      norm === raw.trim().replace(/\s+/g, '')
        ? 'Chave no PIX: ' + norm
        : 'Você digitou “' + raw.trim() + '” → no PIX será: ' + norm;
  }

  function gerarPixPayload(chaveRaw, nomeRaw, cidadeRaw, valor) {
    function tlv(id, val) {
      const str = String(val);
      // Spec Pix: tamanho em bytes UTF-8
      const len = new TextEncoder().encode(str).length;
      return id + String(len).padStart(2, '0') + str;
    }

    const chave = normalizePixKey(chaveRaw);
    if (!chave) throw new Error('Chave PIX vazia');

    let nome = stripAccents(nomeRaw || 'RECEBEDOR').toUpperCase().substring(0, 25);
    if (!nome) nome = 'RECEBEDOR';
    let cidade = stripAccents(cidadeRaw || 'SAO PAULO').toUpperCase().substring(0, 15);
    if (!cidade) cidade = 'SAO PAULO';

    const amount = Number(valor);
    const amountStr = amount > 0 ? amount.toFixed(2) : '';

    const gui = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave);
    const mai = tlv('26', gui);

    let payload = '';
    payload += tlv('00', '01'); // Payload Format Indicator
    payload += tlv('01', '11'); // Point of Initiation — estático
    payload += mai;
    payload += tlv('52', '0000');
    payload += tlv('53', '986');
    if (amountStr) payload += tlv('54', amountStr);
    payload += tlv('58', 'BR');
    payload += tlv('59', nome);
    payload += tlv('60', cidade);
    payload += tlv('62', tlv('05', '***'));
    payload += '6304';

    const bytes = new TextEncoder().encode(payload);
    let crc = 0xffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
        else crc = (crc << 1) & 0xffff;
      }
    }
    payload += crc.toString(16).toUpperCase().padStart(4, '0');
    return payload;
  }

  function renderQr(payload) {
    const img = $('qr-img');
    const wrap = $('qr-wrap');
    if (!img) return;
    if (typeof qrcode !== 'function') {
      if (wrap) wrap.innerHTML = '<p class="hint">QR indisponível offline — use o Pix Copia e Cola.</p>';
      return;
    }
    try {
      const qr = qrcode(0, 'M');
      qr.addData(payload);
      qr.make();
      img.alt = 'QR Code PIX';
      img.src = qr.createDataURL(8, 2);
      img.style.display = 'block';
    } catch (err) {
      console.error('QR', err);
      toast('Não foi possível gerar o QR — use o Copia e Cola');
    }
  }

  function validatePixPayload(payload) {
    if (!payload || payload.length < 50) return false;
    if (!payload.startsWith('000201')) return false;
    if (!payload.includes('br.gov.bcb.pix')) return false;
    if (!payload.includes('52040000')) return false;
    if (!payload.includes('5303986')) return false;
    if (!/6304[0-9A-F]{4}$/.test(payload)) return false;
    // reconfere CRC
    const base = payload.slice(0, -4);
    const given = payload.slice(-4);
    const bytes = new TextEncoder().encode(base);
    let crc = 0xffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
        else crc = (crc << 1) & 0xffff;
      }
    }
    return given === crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /* ========== Auth / Group ========== */
  function setAuthTab(mode) {
    authMode = mode;
    $('tab-login').classList.toggle('active', mode === 'login');
    $('tab-register').classList.toggle('active', mode === 'register');
    $('name-field').classList.toggle('hidden', mode !== 'register');
    $('auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Criar conta';
    $('auth-pass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('auth-error').textContent = '';
  }

  async function handleAuth(e) {
    e.preventDefault();
    const email = $('auth-email').value.trim();
    const pass = $('auth-pass').value;
    const name = $('auth-name').value.trim();
    $('auth-error').textContent = '';
    $('auth-submit').disabled = true;
    try {
      if (authMode === 'register') {
        if (!name) {
          $('auth-name').classList.add('shake');
          setTimeout(() => $('auth-name').classList.remove('shake'), 400);
          throw { message: 'Informe seu nome.' };
        }
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await cred.user.updateProfile({ displayName: name });
        await db.collection('users').doc(cred.user.uid).set(
          {
            name,
            email,
            groupId: null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      } else {
        await auth.signInWithEmailAndPassword(email, pass);
      }
    } catch (err) {
      $('auth-error').textContent = authErrorMsg(err);
    } finally {
      $('auth-submit').disabled = false;
    }
  }

  async function ensureUserDoc(user) {
    const ref = db.collection('users').doc(user.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      const profile = {
        name: user.displayName || (user.email || '').split('@')[0] || 'Usuário',
        email: user.email || '',
        groupId: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await ref.set(profile);
      return profile;
    }
    return snap.data();
  }

  function clearListeners() {
    [unsubExpenses, unsubShopping, unsubMessages, unsubGroup].forEach((fn) => {
      if (fn) fn();
    });
    unsubExpenses = unsubShopping = unsubMessages = unsubGroup = null;
    listenersReady = false;
    snapshotWarmups = 0;
    listenReady.expenses = false;
    listenReady.shopping = false;
    listenReady.messages = false;
    seenExpense.clear();
    seenShop.clear();
    seenMsg.clear();
  }

  auth.onAuthStateChanged(async (user) => {
    clearListeners();
    currentUser = user;
    currentGroup = null;
    groupId = null;
    if (!user) {
      showScreen('auth-screen');
      return;
    }
    try {
      userProfile = await ensureUserDoc(user);
      groupId = userProfile.groupId || null;
      if (!groupId) {
        showScreen('group-screen');
        return;
      }
      await entrarNoApp(groupId);
    } catch (err) {
      console.error(err);
      showScreen('auth-screen');
      $('auth-error').textContent = authErrorMsg(err);
    }
  });

  async function criarGrupo() {
    $('group-error').textContent = '';
    const name = $('group-name').value.trim();
    const people = Math.max(2, Math.min(20, parseInt($('group-people').value, 10) || 3));
    if (!name) {
      $('group-name').classList.add('shake');
      setTimeout(() => $('group-name').classList.remove('shake'), 400);
      return;
    }
    try {
      const inviteCode = makeInviteCode();
      const member = {
        uid: currentUser.uid,
        name: userProfile.name || currentUser.displayName || 'Usuário',
        email: currentUser.email || ''
      };
      const groupRef = db.collection('groups').doc();
      await groupRef.set({
        name,
        inviteCode,
        memberIds: [currentUser.uid],
        members: [member],
        adminIds: [],
        personCount: people,
        pix: { chave: '', nome: '', cidade: '' },
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUser.uid
      });
      await db.collection('invites').doc(inviteCode).set({
        groupId: groupRef.id,
        groupName: name,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await db.collection('users').doc(currentUser.uid).set({ groupId: groupRef.id }, { merge: true });
      userProfile.groupId = groupRef.id;
      await entrarNoApp(groupRef.id);
      toast('Grupo criado — você recebe o PIX');
    } catch (err) {
      console.error(err);
      $('group-error').textContent = err.message || 'Não foi possível criar o grupo.';
    }
  }

  async function resolveInvite(code) {
    const inv = await db.collection('invites').doc(code).get();
    if (inv.exists) {
      const data = inv.data() || {};
      if (!data.groupId) throw new Error('Convite incompleto. Peça um novo código.');
      return { groupId: data.groupId, groupName: data.groupName || '' };
    }
    // Fallback: some older groups may only store inviteCode on the group doc.
    // Requires get-by-id; without list permission we can't query — recreate invite index.
    throw new Error('Código inválido. Confira se digitou corretamente, sem espaços.');
  }

  async function entrarGrupo() {
    $('group-error').textContent = '';
    const code = $('join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    $('join-code').value = code;
    if (code.length < 4) {
      $('join-code').classList.add('shake');
      setTimeout(() => $('join-code').classList.remove('shake'), 400);
      return;
    }
    $('btn-entrar-grupo').disabled = true;
    try {
      const { groupId: gid, groupName } = await resolveInvite(code);
      const gRef = db.collection('groups').doc(gid);
      await db.runTransaction(async (tx) => {
        const gSnap = await tx.get(gRef);
        if (!gSnap.exists) throw new Error('Grupo não encontrado para este código.');
        const data = gSnap.data();
        if ((data.memberIds || []).includes(currentUser.uid)) return;
        const member = {
          uid: currentUser.uid,
          name: userProfile.name || currentUser.displayName || 'Usuário',
          email: currentUser.email || ''
        };
        tx.update(gRef, {
          memberIds: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
          members: firebase.firestore.FieldValue.arrayUnion(member)
        });
      });
      await db.collection('users').doc(currentUser.uid).set({ groupId: gid }, { merge: true });
      userProfile.groupId = gid;
      await entrarNoApp(gid);
      toast('Entrou em ' + (groupName || 'grupo'));
    } catch (err) {
      console.error('entrarGrupo', err);
      let msg = err.message || 'Não foi possível entrar.';
      if (err.code === 'permission-denied') {
        msg = 'Sem permissão para entrar neste grupo. Atualize a página e tente de novo.';
      }
      $('group-error').textContent = msg;
    } finally {
      $('btn-entrar-grupo').disabled = false;
    }
  }

  async function entrarNoApp(gid) {
    groupId = gid;
    showScreen('app-shell');
    showPage('expenses');
    hydrateFromCache();
    updateOfflineUI();
    flushQueue();
    ensureNotifPermission(false).then((ok) => {
      if (!ok && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        toast('Ative as notificações em Grupo para receber chat e despesas');
      }
    });
    if (!navigator.onLine) {
      toast('Modo offline — mostrando dados salvos neste aparelho');
    }

    unsubGroup = db
      .collection('groups')
      .doc(gid)
      .onSnapshot(
        async (snap) => {
          if (!snap.exists) {
            clearListeners();
            try {
              await db.collection('users').doc(currentUser.uid).set({ groupId: null }, { merge: true });
            } catch (_) {}
            userProfile.groupId = null;
            groupId = null;
            currentGroup = null;
            showScreen('group-screen');
            toast('Grupo removido');
            return;
          }
          const data = { id: snap.id, ...snap.data() };
          if (!(data.memberIds || []).includes(currentUser.uid)) {
            clearListeners();
            try {
              await db.collection('users').doc(currentUser.uid).set({ groupId: null }, { merge: true });
            } catch (_) {}
            userProfile.groupId = null;
            groupId = null;
            currentGroup = null;
            showScreen('group-screen');
            toast('Você foi removido do grupo');
            return;
          }
          // Backfill adminIds for older groups (creator only)
          if (!Array.isArray(data.adminIds) && data.createdBy === currentUser.uid) {
            try {
              await db.collection('groups').doc(gid).update({ adminIds: [] });
            } catch (_) {}
          }
          currentGroup = data;
          saveLocalCache('group', currentGroup);
          renderGroupMeta();
          updateInstallUI();
        },
        (err) => {
          console.error('group listen', err);
          if (!navigator.onLine) hydrateFromCache();
        }
      );

    unsubExpenses = db
      .collection('groups')
      .doc(gid)
      .collection('expenses')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        (snap) => {
          expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          saveLocalCache('expenses', expenses);
          if (!listenReady.expenses) {
            snap.docs.forEach((d) => seenExpense.add(d.id));
            markCollectionReady('expenses');
          } else {
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'added' && !seenExpense.has(ch.doc.id)) {
                const data = ch.doc.data() || {};
                // Ignora eco local de escrita pendente do próprio aparelho
                if (ch.doc.metadata && ch.doc.metadata.hasPendingWrites) {
                  seenExpense.add(ch.doc.id);
                  return;
                }
                if (shouldNotifyFromOther(data.createdBy)) {
                  notifyUser(
                    'Nova despesa para pagar',
                    `${data.createdByName || 'Alguém'}: ${data.descricao} — R$ ${fmt(data.valor)}`,
                    'expense-' + ch.doc.id,
                    {
                      page: 'expenses',
                      url: '/?page=expenses',
                      alsoNative: true,
                      requireInteraction: false
                    }
                  );
                }
              }
              seenExpense.add(ch.doc.id);
            });
          }
          renderExpenses();
        },
        (err) => {
          console.error('expenses listen', err);
          markCollectionReady('expenses');
        }
      );

    unsubShopping = db
      .collection('groups')
      .doc(gid)
      .collection('shopping')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        (snap) => {
          shopping = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          saveLocalCache('shopping', shopping);
          if (!listenReady.shopping) {
            snap.docs.forEach((d) => seenShop.add(d.id));
            markCollectionReady('shopping');
          } else {
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'added' && !seenShop.has(ch.doc.id)) {
                const data = ch.doc.data() || {};
                if (ch.doc.metadata && ch.doc.metadata.hasPendingWrites) {
                  seenShop.add(ch.doc.id);
                  return;
                }
                if (shouldNotifyFromOther(data.createdBy)) {
                  notifyUser(
                    'Lista de compras',
                    `${data.createdByName || 'Alguém'} adicionou: ${data.text}`,
                    'shop-' + ch.doc.id,
                    { page: 'shopping', url: '/?page=shopping', alsoNative: true }
                  );
                }
              }
              if (ch.type === 'modified') {
                const data = ch.doc.data() || {};
                if (data.done && data.doneBy && shouldNotifyFromOther(data.doneBy)) {
                  notifyUser(
                    'Item comprado',
                    `${data.doneByName || 'Alguém'} comprou: ${data.text}`,
                    'shop-done-' + ch.doc.id,
                    { page: 'shopping', url: '/?page=shopping', alsoNative: true }
                  );
                }
              }
              seenShop.add(ch.doc.id);
            });
          }
          renderShopping();
        },
        (err) => {
          console.error('shopping listen', err);
          markCollectionReady('shopping');
        }
      );

    unsubMessages = db
      .collection('groups')
      .doc(gid)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .limitToLast(100)
      .onSnapshot(
        (snap) => {
          messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          saveLocalCache('messages', messages);
          if (!listenReady.messages) {
            snap.docs.forEach((d) => seenMsg.add(d.id));
            markCollectionReady('messages');
          } else {
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'added' && !seenMsg.has(ch.doc.id)) {
                const data = ch.doc.data() || {};
                if (ch.doc.metadata && ch.doc.metadata.hasPendingWrites) {
                  seenMsg.add(ch.doc.id);
                  return;
                }
                if (shouldNotifyFromOther(data.uid)) {
                  const preview = String(data.text || '').slice(0, 120);
                  notifyUser(data.name || 'Nova mensagem', preview, 'msg-' + ch.doc.id, {
                    page: 'chat',
                    url: '/?page=chat',
                    alsoNative: true
                  });
                }
              }
              seenMsg.add(ch.doc.id);
            });
          }
          renderChat();
        },
        (err) => {
          console.error('chat listen', err);
          markCollectionReady('messages');
        }
      );
  }

  function renderGroupMeta() {
    if (!currentGroup) return;
    $('group-title').textContent = currentGroup.name || 'Grupo';
    $('invite-code-display').textContent = currentGroup.inviteCode || '------';
    $('cfg-pix-key').value = (currentGroup.pix && currentGroup.pix.chave) || '';
    $('cfg-pix-name').value = (currentGroup.pix && currentGroup.pix.nome) || '';
    $('cfg-pix-city').value = (currentGroup.pix && currentGroup.pix.cidade) || '';
    updatePixKeyPreview();

    const creator = isCreator();
    const admin = isAdmin();
    const roleLabel = creator ? 'Criador' : admin ? 'Admin' : 'Membro';

    $('account-info').textContent =
      (userProfile && userProfile.name ? userProfile.name + ' · ' : '') +
      (currentUser.email || '') +
      ' · ' +
      roleLabel;

    const roleBanner = $('role-banner-text');
    if (roleBanner) {
      roleBanner.textContent = creator
        ? 'Você é o CRIADOR: edita PIX, promove admins, remove membros e pode apagar o grupo.'
        : admin
          ? 'Você é ADMIN: pode remover membros e moderar conteúdo. PIX só o criador edita.'
          : 'Você é MEMBRO: use despesas, compras e chat. Pode sair do grupo. O PIX é somente leitura.';
    }

    $('pill-receiver').classList.toggle('hidden', !creator);
    $('receiver-banner').classList.toggle('show', creator);

    const pixFields = $('pix-fields');
    const pixHint = $('pix-hint');
    const saveBtn = $('btn-save-cfg');
    if (pixFields) pixFields.classList.toggle('pix-readonly', !creator);
    ['cfg-pix-key', 'cfg-pix-name', 'cfg-pix-city'].forEach((id) => {
      const el = $(id);
      if (el) {
        el.readOnly = !creator;
        el.disabled = !creator;
      }
    });
    if (saveBtn) {
      saveBtn.disabled = !creator;
      saveBtn.style.display = 'inline-flex';
      saveBtn.textContent = creator ? 'Salvar PIX' : 'Somente o criador salva PIX';
    }
    if (pixHint) {
      pixHint.textContent = creator
        ? 'Somente você (criador) pode alterar a chave PIX.'
        : 'A edição do PIX está bloqueada: só o criador pode alterar.';
    }

    const delBtn = $('btn-delete-group');
    const leaveBtn = $('btn-leave-group');
    const actionsHint = $('account-actions-hint');
    if (delBtn) {
      delBtn.disabled = !creator;
      delBtn.style.opacity = creator ? '1' : '0.45';
      delBtn.style.pointerEvents = creator ? 'auto' : 'none';
    }
    if (leaveBtn) {
      leaveBtn.disabled = creator;
      leaveBtn.style.opacity = creator ? '0.45' : '1';
      leaveBtn.style.pointerEvents = creator ? 'none' : 'auto';
    }
    if (actionsHint) {
      actionsHint.textContent = creator
        ? 'Como criador, use Apagar grupo (não é possível “sair” sem apagar).'
        : 'Use Sair deste grupo para deixar o espaço compartilhado.';
    }

    const membersHelp = $('members-help');
    if (membersHelp) {
      const others = (currentGroup.members || []).filter((m) => m.uid !== currentGroup.createdBy);
      if (creator && others.length === 0) {
        membersHelp.textContent = 'Convide alguém com o código acima. Depois aparecerão os botões Tornar admin e Remover.';
      } else if (creator) {
        membersHelp.textContent = 'Botões por membro: Tornar admin, Remover admin e Remover do grupo.';
      } else if (admin) {
        membersHelp.textContent = 'Como admin, você pode remover outros membros (exceto o criador).';
      } else {
        membersHelp.textContent = 'Somente o criador e os admins gerenciam a lista.';
      }
    }

    const list = $('members-list');
    list.innerHTML = '';
    (currentGroup.members || []).forEach((m) => {
      const isRecv = m.uid === currentGroup.createdBy;
      const userIsAdmin = isUserAdmin(m.uid);
      const el = document.createElement('div');
      el.className = 'member';
      let tags = '';
      if (isRecv) tags += '<span class="member-tag">Criador · Recebe</span>';
      else if (userIsAdmin) tags += '<span class="member-tag admin">Admin · Paga</span>';
      else tags += '<span class="member-tag muted">Membro · Paga</span>';

      let actions = '';
      if (!isRecv && creator) {
        actions += userIsAdmin
          ? `<button type="button" class="btn btn-ghost btn-sm act-demote">Remover admin</button>`
          : `<button type="button" class="btn btn-primary btn-sm act-promote" style="width:auto;margin:0">Tornar admin</button>`;
      }
      if (!isRecv && admin && m.uid !== currentUser.uid) {
        actions += `<button type="button" class="btn btn-danger btn-sm act-remove">Remover do grupo</button>`;
      }

      el.innerHTML = `<div class="avatar">${escapeHTML(initials(m.name))}</div>
        <div style="flex:1;min-width:0">
          <div class="member-name">${escapeHTML(m.name || 'Membro')}</div>
          <div class="member-email">${escapeHTML(m.email || '')}</div>
          <div style="margin-top:.25rem;display:flex;gap:.35rem;flex-wrap:wrap">${tags}</div>
        </div>
        ${actions ? `<div class="member-actions">${actions}</div>` : ''}`;

      const promote = el.querySelector('.act-promote');
      const demote = el.querySelector('.act-demote');
      const remove = el.querySelector('.act-remove');
      if (promote) promote.onclick = () => setMemberAdmin(m.uid, true);
      if (demote) demote.onclick = () => setMemberAdmin(m.uid, false);
      if (remove) remove.onclick = () => removerMembro(m);
      list.appendChild(el);
    });
    renderExpenses();
    updateInstallUI();
  }

  async function setMemberAdmin(uid, makeAdmin) {
    if (!isCreator() || !groupId) {
      toast('Somente o criador promove admins');
      return;
    }
    try {
      const next = new Set(adminIds());
      if (makeAdmin) next.add(uid);
      else next.delete(uid);
      await db.collection('groups').doc(groupId).update({ adminIds: Array.from(next) });
      toast(makeAdmin ? 'Admin promovido' : 'Admin removido');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Falha ao atualizar admin (sem permissão)');
    }
  }

  async function removerMembro(m) {
    if (!isAdmin() || !groupId) return;
    if (m.uid === currentGroup.createdBy) {
      toast('Não é possível remover o criador');
      return;
    }
    const ok = await appConfirm('Remover ' + (m.name || 'membro') + ' do grupo?', {
      title: 'Remover membro',
      okText: 'Remover'
    });
    if (!ok) return;
    const members = (currentGroup.members || []).filter((x) => x.uid !== m.uid);
    const memberIds = (currentGroup.memberIds || []).filter((id) => id !== m.uid);
    const nextAdmins = adminIds().filter((id) => id !== m.uid);
    await db.collection('groups').doc(groupId).update({ members, memberIds, adminIds: nextAdmins });
    try {
      await db.collection('users').doc(m.uid).set({ groupId: null }, { merge: true });
    } catch (err) {
      console.warn('clear user groupId', err);
    }
    toast('Membro removido');
  }

  async function deleteCollectionDocs(colRef) {
    const snap = await colRef.limit(400).get();
    if (snap.empty) return 0;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  }

  async function apagarGrupo() {
    if (!isCreator() || !groupId) return;
    const name = currentGroup.name || 'grupo';
    const ok1 = await appConfirm(
      'Apagar permanentemente “' + name + '”? Despesas, compras, chat e convite serão removidos.',
      { title: 'Apagar grupo', okText: 'Continuar' }
    );
    if (!ok1) return;
    const ok2 = await appConfirm('Tem certeza? Esta ação não pode ser desfeita.', {
      title: 'Confirmação final',
      okText: 'Apagar tudo'
    });
    if (!ok2) return;
    const gid = groupId;
    const code = currentGroup.inviteCode;
    const gRef = db.collection('groups').doc(gid);
    try {
      clearListeners();
      for (const sub of ['expenses', 'shopping', 'messages']) {
        let n = 1;
        while (n > 0) n = await deleteCollectionDocs(gRef.collection(sub));
      }
      if (code) {
        try {
          await db.collection('invites').doc(code).delete();
        } catch (_) {}
      }
      await gRef.delete();
      await db.collection('users').doc(currentUser.uid).set({ groupId: null }, { merge: true });
      userProfile.groupId = null;
      groupId = null;
      currentGroup = null;
      showScreen('group-screen');
      toast('Grupo apagado');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Falha ao apagar grupo');
      if (gid) entrarNoApp(gid);
    }
  }

  function showPage(page) {
    activePage = page;
    ['expenses', 'shopping', 'chat', 'settings'].forEach((p) => {
      $('page-' + p).classList.toggle('hidden', p !== page);
    });
    document.querySelectorAll('.bottom-nav button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });
    if (page === 'chat') {
      const box = $('chat-msgs');
      requestAnimationFrame(() => {
        box.scrollTop = box.scrollHeight;
      });
    }
  }

  function renderExpenses() {
    const tb = $('corpo-tabela');
    const es = $('empty-expenses');
    tb.innerHTML = '';
    let soma = 0;
    if (!expenses.length) {
      es.style.display = 'block';
      $('btn-gerar-pix').disabled = true;
    } else {
      es.style.display = 'none';
      $('btn-gerar-pix').disabled = false;
      expenses.forEach((g) => {
        soma += Number(g.valor) || 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><div class="td-desc">${escapeHTML(g.descricao)}</div>
            <div class="td-meta">${escapeHTML(g.createdByName || '')}</div></td>
          <td class="td-total">R$ ${fmt(g.valor)}</td>
          <td style="text-align:center"><button class="btn-remove" type="button">Remover</button></td>`;
        tr.querySelector('.btn-remove').onclick = () => removerGasto(g.id);
        tb.appendChild(tr);
      });
    }
    const n = payingCount();
    const porPagante = n > 0 ? soma / n : 0;
    $('total-geral').textContent = `R$ ${fmt(soma)}`;
    $('total-por-pessoa').textContent = n > 0 ? `R$ ${fmt(porPagante)}` : '—';
    $('total-itens').textContent = expenses.length;
    $('label-por-pessoa').textContent = n > 0 ? `Por pagante (÷${n})` : 'Sem pagantes';
  }

  async function adicionarGasto() {
    const iD = $('input-descricao');
    const iV = $('input-valor');
    const d = iD.value.trim();
    const v = parseFloat(iV.value);
    let ok = true;
    if (!d) {
      iD.classList.add('shake');
      setTimeout(() => iD.classList.remove('shake'), 400);
      ok = false;
    }
    if (isNaN(v) || v <= 0) {
      iV.classList.add('shake');
      setTimeout(() => iV.classList.remove('shake'), 400);
      ok = false;
    }
    if (!ok || !groupId) return;
    const payload = {
      descricao: d,
      valor: v,
      createdBy: currentUser.uid,
      createdByName: userProfile.name || currentUser.displayName || 'Alguém',
      createdAt: new Date()
    };
    await runWrite({ action: 'addExpense', payload });
    // UI otimista offline
    if (!navigator.onLine) {
      expenses = [{ id: 'local-' + Date.now(), ...payload }, ...expenses];
      saveLocalCache('expenses', expenses);
      renderExpenses();
    }
    iD.value = '';
    iV.value = '';
    iD.focus();
    toast(navigator.onLine ? 'Despesa adicionada' : 'Despesa salva offline');
  }

  async function removerGasto(id) {
    if (!groupId || !id) return;
    if (String(id).startsWith('local-')) {
      expenses = expenses.filter((g) => g.id !== id);
      saveLocalCache('expenses', expenses);
      renderExpenses();
      toast('Despesa removida');
      return;
    }
    const prev = expenses;
    expenses = expenses.filter((g) => g.id !== id);
    renderExpenses();
    const res = await runWrite({ action: 'deleteExpense', docId: id });
    if (res && res.error && res.error.code === 'permission-denied') {
      expenses = prev;
      renderExpenses();
      return;
    }
    saveLocalCache('expenses', expenses);
    toast('Despesa removida');
  }

  async function apagarUltimo() {
    if (!expenses.length) return;
    await removerGasto(expenses[0].id);
  }

  async function limparTudo() {
    if (!expenses.length) return;
    const ok = await appConfirm('Apagar todas as despesas do grupo?', {
      title: 'Limpar despesas',
      okText: 'Apagar todas'
    });
    if (!ok) return;
    const ids = expenses.map((g) => g.id).filter((id) => id && !String(id).startsWith('local-'));
    const prev = expenses;
    expenses = [];
    renderExpenses();
    if (!ids.length) {
      saveLocalCache('expenses', expenses);
      toast('Despesas apagadas');
      return;
    }
    const res = await runWrite({ action: 'clearExpenses', docIds: ids });
    if (res && res.error && res.error.code === 'permission-denied') {
      expenses = prev;
      renderExpenses();
      return;
    }
    // Se clear parcial falhar no meio, tenta um a um
    if (res && res.error) {
      let failed = 0;
      for (const id of ids) {
        const r = await runWrite({ action: 'deleteExpense', docId: id });
        if (r && r.error) failed += 1;
      }
      if (failed) {
        toast('Algumas despesas não puderam ser apagadas');
        return;
      }
    }
    saveLocalCache('expenses', expenses);
    toast('Despesas apagadas');
  }

  function setShopFilter(f) {
    shopFilter = f;
    document.querySelectorAll('.shop-filters .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.filter === f);
    });
    renderShopping();
  }

  function renderShopping() {
    const list = $('shop-list');
    const empty = $('empty-shop');
    list.innerHTML = '';
    const filtered = shopping.filter((item) => {
      if (shopFilter === 'pending') return !item.done;
      if (shopFilter === 'done') return !!item.done;
      return true;
    });
    empty.style.display = filtered.length ? 'none' : 'block';
    filtered.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'shop-item' + (item.done ? ' done' : '');
      el.innerHTML = `
        <button class="shop-check" type="button" aria-label="Marcar">${item.done ? '✓' : ''}</button>
        <div class="shop-body">
          <div class="shop-text">${escapeHTML(item.text)}</div>
          <div class="shop-by">${
            item.done
              ? 'Comprado' + (item.doneByName ? ' por ' + escapeHTML(item.doneByName) : '')
              : 'Por ' + escapeHTML(item.createdByName || 'alguém')
          }</div>
        </div>
        <button class="btn-remove" type="button">Remover</button>`;
      el.querySelector('.shop-check').onclick = () => toggleCompra(item);
      el.querySelector('.btn-remove').onclick = () => removerCompra(item.id);
      list.appendChild(el);
    });
  }

  async function adicionarCompra() {
    const input = $('shop-input');
    const text = input.value.trim();
    if (!text || !groupId) {
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 400);
      return;
    }
    const payload = {
      text,
      done: false,
      createdBy: currentUser.uid,
      createdByName: userProfile.name || currentUser.displayName || 'Alguém',
      createdAt: new Date(),
      doneBy: null,
      doneByName: null
    };
    await runWrite({ action: 'addShop', payload });
    if (!navigator.onLine) {
      shopping = [{ id: 'local-' + Date.now(), ...payload }, ...shopping];
      saveLocalCache('shopping', shopping);
      renderShopping();
    }
    input.value = '';
    input.focus();
    if (shopFilter === 'done') setShopFilter('pending');
    toast(navigator.onLine ? 'Item adicionado' : 'Item salvo offline');
  }

  async function toggleCompra(item) {
    const payload = {
      done: !item.done,
      doneBy: !item.done ? currentUser.uid : null,
      doneByName: !item.done ? userProfile.name || currentUser.displayName || 'Alguém' : null,
      doneAt: !item.done
        ? navigator.onLine
          ? firebase.firestore.FieldValue.serverTimestamp()
          : new Date()
        : null
    };
    await runWrite({ action: 'updateShop', docId: item.id, payload });
  }

  async function removerCompra(id) {
    await runWrite({ action: 'deleteShop', docId: id });
  }

  let editingMsgId = null;

  function renderChat() {
    const box = $('chat-msgs');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = '';
    if (!messages.length) {
      box.innerHTML = '<div class="empty">Nenhuma mensagem ainda.</div>';
      return;
    }
    const creator = isCreator();
    messages.forEach((m) => {
      const mine = m.uid === currentUser.uid;
      const canEdit = mine;
      const canDelete = mine || isAdmin();
      const el = document.createElement('div');
      el.className = 'msg ' + (mine ? 'mine' : 'theirs');
      el.dataset.id = m.id;

      const ts = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : null;
      const time = ts ? ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      const edited = !!m.editedAt;

      if (editingMsgId === m.id && canEdit) {
        el.innerHTML = `${mine ? '' : `<div class="msg-author">${escapeHTML(m.name || 'Alguém')}</div>`}
          <div class="msg-edit-row">
            <textarea maxlength="1000" class="msg-edit-input">${escapeHTML(m.text || '')}</textarea>
            <div class="msg-edit-actions">
              <button type="button" class="btn btn-ghost btn-sm msg-cancel">Cancelar</button>
              <button type="button" class="btn btn-primary btn-sm msg-save" style="width:auto;margin:0">Salvar</button>
            </div>
          </div>`;
        const ta = el.querySelector('.msg-edit-input');
        el.querySelector('.msg-cancel').onclick = () => {
          editingMsgId = null;
          renderChat();
        };
        el.querySelector('.msg-save').onclick = () => salvarEdicaoMsg(m.id, ta.value);
        box.appendChild(el);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        return;
      }

      const actions = canEdit || canDelete
        ? `<div class="msg-actions">
            ${canEdit ? '<button type="button" class="msg-edit">Editar</button>' : ''}
            ${canDelete ? '<button type="button" class="danger msg-del">Apagar</button>' : ''}
          </div>`
        : '';

      el.innerHTML = `${mine ? '' : `<div class="msg-author">${escapeHTML(m.name || 'Alguém')}</div>`}
        <div class="msg-text">${escapeHTML(m.text || '')}</div>
        <div class="msg-meta">
          <span class="msg-time${edited ? ' msg-edited' : ''}">${time}${edited ? ' · editada' : ''}</span>
          ${actions}
        </div>`;

      const editBtn = el.querySelector('.msg-edit');
      const delBtn = el.querySelector('.msg-del');
      if (editBtn) {
        editBtn.onclick = () => {
          editingMsgId = m.id;
          renderChat();
        };
      }
      if (delBtn) {
        delBtn.onclick = () => apagarMsg(m);
      }
      box.appendChild(el);
    });
    if (nearBottom || editingMsgId) box.scrollTop = box.scrollHeight;
  }

  async function salvarEdicaoMsg(id, raw) {
    const text = String(raw || '').trim();
    if (!text) {
      toast('Mensagem vazia');
      return;
    }
    if (text.length > 1000) {
      toast('Máximo 1000 caracteres');
      return;
    }
    const payload = {
      text,
      editedAt: navigator.onLine ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
    };
    await runWrite({ action: 'updateMessage', docId: id, payload });
    editingMsgId = null;
    toast('Mensagem editada');
  }

  async function apagarMsg(m) {
    const mine = m.uid === currentUser.uid;
    const label = mine ? 'Apagar sua mensagem?' : 'Apagar mensagem de ' + (m.name || 'membro') + '?';
    const ok = await appConfirm(label, { title: 'Apagar mensagem', okText: 'Apagar' });
    if (!ok) return;
    await runWrite({ action: 'deleteMessage', docId: m.id });
    if (editingMsgId === m.id) editingMsgId = null;
    toast('Mensagem apagada');
  }

  async function enviarMsg() {
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text || !groupId) return;
    input.value = '';
    const payload = {
      text,
      uid: currentUser.uid,
      name: userProfile.name || currentUser.displayName || 'Alguém',
      createdAt: new Date()
    };
    await runWrite({ action: 'addMessage', payload });
    if (!navigator.onLine) {
      messages = [...messages, { id: 'local-' + Date.now(), ...payload }];
      saveLocalCache('messages', messages);
      renderChat();
    }
    toast(navigator.onLine ? 'Mensagem enviada' : 'Mensagem salva offline');
  }

  async function salvarConfigGrupo() {
    $('cfg-error').textContent = '';
    if (!groupId) return;
    if (!isCreator()) {
      $('cfg-error').textContent = 'Somente o criador pode alterar o PIX.';
      return;
    }
    const chave = normalizePixKey($('cfg-pix-key').value);
    const nome = $('cfg-pix-name').value.trim();
    const cidade = $('cfg-pix-city').value.trim();
    if (!chave) {
      $('cfg-error').textContent = 'Informe a chave PIX.';
      return;
    }
    if (!nome) {
      $('cfg-error').textContent = 'Informe o nome do recebedor.';
      return;
    }
    if (!cidade) {
      $('cfg-error').textContent = 'Informe a cidade.';
      return;
    }
    try {
      // valida gerando um payload de teste (R$ 1,00)
      const test = gerarPixPayload(chave, nome, cidade, 1);
      if (!validatePixPayload(test)) throw new Error('Chave/nome/cidade geram PIX inválido');
      await db.collection('groups').doc(groupId).update({
        pix: { chave, nome, cidade }
      });
      $('cfg-pix-key').value = chave;
      updatePixKeyPreview();
      toast('PIX salvo — chave: ' + chave);
    } catch (err) {
      $('cfg-error').textContent = err.message || 'Erro ao salvar.';
    }
  }

  async function copiarConvite() {
    const code = currentGroup && currentGroup.inviteCode;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    toast('Código copiado');
  }

  async function sairDoGrupo() {
    if (isCreator()) {
      toast('Como criador, use “Apagar grupo” (ou promova alguém e peça para recriar).');
      return;
    }
    const ok = await appConfirm('Sair deste grupo? Você deixará de ver despesas, compras e chat.', {
      title: 'Sair do grupo',
      okText: 'Sair'
    });
    if (!ok) return;
    const gid = groupId;
    try {
      if (gid && currentGroup) {
        const members = (currentGroup.members || []).filter((x) => x.uid !== currentUser.uid);
        const memberIds = (currentGroup.memberIds || []).filter((id) => id !== currentUser.uid);
        const nextAdmins = adminIds().filter((id) => id !== currentUser.uid);
        await db.collection('groups').doc(gid).update({ members, memberIds, adminIds: nextAdmins });
      }
    } catch (err) {
      console.warn(err);
      toast(err.message || 'Não foi possível sair');
      return;
    }
    clearListeners();
    await db.collection('users').doc(currentUser.uid).set({ groupId: null }, { merge: true });
    userProfile.groupId = null;
    groupId = null;
    currentGroup = null;
    showScreen('group-screen');
    toast('Você saiu do grupo');
  }

  async function fazerLogout() {
    clearListeners();
    await auth.signOut();
  }

  function gerarResumoEPix() {
    if (!expenses.length) return;
    const pix = (currentGroup && currentGroup.pix) || {};
    const chaveNorm = normalizePixKey(pix.chave || '');
    if (!chaveNorm) {
      toast('Configure a chave PIX em Grupo (e salve)');
      showPage('settings');
      return;
    }
    if (!(pix.nome || '').trim()) {
      toast('Informe o nome do recebedor no PIX (aba Grupo)');
      showPage('settings');
      return;
    }
    if (!(pix.cidade || '').trim()) {
      toast('Informe a cidade do PIX (aba Grupo)');
      showPage('settings');
      return;
    }
    const payers = payingMembers();
    const n = payers.length;
    if (n === 0) {
      toast('Convide membros — o criador não paga o rateio');
      showPage('settings');
      return;
    }

    let total = 0;
    let detalhes = '';
    expenses.forEach((g) => {
      total += Number(g.valor) || 0;
      detalhes += `• ${g.descricao}: R$ ${fmt(g.valor)}\n`;
    });
    if (total <= 0) {
      toast('Total inválido para gerar PIX');
      return;
    }
    const porPagante = Math.round((total / n) * 100) / 100;
    const creatorMember = ((currentGroup.members || []).find((m) => m.uid === currentGroup.createdBy) || {});
    const creatorName = creatorMember.name || pix.nome || 'Criador';

    let texto = `*FECHAMENTO — ${currentGroup.name || 'Grupo'}*\n\n`;
    texto += `*Despesas:*\n${detalhes}\n`;
    texto += `*Total: R$ ${fmt(total)}*\n`;
    texto += `*Pagantes (${n}):* ${payers.map((p) => p.name || 'Membro').join(', ')}\n`;
    texto += `*Valor por pagante: R$ ${fmt(porPagante)}*\n\n`;
    texto += `_O criador (${creatorName}) recebe e não paga._\n\n`;
    texto += `*Chave PIX:* ${chaveNorm}\n*Titular:* ${pix.nome || creatorName}\n`;

    try {
      pixPayloadAtual = gerarPixPayload(chaveNorm, pix.nome || creatorName, pix.cidade, porPagante);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao gerar código PIX');
      return;
    }
    if (!validatePixPayload(pixPayloadAtual)) {
      toast('Código PIX inválido — confira chave, nome e cidade');
      console.warn('PIX payload', pixPayloadAtual);
      return;
    }

    // Confirma que a chave no payload é a normalizada
    if (!pixPayloadAtual.includes(chaveNorm)) {
      toast('Chave não entrou no código PIX — tente salvar de novo');
      return;
    }

    $('pix-code-display').value = pixPayloadAtual;
    $('texto-grupo').value = texto;
    $('pix-modal-hint').textContent = (isCreator()
      ? `Você recebe. Cada pagante: R$ ${fmt(porPagante)}.`
      : `Sua parte: R$ ${fmt(porPagante)}.`) + ' Chave: ' + chaveNorm;
    // garante container do QR
    const wrap = $('qr-wrap');
    if (wrap && !wrap.querySelector('#qr-img')) {
      wrap.innerHTML = '<img id="qr-img" alt="QR Code PIX">';
    }
    renderQr(pixPayloadAtual);
    $('btn-copy-text').textContent = 'Copiar texto WhatsApp';
    $('btn-copy-text').classList.remove('copied');
    $('btn-copy-pix').textContent = 'Copiar Pix Copia e Cola';
    $('pix-modal').classList.add('active');

    notifyUser('PIX gerado', `Valor por pagante: R$ ${fmt(porPagante)}`, 'pix-ready-' + Date.now(), {
      force: true,
      page: 'expenses',
      url: '/?page=expenses'
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (__) {
        return false;
      }
    }
  }

  function fecharModal() {
    $('pix-modal').classList.remove('active');
  }

  async function copiarTextoGrupo() {
    const ok = await copyText($('texto-grupo').value);
    if (!ok) {
      toast('Não foi possível copiar — selecione o texto manualmente');
      return;
    }
    const b = $('btn-copy-text');
    b.textContent = 'Texto copiado';
    b.classList.add('copied');
    setTimeout(() => {
      b.textContent = 'Copiar texto WhatsApp';
      b.classList.remove('copied');
    }, 2200);
  }

  async function copiarPixCopieCola() {
    if (!pixPayloadAtual || !validatePixPayload(pixPayloadAtual)) {
      toast('Gere o PIX novamente');
      return;
    }
    const ok = await copyText(pixPayloadAtual);
    if (!ok) {
      $('pix-code-display').select();
      toast('Selecione e copie o código manualmente');
      return;
    }
    const b = $('btn-copy-pix');
    b.textContent = 'Código PIX copiado';
    setTimeout(() => {
      b.textContent = 'Copiar Pix Copia e Cola';
    }, 2200);
  }

  /* ========== Install PWA ========== */
  function updateInstallUI() {
    const installed = isStandaloneDisplay();
    const headerBtn = $('btn-install-header');
    const card = $('install-card');
    const hint = $('install-hint');
    const installBtn = $('btn-install-settings');

    if (headerBtn) headerBtn.classList.toggle('hidden', installed);
    if (card) card.classList.toggle('hidden', installed);

    if (installed) {
      $('install-banner').classList.remove('show');
      return;
    }

    if (hint) {
      if (deferredInstallPrompt) {
        hint.textContent = 'Seu navegador permite instalar com um toque.';
      } else if (isIos()) {
        hint.textContent = 'No iPhone/iPad, use o Safari: Compartilhar → Adicionar à Tela de Início.';
      } else {
        hint.textContent = 'Use o botão abaixo ou o menu do navegador (Instalar app / Adicionar à tela inicial).';
      }
    }
    if (installBtn) {
      installBtn.textContent = deferredInstallPrompt ? 'Instalar agora' : 'Ver como instalar';
    }

    if (deferredInstallPrompt && !localStorage.getItem('gf_install_dismissed')) {
      $('install-banner').classList.add('show');
    }
  }

  async function promptInstall() {
    if (isStandaloneDisplay()) {
      toast('App já está instalado');
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $('install-banner').classList.remove('show');
      updateInstallUI();
      if (choice && choice.outcome === 'accepted') toast('Instalando…');
      return;
    }
    const howto = $('install-howto');
    if (howto) howto.classList.remove('hidden');
    showPage('settings');
    if (isIos()) {
      toast('Safari → Compartilhar → Tela de Início');
    } else {
      toast('Menu do navegador → Instalar app');
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updateInstallUI();
  });

  window.addEventListener('appinstalled', () => {
    $('install-banner').classList.remove('show');
    deferredInstallPrompt = null;
    updateInstallUI();
    toast('App instalado');
  });

  /* ========== Wire UI ========== */
  $('tab-login').onclick = () => setAuthTab('login');
  $('tab-register').onclick = () => setAuthTab('register');
  $('auth-form').onsubmit = handleAuth;
  $('btn-criar-grupo').onclick = criarGrupo;
  $('btn-entrar-grupo').onclick = entrarGrupo;
  $('btn-logout-group').onclick = fazerLogout;
  $('btn-logout').onclick = fazerLogout;
  $('btn-settings').onclick = () => showPage('settings');
  $('btn-add-expense').onclick = adicionarGasto;
  $('btn-gerar-pix').onclick = gerarResumoEPix;
  $('btn-undo').onclick = apagarUltimo;
  $('btn-clear').onclick = limparTudo;
  $('btn-add-shop').onclick = adicionarCompra;
  $('btn-send-msg').onclick = enviarMsg;
  $('btn-save-cfg').onclick = salvarConfigGrupo;
  if ($('cfg-pix-key')) {
    $('cfg-pix-key').addEventListener('input', updatePixKeyPreview);
    $('cfg-pix-key').addEventListener('change', updatePixKeyPreview);
  }
  $('btn-copy-invite').onclick = copiarConvite;
  $('btn-leave-group').onclick = sairDoGrupo;
  if ($('btn-delete-group')) $('btn-delete-group').onclick = apagarGrupo;
  $('btn-enable-notifs').onclick = () => ensureNotifPermission(true);
  if ($('btn-test-notif')) {
    $('btn-test-notif').onclick = async () => {
      const ok = await ensureNotifPermission(true);
      if (!ok) {
        toast('Ative as notificações primeiro');
        return;
      }
      const shown = await notifyUser(
        'Teste Casa Share',
        'Se você viu este alerta, as notificações estão ok neste aparelho.',
        'test-notif-' + Date.now(),
        { force: true, alsoNative: true }
      );
      if (shown) toast('Notificação de teste enviada');
    };
  }
  $('btn-close-modal').onclick = fecharModal;
  $('btn-copy-text').onclick = copiarTextoGrupo;
  $('btn-copy-pix').onclick = copiarPixCopieCola;
  $('confirm-ok').onclick = () => closeConfirm(true);
  $('confirm-cancel').onclick = () => closeConfirm(false);
  $('confirm-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeConfirm(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('confirm-modal').classList.contains('active')) closeConfirm(false);
  });

  document.querySelectorAll('.bottom-nav button').forEach((btn) => {
    btn.onclick = () => showPage(btn.dataset.page);
  });
  document.querySelectorAll('.shop-filters .chip').forEach((c) => {
    c.onclick = () => setShopFilter(c.dataset.filter);
  });

  $('shop-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionarCompra();
    }
  });
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      enviarMsg();
    }
  });
  $('input-descricao').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('input-valor').focus();
    }
  });
  $('input-valor').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionarGasto();
    }
  });

  $('pix-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) fecharModal();
  });

  async function onInstallClick() {
    await promptInstall();
  }
  if ($('btn-install')) $('btn-install').onclick = onInstallClick;
  if ($('btn-install-header')) $('btn-install-header').onclick = onInstallClick;
  if ($('btn-install-settings')) $('btn-install-settings').onclick = onInstallClick;
  if ($('btn-install-howto')) {
    $('btn-install-howto').onclick = () => {
      const howto = $('install-howto');
      if (howto) howto.classList.toggle('hidden');
    };
  }
  if ($('btn-install-dismiss')) {
    $('btn-install-dismiss').onclick = () => {
      localStorage.setItem('gf_install_dismissed', '1');
      $('install-banner').classList.remove('show');
    };
  }

  const params = new URLSearchParams(location.search);
  const pageParam = params.get('page');
  if (pageParam && ['expenses', 'shopping', 'chat', 'settings'].includes(pageParam)) {
    setTimeout(() => {
      if (!$('app-shell').classList.contains('hidden')) showPage(pageParam);
    }, 1500);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
        .register('/sw.js?v=17', { updateViaCache: 'none' })
        .then((reg) => {
          reg.update().catch(() => {});
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!sessionStorage.getItem('gf_sw_reloaded')) {
              sessionStorage.setItem('gf_sw_reloaded', '1');
              location.reload();
            }
          });
          updateInstallUI();
        })
        .catch(() => {
          navigator.serviceWorker.register('./sw.js?v=17', { updateViaCache: 'none' }).catch(() => {});
        });
    }

  updateOfflineUI();
  updateInstallUI();
  if ($('notif-status') && typeof Notification !== 'undefined') {
    ensureNotifPermission(false);
  }
})();

