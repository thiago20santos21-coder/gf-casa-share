const fs = require('fs');
const path = require('path');
const https = require('https');

const cfgPath = path.join(process.env.USERPROFILE, '.config', 'configstore', 'firebase-tools.json');
const j = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const token = j.tokens.access_token;
const project = 'gf-casa-share';

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
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
  const attempts = [
    ['POST', `https://identitytoolkit.googleapis.com/v2/projects/${project}/identityPlatform:initializeAuth`, {}],
    ['POST', `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, {
      signIn: { email: { enabled: true, passwordRequired: true } }
    }],
    ['PATCH', `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config?updateMask=signIn.email`, {
      signIn: { email: { enabled: true, passwordRequired: true } }
    }],
    ['GET', `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, null],
    ['POST', `https://firebase.googleapis.com/v1beta1/projects/${project}/defaultLocation:finalize`, { locationId: 'southamerica-east1' }],
  ];

  for (const [method, url, body] of attempts) {
    const r = await req(method, url, body);
    console.log('\n---', method, url.split('.com')[1] || url);
    console.log(r.status, r.body.slice(0, 600));
  }
})().catch((e) => { console.error(e); process.exit(1); });
