const { test, before, after } = require('node:test'), assert = require('node:assert/strict'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const dbFile = path.join(os.tmpdir(), 'jp-test-' + Date.now() + '.db');
Object.assign(process.env, { DB_PATH: dbFile, ADMIN_EMAIL: 'boss@x.com', ADMIN_PASSWORD: 'AdminPass123', FIRECRAWL_API_KEY: 'fc-test', ANTHROPIC_API_KEY: 'sk-test',
  PAYMENT_INFO: 'JazzCash 0300-1234567', APP_NAME: 'TestPilot', FIRECRAWL_CONCURRENCY: '2', RATE_SIGNUP: '1000', RATE_LOGIN: '1000' });

// ---- fake Firecrawl + fake Anthropic ----
const calls = { search: 0, searchBodies: [], markdown: [], json: [], ai: 0 };
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const b = body ? JSON.parse(body) : {}, send = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer fc-test' && req.url.startsWith('/v2')) return send({ success: false, error: 'bad key' }, 401);
    if (req.url === '/v2/search') {
      calls.search++; calls.searchBodies.push(b);
      const web = [];
      for (let i = 1; i <= Math.min(b.limit, 40); i++) web.push({ title: `Data Analyst ${i} - Company${i} | Careers`, url: `https://company${i}.com/jobs/${i}`, description: `Apply now. SQL python reporting dashboards role number ${i}` });
      web.splice(1, 0, { title: 'Data Analyst - LinkedIn', url: 'https://www.linkedin.com/jobs/view/123', description: 'Data analyst job' },
        { title: 'Data Analyst jobs in Lahore', url: 'https://pk.indeed.com/viewjob?jk=abc', description: 'hiring now' },
        { title: 'Best tacos in town', url: 'https://blog.example.com/tacos', description: 'food review' },
        { title: '<img src=x onerror=alert(1)> Data Analyst Jobs', url: 'https://evil.example.com/jobs/9', description: '<script>alert(1)</script> sql' },
        { title: 'Data analyst job', url: 'javascript:alert(1)', description: 'job' });
      return send({ success: true, data: { web } });
    }
    if (req.url === '/v2/scrape') {
      if (typeof b.formats[0] === 'string') { calls.markdown.push(b.url); return send({ success: true, data: { markdown: '# Data Analyst\n\nYou will use **SQL**, python, tableau and reporting dashboards daily. '.repeat(5) } }); }
      calls.json.push(b.url);
      return send({ success: true, data: { json: { jobs: [{ title: 'Senior Data Analyst', company: 'Acme', location: 'Lahore', url: '/careers/senior-da', description: 'SQL tableau' }, { title: 'Chef', url: '/careers/chef' }] } } });
    }
    if (req.url === '/v1/messages') { calls.ai++; return send({ content: [{ type: 'text', text: 'AI LETTER for you' }] }); }
    send({ error: 'nope' }, 404);
  });
});
let base, jar = {};
const server = require('../server');
let srv;
before(async () => {
  await new Promise((r) => mock.listen(0, r)); const m = `http://127.0.0.1:${mock.address().port}`;
  process.env.FIRECRAWL_BASE = m + '/v2'; process.env.ANTHROPIC_BASE = m;
  await server.ready(); await new Promise((r) => { srv = server.app.listen(0, () => { base = `http://127.0.0.1:${srv.address().port}`; r(); }); });
});
after(() => { for (const x of [srv, mock]) { x.closeAllConnections && x.closeAllConnections(); x.close(); } });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]).toString('base64');
async function api(who, method, p, body, extraHeaders = {}) {
  const r = await fetch(base + p, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { cookie: jar[who] } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && sc.startsWith('sid=') && !sc.startsWith('sid=;')) jar[who] = sc.split(';')[0]; if (sc && sc.startsWith('sid=;')) delete jar[who];
  const ct = r.headers.get('content-type') || ''; return { status: r.status, headers: r.headers, json: ct.includes('json') ? await r.json() : null, text: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) };
}
const resume = (f) => ({ name: f, data: fs.readFileSync(path.join(__dirname, 'fixtures', f)).toString('base64') });
const D = require('../lib/db');
const signup = (email, plan, extra = {}) => api('x', 'POST', '/api/signup', { name: 'Test User', email, password: 'password1', plan, screenshot: PNG, txid: 'TX1', ...extra });
const approve = async (email, plan, days = 30) => { const id = D.db.prepare('SELECT id FROM users WHERE email=?').get(email).id; await api('admin', 'POST', '/api/admin/approve', { id, plan, days }); return id; };

