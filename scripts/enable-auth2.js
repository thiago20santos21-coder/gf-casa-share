const fs = require('fs');
const path = require('path');
const https = require('https');

const cfgPath = path.join(process.env.USERPROFILE, '.config', 'configstore', 'firebase-tools.json');
const j = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const token = j.tokens.access_token;
const project = 'gf-casa-share';

function req(method, url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'X-Goog-User-Project': project,
      ...extraHeaders,
    };
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
  // Try Google Identity Toolkit legacy init used by Firebase Console
  const urls = [
    ['POST', `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, {
      name: `projects/${project}/config`,
      signIn: { email: { enabled: true, passwordRequired: true }, anonymous: { enabled: false } },
    }],
    ['PUT', `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, {
      signIn: { email: { enabled: true, passwordRequired: true } },
    }],
    // Firebase Management notify / activate Auth
    ['POST', `https://firebase.googleapis.com/v1beta1/projects/${project}/availableLocations`, null],
    ['GET', `https://firebase.googleapis.com/v1beta1/projects/${project}`, null],
    // Tooling API used by console "Get started"
    ['POST', `https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`, {}],
    // Create empty config via identitytoolkit v1
    ['POST', `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?projectId=${project}`, null],
    ['POST', `https://www.googleapis.com/identitytoolkit/v3/relyingparty/setProjectConfig?key=AIzaSyCAlPFtxbhhsf1ZEpazvjGuYgrJN0_6aso`, {
      projectId: project,
      allowPasswordUser: true,
      enableAnonymousUser: false,
    }],
  ];

  for (const [method, url, body] of urls) {
    const r = await req(method, url, body);
    console.log('\n---', method, url.replace(/https:\/\/[^/]+/, ''));
    console.log(r.status, r.body.slice(0, 500));
  }
})().catch((e) => { console.error(e); process.exit(1); });
