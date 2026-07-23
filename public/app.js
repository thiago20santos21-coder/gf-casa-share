/* Casa Share â€” app logic */
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
  let notifPermission = (typeof Notification !== 'undefined' && Notification.permission) || 'default';

  function markSnapshotWarm() {
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
      'auth/email-already-in-use': 'Este e-mail jÃ¡ estÃ¡ em uso.',
      'auth/invalid-email': 'E-mail invÃ¡lido.',
      'auth/weak-password': 'Senha fraca (mÃ­n. 6 caracteres).',
      'auth/user-not-found': 'Conta nÃ£o encontrada.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/invalid-credential': 'E-mail ou senha invÃ¡lidos.',
      'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco.',
      'auth/configuration-not-found':
        'Auth ainda nÃ£o foi ativado no Firebase Console. Abra Authentication â†’ ComeÃ§ar â†’ E-mail/senha.',
      'auth/operation-not-allowed': 'Login por e-mail ainda nÃ£o estÃ¡ habilitado no Firebase Console.'
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

  async function queueCount() {
    const all = await queueAll();
    return all.length;
  }

  async function updateOfflineUI() {
    const online = navigator.onLine;
    const pending = await queueCount();
    $('pill-live').classList.toggle('hidden', !online);
    $('pill-offline').classList.toggle('hidden', online && pending === 0);
    if (!online) {
      $('pill-offline').textContent = pending ? `Offline â€” ${pending} na fila` : 'Offline';
    } else if (pending) {
      $('pill-offline').classList.remove('hidden');
      $('pill-offline').textContent = `Sincronizando ${pending}â€¦`;
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
    if (!left) toast('AlteraÃ§Ãµes sincronizadas');
    await updateOfflineUI();
  }

  async function runWrite(op) {
    op.groupId = op.groupId || groupId;
    if (!navigator.onLine) {
      await queueAdd(op);
      await updateOfflineUI();
      toast('Salvo offline â€” sincroniza ao conectar');
      return { offline: true };
    }
    try {
      await executeQueuedOp(op);
      return { offline: false };
    } catch (err) {
      await queueAdd(op);
      await updateOfflineUI();
      toast('Sem conexÃ£o estÃ¡vel â€” na fila');
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
      if (statusEl) statusEl.textContent = 'Este navegador nÃ£o suporta notificaÃ§Ãµes.';
      return false;
    }
    if (Notification.permission === 'granted') {
      notifPermission = 'granted';
      if (statusEl) statusEl.textContent = 'NotificaÃ§Ãµes ativas neste aparelho.';
      return true;
    }
    if (Notification.permission === 'denied') {
      if (statusEl) statusEl.textContent = 'Bloqueadas nas configuraÃ§Ãµes do navegador/sistema. Ative manualmente.';
      return false;
    }
    if (!interactive) {
      if (statusEl) statusEl.textContent = 'Toque em â€œAtivar notificaÃ§Ãµesâ€ para receber alertas.';
      return false;
    }
    const res = await Notification.requestPermission();
    notifPermission = res;
    if (res === 'granted') {
      if (statusEl) statusEl.textContent = 'NotificaÃ§Ãµes ativas neste aparelho.';
      await notifyUser('Casa Share', 'NotificaÃ§Ãµes ligadas. VocÃª serÃ¡ avisado de novidades no grupo.', 'notif-on', true);
      return true;
    }
    if (statusEl) statusEl.textContent = 'PermissÃ£o negada.';
    return false;
  }

  function notifIconUrl() {
    try {
      return new URL('/icons/icon-192.png', self.location.origin).href;
    } catch (_) {
      return '/icons/icon-192.png';
    }
  }

  /** @param {boolean} [force] ignore focus check (permission test / PIX) */
  async function notifyUser(title, body, tag, force) {
    if (!canNotify()) return;
    if (!force && !document.hidden && document.hasFocus()) return;
    const icon = notifIconUrl();
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title || 'Casa Share', {
        body: body || '',
        tag: tag || 'gf-update',
        icon,
        badge: icon,
        renotify: true,
        data: { url: '/' }
      });
    } catch (_) {
      try {
        new Notification(title || 'Casa Share', { body: body || '', tag, icon });
      } catch (__) {}
    }
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

  function gerarPixPayload(chave, nome, cidade, valor) {
    function tlv(id, val) {
      const l = String(val).length.toString().padStart(2, '0');
      return id + l + val;
    }
    const gui = tlv('00', 'br.gov.bcb.pix');
    const mai = tlv('26', gui + tlv('01', chave));
    let payload = '';
    payload += tlv('00', '01');
    payload += mai;
    payload += tlv('52', '0000');
    payload += tlv('53', '986');
    if (valor > 0) payload += tlv('54', Number(valor).toFixed(2));
    payload += tlv('58', 'BR');
    payload += tlv('59', (nome || 'RECEBEDOR').substring(0, 25).toUpperCase());
    payload += tlv('60', (cidade || 'SAO PAULO').substring(0, 15).toUpperCase());
    payload += tlv('62', tlv('05', '***'));
    payload += '6304';
    const bytes = [...payload].map((c) => c.charCodeAt(0));
    let crc = 0xffff;
    for (const b of bytes) {
      crc ^= b << 8;
      for (let i = 0; i < 8; i++) {
        if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
        else crc <<= 1;
        crc &= 0xffff;
      }
    }
    payload += crc.toString(16).toUpperCase().padStart(4, '0');
    return payload;
  }

  function renderQr(payload) {
    if (typeof qrcode !== 'function') return;
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    $('qr-img').src = qr.createDataURL(6, 4);
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
        name: user.displayName || (user.email || '').split('@')[0] || 'UsuÃ¡rio',
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
        name: userProfile.name || currentUser.displayName || 'UsuÃ¡rio',
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
      toast('Grupo criado â€” vocÃª recebe o PIX');
    } catch (err) {
      console.error(err);
      $('group-error').textContent = err.message || 'NÃ£o foi possÃ­vel criar o grupo.';
    }
  }

  async function resolveInvite(code) {
    const inv = await db.collection('invites').doc(code).get();
    if (inv.exists) {
      const data = inv.data() || {};
      if (!data.groupId) throw new Error('Convite incompleto. PeÃ§a um novo cÃ³digo.');
      return { groupId: data.groupId, groupName: data.groupName || '' };
    }
    // Fallback: some older groups may only store inviteCode on the group doc.
    // Requires get-by-id; without list permission we can't query â€” recreate invite index.
    throw new Error('CÃ³digo invÃ¡lido. Confira se digitou certo (sem espaÃ§os).');
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
        if (!gSnap.exists) throw new Error('Grupo nÃ£o encontrado para este cÃ³digo.');
        const data = gSnap.data();
        if ((data.memberIds || []).includes(currentUser.uid)) return;
        const member = {
          uid: currentUser.uid,
          name: userProfile.name || currentUser.displayName || 'UsuÃ¡rio',
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
      let msg = err.message || 'NÃ£o foi possÃ­vel entrar.';
      if (err.code === 'permission-denied') {
        msg = 'Sem permissÃ£o para entrar neste grupo. Atualize a pÃ¡gina e tente de novo.';
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
    updateOfflineUI();
    flushQueue();
    ensureNotifPermission(false);

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
            toast('VocÃª foi removido do grupo');
            return;
          }
          // Backfill adminIds for older groups (creator only)
          if (!Array.isArray(data.adminIds) && data.createdBy === currentUser.uid) {
            try {
              await db.collection('groups').doc(gid).update({ adminIds: [] });
            } catch (_) {}
          }
          currentGroup = data;
          renderGroupMeta();
          updateInstallUI();
        },
        (err) => console.error('group listen', err)
      );

    unsubExpenses = db
      .collection('groups')
      .doc(gid)
      .collection('expenses')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        (snap) => {
          const prevReady = listenersReady;
          expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          if (prevReady) {
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'added' && !seenExpense.has(ch.doc.id)) {
                const data = ch.doc.data();
                if (data.createdBy !== currentUser.uid) {
                  notifyUser('Nova despesa', `${data.createdByName || 'AlguÃ©m'}: ${data.descricao} â€” R$ ${fmt(data.valor)}`, 'expense-' + ch.doc.id);
                }
              }
              seenExpense.add(ch.doc.id);
            });
          } else {
            snap.docs.forEach((d) => seenExpense.add(d.id));
            markSnapshotWarm();
          }
          renderExpenses();
        },
        (err) => console.error('expenses listen', err)
      );

    unsubShopping = db
      .collection('groups')
      .doc(gid)
      .collection('shopping')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        (snap) => {
          const prevReady = listenersReady;
          shopping = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          if (prevReady) {
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'added' && !seenShop.has(ch.doc.id)) {
                const data = ch.doc.data();
                if (data.createdBy !== currentUser.uid) {
                  notifyUser('Lista de compras', `${data.createdByName || 'AlguÃ©m'} adicionou: ${data.text}`, 'shop-' + ch.doc.id);
                }
              }
              if (ch.type === 'modified') {
                const data = ch.doc.data();
                if (data.done && data.doneBy && data.doneBy !== currentUser.uid) {
                  notifyUser('Item comprado', `${data.doneByName || 'AlguÃ©m'} comprou: ${data.text}`, 'shop-done-' + ch.doc.id);
                }
              }
              seenShop.add(ch.doc.id);
            });
          } else {
            snap.docs.forEach((d) => seenShop.add(d.id));
            markSnapshotWarm();
          }
          renderShopping();
        },
        (err) => console.error('shopping listen', err)
      );

    unsubMessages = db
      .collection('groups')
      .doc(gid)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .limitToLast(100)
      .onSnapshot(
        (snap) => {
          const prevReady = listenersReady;
          messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          if (prevReady) {
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'added' && !seenMsg.has(ch.doc.id)) {
                const data = ch.doc.data();
                if (data.uid !== currentUser.uid) {
                  notifyUser(data.name || 'Chat', data.text, 'msg-' + ch.doc.id);
                }
              }
              seenMsg.add(ch.doc.id);
            });
          } else {
            snap.docs.forEach((d) => seenMsg.add(d.id));
            markSnapshotWarm();
          }
          renderChat();
        },
        (err) => console.error('chat listen', err)
      );
  }

  function renderGroupMeta() {
    if (!currentGroup) return;
    $('group-title').textContent = currentGroup.name || 'Grupo';
    $('invite-code-display').textContent = currentGroup.inviteCode || '------';
    $('cfg-pix-key').value = (currentGroup.pix && currentGroup.pix.chave) || '';
    $('cfg-pix-name').value = (currentGroup.pix && currentGroup.pix.nome) || '';
    $('cfg-pix-city').value = (currentGroup.pix && currentGroup.pix.cidade) || '';

    const creator = isCreator();
    const admin = isAdmin();
    const roleLabel = creator ? 'Criador' : admin ? 'Admin' : 'Membro';

    $('account-info').textContent =
      (userProfile && userProfile.name ? userProfile.name + ' Â· ' : '') +
      (currentUser.email || '') +
      ' Â· ' +
      roleLabel;

    const roleBanner = $('role-banner-text');
    if (roleBanner) {
      roleBanner.textContent = creator
        ? 'VocÃª Ã© o CRIADOR: edita PIX, promove admins, remove membros e pode apagar o grupo.'
        : admin
          ? 'VocÃª Ã© ADMIN: pode remover membros e moderar conteÃºdo. PIX sÃ³ o criador edita.'
          : 'VocÃª Ã© MEMBRO: use despesas/compras/chat. Pode sair do grupo. PIX Ã© sÃ³ leitura.';
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
        ? 'Somente vocÃª (criador) pode alterar a chave PIX.'
        : 'PIX bloqueado para ediÃ§Ã£o â€” somente o criador altera.';
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
        ? 'Como criador, use Apagar grupo (nÃ£o Ã© possÃ­vel â€œsairâ€ sem apagar).'
        : 'Use Sair deste grupo para deixar o espaÃ§o compartilhado.';
    }

    const membersHelp = $('members-help');
    if (membersHelp) {
      const others = (currentGroup.members || []).filter((m) => m.uid !== currentGroup.createdBy);
      if (creator && others.length === 0) {
        membersHelp.textContent = 'Convide alguÃ©m com o cÃ³digo acima. Depois aparecerÃ£o botÃµes Tornar admin / Remover.';
      } else if (creator) {
        membersHelp.textContent = 'BotÃµes por membro: Tornar admin, Remover admin, Remover do grupo.';
      } else if (admin) {
        membersHelp.textContent = 'Como admin, vocÃª pode Remover outros membros (exceto o criador).';
      } else {
        membersHelp.textContent = 'Somente criador/admin gerenciam a lista.';
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
      if (isRecv) tags += '<span class="member-tag">Criador Â· Recebe</span>';
      else if (userIsAdmin) tags += '<span class="member-tag admin">Admin Â· Paga</span>';
      else tags += '<span class="member-tag muted">Membro Â· Paga</span>';

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
      toast(err.message || 'Falha ao atualizar admin (permissÃ£o/regras)');
    }
  }

  async function removerMembro(m) {
    if (!isAdmin() || !groupId) return;
    if (m.uid === currentGroup.createdBy) {
      toast('NÃ£o Ã© possÃ­vel remover o criador');
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
      'Apagar permanentemente â€œ' + name + 'â€? Despesas, compras, chat e convite serÃ£o removidos.',
      { title: 'Apagar grupo', okText: 'Continuar' }
    );
    if (!ok1) return;
    const ok2 = await appConfirm('Tem certeza? Esta aÃ§Ã£o nÃ£o pode ser desfeita.', {
      title: 'ConfirmaÃ§Ã£o final',
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
    $('total-por-pessoa').textContent = n > 0 ? `R$ ${fmt(porPagante)}` : 'â€”';
    $('total-itens').textContent = expenses.length;
    $('label-por-pessoa').textContent = n > 0 ? `Por pagante (Ã·${n})` : 'Sem pagantes';
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
      createdByName: userProfile.name || currentUser.displayName || 'AlguÃ©m',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // offline: serverTimestamp can't be queued as FieldValue â€” use Date
    const offlinePayload = {
      ...payload,
      createdAt: new Date()
    };
    if (!navigator.onLine) {
      await runWrite({ action: 'addExpense', payload: offlinePayload });
    } else {
      await runWrite({ action: 'addExpense', payload });
    }
    iD.value = '';
    iV.value = '';
    iD.focus();
    if (navigator.onLine) toast('Despesa adicionada');
  }

  async function removerGasto(id) {
    if (!groupId || !id) return;
    await runWrite({ action: 'deleteExpense', docId: id });
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
    await runWrite({ action: 'clearExpenses', docIds: expenses.map((g) => g.id) });
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
        <button class="shop-check" type="button" aria-label="Marcar">${item.done ? 'âœ“' : ''}</button>
        <div class="shop-body">
          <div class="shop-text">${escapeHTML(item.text)}</div>
          <div class="shop-by">${
            item.done
              ? 'Comprado' + (item.doneByName ? ' por ' + escapeHTML(item.doneByName) : '')
              : 'Por ' + escapeHTML(item.createdByName || 'alguÃ©m')
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
      createdByName: userProfile.name || currentUser.displayName || 'AlguÃ©m',
      createdAt: navigator.onLine ? firebase.firestore.FieldValue.serverTimestamp() : new Date(),
      doneBy: null,
      doneByName: null
    };
    await runWrite({ action: 'addShop', payload });
    input.value = '';
    input.focus();
    if (shopFilter === 'done') setShopFilter('pending');
  }

  async function toggleCompra(item) {
    const payload = {
      done: !item.done,
      doneBy: !item.done ? currentUser.uid : null,
      doneByName: !item.done ? userProfile.name || currentUser.displayName || 'AlguÃ©m' : null,
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
        el.innerHTML = `${mine ? '' : `<div class="msg-author">${escapeHTML(m.name || 'AlguÃ©m')}</div>`}
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

      el.innerHTML = `${mine ? '' : `<div class="msg-author">${escapeHTML(m.name || 'AlguÃ©m')}</div>`}
        <div class="msg-text">${escapeHTML(m.text || '')}</div>
        <div class="msg-meta">
          <span class="msg-time${edited ? ' msg-edited' : ''}">${time}${edited ? ' Â· editada' : ''}</span>
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
      toast('MÃ¡ximo 1000 caracteres');
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
      name: userProfile.name || currentUser.displayName || 'AlguÃ©m',
      createdAt: navigator.onLine ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
    };
    await runWrite({ action: 'addMessage', payload });
  }

  async function salvarConfigGrupo() {
    $('cfg-error').textContent = '';
    if (!groupId) return;
    if (!isCreator()) {
      $('cfg-error').textContent = 'Somente o criador pode alterar o PIX.';
      return;
    }
    try {
      await db.collection('groups').doc(groupId).update({
        pix: {
          chave: $('cfg-pix-key').value.trim(),
          nome: $('cfg-pix-name').value.trim(),
          cidade: $('cfg-pix-city').value.trim()
        }
      });
      toast('PIX salvo');
    } catch (err) {
      $('cfg-error').textContent = err.message || 'Erro ao salvar.';
    }
  }

  async function copiarConvite() {
    const code = currentGroup && currentGroup.inviteCode;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    toast('CÃ³digo copiado');
  }

  async function sairDoGrupo() {
    if (isCreator()) {
      toast('Como criador, use â€œApagar grupoâ€ (ou promova alguÃ©m e peÃ§a para recriar).');
      return;
    }
    const ok = await appConfirm('Sair deste grupo? VocÃª deixarÃ¡ de ver despesas, compras e chat.', {
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
      toast(err.message || 'NÃ£o foi possÃ­vel sair');
      return;
    }
    clearListeners();
    await db.collection('users').doc(currentUser.uid).set({ groupId: null }, { merge: true });
    userProfile.groupId = null;
    groupId = null;
    currentGroup = null;
    showScreen('group-screen');
    toast('VocÃª saiu do grupo');
  }

  async function fazerLogout() {
    clearListeners();
    await auth.signOut();
  }

  function gerarResumoEPix() {
    if (!expenses.length) return;
    const pix = (currentGroup && currentGroup.pix) || {};
    if (!pix.chave) {
      toast('Configure a chave PIX em Grupo');
      showPage('settings');
      return;
    }
    const payers = payingMembers();
    const n = payers.length;
    if (n === 0) {
      toast('Convide membros â€” o criador nÃ£o paga o rateio');
      showPage('settings');
      return;
    }

    let total = 0;
    let detalhes = '';
    expenses.forEach((g) => {
      total += Number(g.valor) || 0;
      detalhes += `â€¢ ${g.descricao}: R$ ${fmt(g.valor)}\n`;
    });
    const porPagante = total / n;
    const creatorMember = ((currentGroup.members || []).find((m) => m.uid === currentGroup.createdBy) || {});
    const creatorName = creatorMember.name || pix.nome || 'Criador';

    let texto = `*FECHAMENTO â€” ${currentGroup.name || 'Grupo'}*\n\n`;
    texto += `*Despesas:*\n${detalhes}\n`;
    texto += `*Total: R$ ${fmt(total)}*\n`;
    texto += `*Pagantes (${n}):* ${payers.map((p) => p.name || 'Membro').join(', ')}\n`;
    texto += `*Valor por pagante: R$ ${fmt(porPagante)}*\n\n`;
    texto += `_O criador (${creatorName}) recebe e nÃ£o paga._\n\n`;
    texto += `*Chave PIX:* ${pix.chave}\n*Titular:* ${pix.nome || creatorName}\n`;

    pixPayloadAtual = gerarPixPayload(pix.chave, pix.nome || creatorName, pix.cidade, porPagante);
    $('pix-code-display').value = pixPayloadAtual;
    $('texto-grupo').value = texto;
    $('pix-modal-hint').textContent = isCreator()
      ? `VocÃª recebe. Cada pagante deve transferir R$ ${fmt(porPagante)}.`
      : `Sua parte: R$ ${fmt(porPagante)} (criador nÃ£o paga).`;
    renderQr(pixPayloadAtual);
    $('btn-copy-text').textContent = 'Copiar texto WhatsApp';
    $('btn-copy-text').classList.remove('copied');
    $('btn-copy-pix').textContent = 'Copiar Pix Copia e Cola';
    $('pix-modal').classList.add('active');

    notifyUser(
      'PIX gerado',
      `Valor por pagante: R$ ${fmt(porPagante)}`,
      'pix-ready-' + Date.now(),
      true
    );
  }

  function fecharModal() {
    $('pix-modal').classList.remove('active');
  }

  async function copiarTextoGrupo() {
    await navigator.clipboard.writeText($('texto-grupo').value);
    const b = $('btn-copy-text');
    b.textContent = 'Texto copiado';
    b.classList.add('copied');
    setTimeout(() => {
      b.textContent = 'Copiar texto WhatsApp';
      b.classList.remove('copied');
    }, 2200);
  }

  async function copiarPixCopieCola() {
    await navigator.clipboard.writeText(pixPayloadAtual);
    const b = $('btn-copy-pix');
    b.textContent = 'CÃ³digo PIX copiado';
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
        hint.textContent = 'No iPhone/iPad use Safari: Compartilhar â†’ Adicionar Ã  Tela de InÃ­cio.';
      } else {
        hint.textContent = 'Use o botÃ£o abaixo ou o menu do navegador (Instalar app / Adicionar Ã  tela inicial).';
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
      toast('App jÃ¡ estÃ¡ instalado');
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $('install-banner').classList.remove('show');
      updateInstallUI();
      if (choice && choice.outcome === 'accepted') toast('Instalandoâ€¦');
      return;
    }
    const howto = $('install-howto');
    if (howto) howto.classList.remove('hidden');
    showPage('settings');
    if (isIos()) {
      toast('Safari â†’ Compartilhar â†’ Tela de InÃ­cio');
    } else {
      toast('Menu do navegador â†’ Instalar app');
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
  $('btn-copy-invite').onclick = copiarConvite;
  $('btn-leave-group').onclick = sairDoGrupo;
  if ($('btn-delete-group')) $('btn-delete-group').onclick = apagarGrupo;
  $('btn-enable-notifs').onclick = () => ensureNotifPermission(true);
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
        .register('/sw.js?v=7', { updateViaCache: 'none' })
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
          navigator.serviceWorker.register('./sw.js?v=7', { updateViaCache: 'none' }).catch(() => {});
        });
    }

  updateOfflineUI();
  updateInstallUI();
  if ($('notif-status') && typeof Notification !== 'undefined') {
    ensureNotifPermission(false);
  }
})();