test('home page shows both plans with prices and benefits', async () => {
  const r = await api('x', 'GET', '/'); const html = r.text.toString();
  assert.equal(r.status, 200); assert.match(html, /2,500/); assert.match(html, /5,000/); assert.match(html, /Starter/); assert.match(html, /Pro/);
  assert.match(html, /5 job searches per day/); assert.match(html, /25 job searches per day/); assert.match(html, /AI-written cover letters/);
  assert.match(html, /TestPilot/); assert.match(html, /JazzCash 0300-1234567/); assert.doesNotMatch(html, /{{/);
  assert.equal((await api('x', 'GET', '/index.html')).status, 404);
  assert.equal((await api('x', 'GET', '/app')).status, 302); assert.equal((await api('x', 'GET', '/admin')).status, 302);
  assert.equal((await api('x', 'GET', '/api/plans')).json.plans.length, 2);
});

test('signup validation, pending login, duplicate, double submit', async () => {
  assert.equal((await signup('bad', 'pro')).status, 400);
  assert.equal((await signup('a@x.com', 'gold')).status, 400);
  assert.equal((await signup('a@x.com', 'pro', { password: 'short' })).status, 400);
  assert.equal((await signup('a@x.com', 'pro', { screenshot: Buffer.from('not an image at all').toString('base64') })).status, 400);
  assert.equal((await signup('a@x.com', 'pro', { screenshot: undefined })).status, 400);
  const both = await Promise.all([signup('starter@x.com', 'starter'), signup('starter@x.com', 'starter')]);
  assert.ok(both.every((r) => r.status === 200 || r.status === 409), JSON.stringify(both.map((r) => r.status)));
  assert.equal((await signup('pro@x.com', 'pro')).status, 200);
  const l = await api('x', 'POST', '/api/login', { email: 'starter@x.com', password: 'password1' }); assert.equal(l.status, 403); assert.match(l.json.error, /verified/);
  assert.equal((await api('x', 'POST', '/api/login', { email: 'starter@x.com', password: 'wrong' })).status, 401);
  assert.equal((await api('x', 'GET', '/api/me')).status, 401);
});

test('admin login, sees pending with screenshot, approves with plan', async () => {
  assert.equal((await api('admin', 'POST', '/api/login', { email: 'boss@x.com', password: 'AdminPass123' })).json.admin, true);
  const o = (await api('admin', 'GET', '/api/admin/overview')).json; assert.equal(o.stats.pending, 2);
  const id = o.users.find((u) => u.email === 'pro@x.com').id; const shot = await api('admin', 'GET', '/api/admin/shot/' + id); assert.equal(shot.headers.get('content-type'), 'image/png');
  await approve('starter@x.com', 'starter'); await approve('pro@x.com', 'pro');
  assert.equal((await api('admin', 'GET', '/api/admin/overview')).json.stats.monthly, 7500);
  assert.equal((await api('st', 'POST', '/api/login', { email: 'starter@x.com', password: 'password1' })).status, 200);
  assert.equal((await api('pr', 'POST', '/api/login', { email: 'pro@x.com', password: 'password1' })).status, 200);
  assert.equal((await api('st', 'GET', '/api/admin/overview')).status, 403);   // customers can't reach admin
  assert.equal((await api('st', 'GET', '/api/me')).json.limits.searchesPerDay, 5); assert.equal((await api('pr', 'GET', '/api/me')).json.limits.searchesPerDay, 25);
  assert.equal((await api('st', 'GET', '/app')).status, 200);
});

test('security: cross-origin writes blocked, bad JSON handled', async () => {
  assert.equal((await api('st', 'POST', '/api/apps', { job: {}, status: 'Applied' }, { Origin: 'https://evil.com' })).status, 403);
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }); assert.equal(r.status, 400);
});

