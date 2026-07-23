/**
 * End-to-end invite join test against live Firebase.
 * Usage: node scripts/test-invite-join.js [CODE]
 */
const https = require('https');

const API_KEY = 'AIzaSyCAlPFtxbhhsf1ZEpazvjGuYgrJN0_6aso';
const PROJECT = 'gf-casa-share';
const CODE = (process.argv[2] || '62LU9F').toUpperCase();

function req(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const h = { 'Content-Type': 'application/json', ...headers };
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: h },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const email = `join_${Date.now()}@gf-test.local`;
  const password = 'JoinTest123!';
  const signup = await req('POST', `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    email,
    password,
    returnSecureToken: true,
  });
  if (signup.status !== 200) throw new Error('signup failed ' + signup.body);
  const { idToken, localId } = JSON.parse(signup.body);
  console.log('user', localId, email);

  const inv = await req(
    'GET',
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/invites/${CODE}`,
    null,
    { Authorization: 'Bearer ' + idToken }
  );
  console.log('invite get', inv.status);
  if (inv.status !== 200) throw new Error(inv.body);
  const invDoc = JSON.parse(inv.body);
  const groupId = invDoc.fields.groupId.stringValue;
  console.log('groupId', groupId);

  const gGet = await req(
    'GET',
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/groups/${groupId}`,
    null,
    { Authorization: 'Bearer ' + idToken }
  );
  console.log('group get', gGet.status);
  if (gGet.status !== 200) throw new Error('group get failed: ' + gGet.body.slice(0, 300));

  // Commit update: arrayUnion-like via write with current+new (read-modify-write for test)
  const g = JSON.parse(gGet.body);
  const memberIds = (g.fields.memberIds.arrayValue.values || []).map((v) => v.stringValue);
  if (memberIds.includes(localId)) {
    console.log('already member — OK');
    return;
  }
  memberIds.push(localId);
  const members = g.fields.members.arrayValue.values || [];
  members.push({
    mapValue: {
      fields: {
        uid: { stringValue: localId },
        name: { stringValue: 'Join Tester' },
        email: { stringValue: email },
      },
    },
  });

  const patch = await req(
    'PATCH',
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/groups/${groupId}?updateMask.fieldPaths=memberIds&updateMask.fieldPaths=members`,
    {
      fields: {
        memberIds: {
          arrayValue: { values: memberIds.map((id) => ({ stringValue: id })) },
        },
        members: { arrayValue: { values: members } },
      },
    },
    { Authorization: 'Bearer ' + idToken }
  );
  console.log('group join patch', patch.status, patch.body.slice(0, 250));
  if (patch.status !== 200) throw new Error('join failed');
  console.log('JOIN_OK');
})().catch((e) => {
  console.error('FAIL', e.message || e);
  process.exit(1);
});
