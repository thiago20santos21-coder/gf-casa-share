const fs = require('fs');
const path = require('path');
const https = require('https');

const cfgPath = path.join(process.env.USERPROFILE, '.config', 'configstore', 'firebase-tools.json');
const j = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const token = j.tokens.access_token;
const project = 'gf-casa-share';
const apiKey = 'AIzaSyCAlPFtxbhhsf1ZEpazvjGuYgrJN0_6aso';

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': project,
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
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
  const patch = await req(
    'PATCH',
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
    { signIn: { email: { enabled: true, passwordRequired: true } } }
  );
  console.log('patch config', patch.status, patch.body.slice(0, 500));

  const data = JSON.stringify({
    email: 'probe@gf-casa-share.test',
    password: 'ProbeTest123!',
    returnSecureToken: true,
  });
  const signup = await new Promise((resolve, reject) => {
    const r = https.request(
      {
        hostname: 'identitytoolkit.googleapis.com',
        path: '/v1/accounts:signUp?key=' + apiKey,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      }
    );
    r.on('error', reject);
    r.write(data);
    r.end();
  });
  console.log('signup probe', signup.status, signup.body.slice(0, 500));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