test('Starter plan: search limits, no deep reads, blocked sites never scraped, XSS text stays text', async () => {
  await api('st', 'POST', '/api/resume', resume('resume.txt'));
  const s = await api('st', 'POST', '/api/search', { keywords: 'data analyst', location: 'Lahore, Pakistan', remember: true });
  assert.equal(s.status, 200, JSON.stringify(s.json)); const jobs = s.json.jobs;
  assert.ok(jobs.length > 0 && jobs.length <= 10, 'starter max 10, got ' + jobs.length);
  assert.equal(calls.search, 1); assert.equal(calls.searchBodies[0].limit, 20); assert.equal(calls.searchBodies[0].country, 'PK');
  assert.equal(calls.markdown.length, 0, 'starter must not deep-read');
  assert.ok(jobs.every((j) => /^https?:/.test(j.url)), 'only http(s) links'); assert.ok(!jobs.some((j) => j.title === 'Best tacos in town'));
  assert.ok(jobs.every((j) => typeof j.match === 'number' && Array.isArray(j.missing)));
  const L = await api('st', 'POST', '/api/search', { keywords: 'data analyst', links: ['https://a.com/c', 'https://b.com/c', 'https://c.com/c'] }); assert.equal(L.status, 403); assert.equal(L.json.code, 'plan');
  assert.equal((await api('st', 'POST', '/api/search', { keywords: 'data analyst', links: ['ftp://x.com'] })).status, 400);
  const C = await api('st', 'POST', '/api/search', { keywords: 'data analyst', location: 'Lahore, Pakistan', links: ['https://www.linkedin.com/company/acme/jobs', 'https://acme.com/careers'] });
  assert.equal(C.status, 200); assert.ok(C.json.notes.some((n) => /linkedin/.test(n)), 'linkedin link skipped');
  assert.deepEqual(calls.json, ['https://acme.com/careers']); assert.ok(C.json.jobs.some((j) => j.source === 'Career page' && j.url === 'https://acme.com/careers/senior-da'));
  assert.ok(!C.json.jobs.some((j) => j.title === 'Chef'));
  assert.equal(calls.search, 1, 'same query served from cache'); assert.ok(![...calls.markdown, ...calls.json].some((u) => /linkedin|indeed/.test(u)));
  for (let i = 0; i < 3; i++) await api('st', 'POST', '/api/search', { keywords: 'data analyst', location: 'Lahore, Pakistan' });   // 5th search
  const over = await api('st', 'POST', '/api/search', { keywords: 'data analyst', location: 'Lahore, Pakistan' }); assert.equal(over.status, 429); assert.match(over.json.error, /5 searches/);
  assert.equal((await api('st', 'GET', '/api/me')).json.usage.searches, 5);
});

test('Pro plan: more results, deep reads for top 10, AI letters, caching', async () => {
  await api('pr', 'POST', '/api/resume', resume('resume.docx'));
  const before = calls.search;
  const s = await api('pr', 'POST', '/api/search', { keywords: 'data analyst', location: 'Lahore, Pakistan' }); assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(calls.search, before + 1, 'bigger limit than cached -> refetch'); assert.equal(calls.searchBodies.at(-1).limit, 50);
  assert.ok(s.json.jobs.length > 10 && s.json.jobs.length <= 25, 'pro up to 25, got ' + s.json.jobs.length);
  assert.equal(calls.markdown.length, 10, 'top 10 leads read in full');
  assert.ok(!calls.markdown.some((u) => /linkedin|indeed/.test(u)));
  await api('pr', 'POST', '/api/search', { keywords: 'data analyst', location: 'Lahore, Pakistan' }); assert.equal(calls.markdown.length, 10, 'page cache'); assert.equal(calls.search, before + 1);
  const job = s.json.jobs[0];
  const ai = await api('pr', 'POST', '/api/letter', { job }); assert.equal(ai.json.ai, true); assert.match(ai.json.letter, /AI LETTER/); assert.equal(ai.json.aiLimit, 60);
  const t = await api('st', 'POST', '/api/letter', { job }); assert.equal(t.json.ai, false); assert.match(t.json.letter, /Dear/); assert.equal(calls.ai, 1);
  D.bump(D.db.prepare("SELECT id FROM users WHERE email='pro@x.com'").get().id, 'letter', 60);
  const cap = await api('pr', 'POST', '/api/letter', { job }); assert.equal(cap.json.ai, false); assert.equal(calls.ai, 1, 'monthly AI cap enforced');
});

