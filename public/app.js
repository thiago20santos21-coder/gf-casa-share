/* GF Casa Share — app logic */
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
  function showScreen(name) {
    ['boot-screen', 'auth-screen', 'group-screen', 'app-shell'].forEach((id) => {
      $(id).classList.toggle('hidden', id !== name);
    });
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
      $('pill-offline').textContent = pending ? `Offline — ${pending} na fila` : 'Offline';
    } else if (pending) {
      $('pill-offline').classList.remove('hidden');
      $('pill-offline').textContent = `Sincronizando ${pending}…`;
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
    if (!navigator.onLine) {
      await queueAdd(op);
      await updateOfflineUI();
      toast('Salvo offline — sincroniza ao conectar');
      return { offline: true };
    }
    try {
      await executeQueuedOp(op);
      return { offline: false };
    } catch (err) {
      await queueAdd(op);
      await updateOfflineUI();
      toast('Sem conexão estável — na fila');
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
    if (typeof Notification === 'undefined') {
      $('notif-status').textContent = 'Este navegador não suporta notificações.';
      return false;
    }
    if (Notification.permission === 'granted') {
      notifPermission = 'granted';
      $('notif-status').textContent = 'Notificações ativadas neste aparelho.';
      return true;
    }
    if (Notification.permission === 'denied') {
      $('notif-status').textContent = 'Bloqueadas nas configurações do navegador/sistema.';
      return false;
    }
    if (!interactive) return false;
    const res = await Notification.requestPermission();
    notifPermission = res;
    if (res === 'granted') {
      $('notif-status').textContent = 'Notificações ativadas neste aparelho.';
      return true;
    }
    $('notif-status').textContent = 'Permissão negada.';
    return false;
  }

  async function notifyUser(title, body, tag) {
    if (!canNotify()) return;
    // Avoid notifying when user is focused on the relevant screen
    if (!document.hidden && document.hasFocus()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.active) {
      reg.active.postMessage({ type: 'NOTIFY', title, body, tag, url: './' });
    } else {
      new Notification(title, {
        body,
        tag,
        icon: './icons/icon-192.png'
      });
    }
  }

  /* ========== PIX helpers ========== */
  function isCreator() {
    return !!(currentGroup && currentUser && currentGroup.createdBy === currentUser.uid);
  }

  function payingMembers() {
    const members = (currentGroup && currentGroup.members) || [];
    const creatorId = currentGroup && currentGroup.createdBy;
    return members.filter((m) => m.uid !== creatorId);
  }

  function payingCount() {
    return Math.max(0, payingMembers().length);
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

  async function entrarGrupo() {
    $('group-error').textContent = '';
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length < 4) {
      $('join-code').classList.add('shake');
      setTimeout(() => $('join-code').classList.remove('shake'), 400);
      return;
    }
    try {
      const inv = await db.collection('invites').doc(code).get();
      if (!inv.exists) throw new Error('Código inválido.');
      const { groupId: gid, groupName } = inv.data();
      const gRef = db.collection('groups').doc(gid);
      await db.runTransaction(async (tx) => {
        const gSnap = await tx.get(gRef);
        if (!gSnap.exists) throw new Error('Grupo não encontrado.');
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
      console.error(err);
      $('group-error').textContent = err.message || 'Não foi possível entrar.';
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
        (snap) => {
          if (!snap.exists) {
            currentGroup = null;
            showScreen('group-screen');
            return;
          }
          currentGroup = { id: snap.id, ...snap.data() };
          renderGroupMeta();
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
                  notifyUser('Nova despesa', `${data.createdByName || 'Alguém'}: ${data.descricao} — R$ ${fmt(data.valor)}`, 'expense-' + ch.doc.id);
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
                  notifyUser('Lista de compras', `${data.createdByName || 'Alguém'} adicionou: ${data.text}`, 'shop-' + ch.doc.id);
                }
              }
              if (ch.type === 'modified') {
                const data = ch.doc.data();
                if (data.done && data.doneBy && data.doneBy !== currentUser.uid) {
                  notifyUser('Item comprado', `${data.doneByName || 'Alguém'} comprou: ${data.text}`, 'shop-done-' + ch.doc.id);
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
    $('account-info').textContent =
      (userProfile && userProfile.name ? userProfile.name + ' · ' : '') + (currentUser.email || '');

    const creator = isCreator();
    $('pill-receiver').classList.toggle('hidden', !creator);
    $('receiver-banner').classList.toggle('show', creator);

    const list = $('members-list');
    list.innerHTML = '';
    (currentGroup.members || []).forEach((m) => {
      const isRecv = m.uid === currentGroup.createdBy;
      const el = document.createElement('div');
      el.className = 'member';
      el.innerHTML = `<div class="avatar">${escapeHTML(initials(m.name))}</div>
        <div><div class="member-name">${escapeHTML(m.name || 'Membro')}</div>
        <div class="member-email">${escapeHTML(m.email || '')}</div></div>
        ${isRecv ? '<span class="member-tag">Recebe</span>' : '<span class="member-tag" style="color:var(--text-3)">Paga</span>'}`;
      list.appendChild(el);
    });
    renderExpenses();
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
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // offline: serverTimestamp can't be queued as FieldValue — use Date
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
    if (!confirm('Apagar todas as despesas do grupo?')) return;
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

  function renderChat() {
    const box = $('chat-msgs');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = '';
    if (!messages.length) {
      box.innerHTML = '<div class="empty">Nenhuma mensagem ainda.</div>';
      return;
    }
    messages.forEach((m) => {
      const mine = m.uid === currentUser.uid;
      const el = document.createElement('div');
      el.className = 'msg ' + (mine ? 'mine' : 'theirs');
      const ts = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : null;
      const time = ts ? ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      el.innerHTML = `${mine ? '' : `<div class="msg-author">${escapeHTML(m.name || 'Alguém')}</div>`}
        <div class="msg-text">${escapeHTML(m.text)}</div>
        <div class="msg-time">${time}</div>`;
      box.appendChild(el);
    });
    if (nearBottom) box.scrollTop = box.scrollHeight;
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
      createdAt: navigator.onLine ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
    };
    await runWrite({ action: 'addMessage', payload });
  }

  async function salvarConfigGrupo() {
    $('cfg-error').textContent = '';
    if (!groupId) return;
    try {
      await runWrite({
        action: 'updateGroup',
        payload: {
          pix: {
            chave: $('cfg-pix-key').value.trim(),
            nome: $('cfg-pix-name').value.trim(),
            cidade: $('cfg-pix-city').value.trim()
          }
        }
      });
      toast('Configurações salvas');
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
    if (!confirm('Sair deste grupo neste aparelho/conta?')) return;
    clearListeners();
    await db.collection('users').doc(currentUser.uid).set({ groupId: null }, { merge: true });
    userProfile.groupId = null;
    groupId = null;
    currentGroup = null;
    showScreen('group-screen');
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
    const porPagante = total / n;
    const creatorMember = ((currentGroup.members || []).find((m) => m.uid === currentGroup.createdBy) || {});
    const creatorName = creatorMember.name || pix.nome || 'Criador';

    let texto = `*FECHAMENTO — ${currentGroup.name || 'Grupo'}*\n\n`;
    texto += `*Despesas:*\n${detalhes}\n`;
    texto += `*Total: R$ ${fmt(total)}*\n`;
    texto += `*Pagantes (${n}):* ${payers.map((p) => p.name || 'Membro').join(', ')}\n`;
    texto += `*Valor por pagante: R$ ${fmt(porPagante)}*\n\n`;
    texto += `_O criador (${creatorName}) recebe e não paga._\n\n`;
    texto += `*Chave PIX:* ${pix.chave}\n*Titular:* ${pix.nome || creatorName}\n`;

    pixPayloadAtual = gerarPixPayload(pix.chave, pix.nome || creatorName, pix.cidade, porPagante);
    $('pix-code-display').value = pixPayloadAtual;
    $('texto-grupo').value = texto;
    $('pix-modal-hint').textContent = isCreator()
      ? `Você recebe. Cada pagante deve transferir R$ ${fmt(porPagante)}.`
      : `Sua parte: R$ ${fmt(porPagante)} (criador não paga).`;
    renderQr(pixPayloadAtual);
    $('btn-copy-text').textContent = 'Copiar texto WhatsApp';
    $('btn-copy-text').classList.remove('copied');
    $('btn-copy-pix').textContent = 'Copiar Pix Copia e Cola';
    $('pix-modal').classList.add('active');

    // Notify creator when someone generates payment? notify group when payment ready
    if (!isCreator()) {
      notifyUser('PIX pronto', `Valor por pagante: R$ ${fmt(porPagante)}`, 'pix-ready');
    }
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
    b.textContent = 'Código PIX copiado';
    setTimeout(() => {
      b.textContent = 'Copiar Pix Copia e Cola';
    }, 2200);
  }

  /* ========== Install PWA ========== */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!localStorage.getItem('gf_install_dismissed')) {
      $('install-banner').classList.add('show');
    }
  });

  window.addEventListener('appinstalled', () => {
    $('install-banner').classList.remove('show');
    deferredInstallPrompt = null;
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
  $('btn-enable-notifs').onclick = () => ensureNotifPermission(true);
  $('btn-close-modal').onclick = fecharModal;
  $('btn-copy-text').onclick = copiarTextoGrupo;
  $('btn-copy-pix').onclick = copiarPixCopieCola;

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

  $('btn-install').onclick = async () => {
    if (!deferredInstallPrompt) {
      toast('Use o menu do navegador: Instalar app');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('install-banner').classList.remove('show');
  };
  $('btn-install-dismiss').onclick = () => {
    localStorage.setItem('gf_install_dismissed', '1');
    $('install-banner').classList.remove('show');
  };

  // Deep link ?page=
  const params = new URLSearchParams(location.search);
  const pageParam = params.get('page');
  if (pageParam && ['expenses', 'shopping', 'chat', 'settings'].includes(pageParam)) {
    // will apply after app shell shows
    const orig = entrarNoApp;
    // no-op — showPage called after shell; hook via timeout when shell visible
    setTimeout(() => {
      if (!$('app-shell').classList.contains('hidden')) showPage(pageParam);
    }, 1500);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  updateOfflineUI();
})();