test('resume: pdf, docx, txt, bad files, download and delete', async () => {
  for (const f of ['resume.pdf', 'resume.docx', 'resume.txt']) assert.equal((await api('st', 'POST', '/api/resume', resume(f))).status, 200, f);
  assert.equal((await api('st', 'POST', '/api/resume', { name: 'x.pdf', data: Buffer.from('not a pdf').toString('base64') })).status, 400);
  assert.equal((await api('st', 'POST', '/api/resume', { name: 'x.exe', data: PNG })).status, 400);
  const d = await api('st', 'GET', '/api/resume/download'); assert.equal(d.status, 200); assert.ok(d.text.toString().includes('Ali Khan'));
  assert.equal((await api('st', 'GET', '/api/profile')).json.profile.has_resume, true);
  assert.equal((await api('st', 'DELETE', '/api/resume')).status, 200); assert.equal((await api('st', 'GET', '/api/resume/download')).status, 404);
  await api('st', 'POST', '/api/resume', resume('resume.txt'));
});

test('tracker: apply/skip hides jobs, limit, edit, csv, privacy', async () => {
  const j = { url: 'https://company1.com/jobs/1', title: '=HYPERLINK("x")', company: 'C', source: 's', match: 80 };
  assert.equal((await api('pr', 'POST', '/api/apps', { job: j, status: 'Applied' })).status, 200);
  assert.equal((await api('pr', 'POST', '/api/apps', { job: { ...j, url: 'https://company2.com/jobs/2' }, status: 'Skipped' })).status, 200);
  assert.equal((await api('pr', 'POST', '/api/apps', { job: { url: 'javascript:1' }, status: 'Applied' })).status, 400);
  const a = (await api('pr', 'GET', '/api/apps')).json.apps; assert.equal(a.length, 2); assert.ok(a.find((x) => x.status === 'Applied').followup);
  assert.equal((await api('st', 'GET', '/api/apps')).json.apps.length, 0, 'other users cannot see them');
  assert.equal((await api('st', 'PATCH', '/api/apps/' + a[0].id, { status: 'Offer' })).status, 404);
  assert.equal((await api('pr', 'PATCH', '/api/apps/' + a.find((x) => x.status === 'Applied').id, { status: 'Interview', notes: 'call Monday' })).status, 200);
  const csv = (await api('pr', 'GET', '/api/apps.csv')).text.toString(); assert.match(csv, /Interview/); assert.match(csv, /"'=HYPERLINK/);
  const sid = D.db.prepare("SELECT id FROM users WHERE email='starter@x.com'").get().id;
  const ins = D.db.prepare("INSERT INTO apps(uid,url,status) VALUES(?,?,'Applied')"); for (let i = 0; i < 100; i++) ins.run(sid, 'https://fill/' + i);
  const full = await api('st', 'POST', '/api/apps', { job: { ...j, url: 'https://new.com/1' }, status: 'Applied' }); assert.equal(full.status, 403); assert.match(full.json.error, /tracker is full/);
  const again = await api('pr', 'POST', '/api/search', { keywords: 'data analyst', location: 'Lahore, Pakistan' }); assert.ok(!again.json.jobs.some((x) => x.url === j.url || x.url === 'https://company2.com/jobs/2'));
});

test('admin: suspend, reset password, expiry, extend, change plan, delete', async () => {
  const id = D.db.prepare("SELECT id FROM users WHERE email='starter@x.com'").get().id;
  await api('admin', 'POST', '/api/admin/status', { id, status: 'suspended' });
  assert.equal((await api('st', 'GET', '/api/me')).status, 401, 'session ended');
  assert.match((await api('st', 'POST', '/api/login', { email: 'starter@x.com', password: 'password1' })).json.error, /suspended/);
  assert.equal((await signup('starter@x.com', 'pro')).status, 409, 'suspended user cannot bypass by re-signing up');
  await api('admin', 'POST', '/api/admin/status', { id, status: 'approved' });
  assert.equal((await api('admin', 'POST', '/api/admin/password', { id, password: 'short' })).status, 400);
  await api('admin', 'POST', '/api/admin/password', { id, password: 'newpass123' });
  assert.equal((await api('st', 'POST', '/api/login', { email: 'starter@x.com', password: 'password1' })).status, 401);
  assert.equal((await api('st', 'POST', '/api/login', { email: 'starter@x.com', password: 'newpass123' })).status, 200);
  D.db.prepare("UPDATE users SET expires='2020-01-01' WHERE id=?").run(id);
  const x = await api('st', 'GET', '/api/profile'); assert.equal(x.status, 403); assert.equal(x.json.code, 'inactive');
  assert.match((await api('x', 'POST', '/api/login', { email: 'starter@x.com', password: 'newpass123' })).json.error, /expired/);
  assert.equal((await signup('starter@x.com', 'pro')).status, 409, 'wrong password cannot resubmit');
  assert.equal((await api('x', 'POST', '/api/signup', { name: 'Test User', email: 'starter@x.com', password: 'newpass123', plan: 'pro', screenshot: PNG })).status, 200, 'renewal with correct password');
  await api('admin', 'POST', '/api/admin/approve', { id, plan: 'pro', days: 30 });
  assert.equal((await api('st', 'POST', '/api/login', { email: 'starter@x.com', password: 'newpass123' })).status, 200);
  assert.equal((await api('st', 'GET', '/api/me')).json.user.plan, 'pro');
  for (let i = 0; i < 5; i++) await api('x', 'POST', '/api/login', { email: 'pro@x.com', password: 'nope' });
  assert.match((await api('x', 'POST', '/api/login', { email: 'pro@x.com', password: 'password1' })).json.error, /Too many/);
  await api('admin', 'POST', '/api/admin/delete', { id });
  assert.equal(D.db.prepare('SELECT COUNT(*) c FROM apps WHERE uid=?').get(id).c, 0); assert.equal(D.db.prepare('SELECT COUNT(*) c FROM users WHERE id=?').get(id).c, 0);
  assert.equal((await api('admin', 'POST', '/api/admin/delete', { id: 1 })).status, 404, 'admin account is protected');
});

test('Firecrawl outage gives a friendly error and refunds the search', async () => {
  const pid = D.db.prepare("SELECT id FROM users WHERE email='pro@x.com'").get().id; D.db.prepare("UPDATE users SET fails=0, locked_until=0 WHERE id=?").run(pid);
  await api('pr', 'POST', '/api/login', { email: 'pro@x.com', password: 'password1' });
  const used = (await api('pr', 'GET', '/api/me')).json.usage.searches, key = process.env.FIRECRAWL_API_KEY; process.env.FIRECRAWL_API_KEY = 'wrong';
  const r = await api('pr', 'POST', '/api/search', { keywords: 'brand new query nobody cached' }); process.env.FIRECRAWL_API_KEY = key;
  assert.equal(r.status, 503); assert.match(r.json.error, /temporarily unavailable/); assert.ok(!JSON.stringify(r.json).includes('fc-'));
  assert.equal((await api('pr', 'GET', '/api/me')).json.usage.searches, used, 'failed search not counted');
});
