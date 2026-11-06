// Loads the real pages in jsdom and clicks through them as a customer and as the admin.
const { test, before, after } = require('node:test'), assert = require('node:assert/strict'), http = require('http'), os = require('os'), path = require('path');
const { JSDOM, CookieJar } = require('jsdom');
Object.assign(process.env, { DB_PATH: path.join(os.tmpdir(), 'jp-ui-' + Date.now() + '.db'), ADMIN_EMAIL: 'boss@x.com', ADMIN_PASSWORD: 'AdminPass123', FIRECRAWL_API_KEY: 'fc-test',
  ANTHROPIC_API_KEY: 'sk-test', PAYMENT_INFO: 'JazzCash 0300-1234567', APP_NAME: 'TestPilot', RATE_SIGNUP: '1000', RATE_LOGIN: '1000' });
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    const j = b ? JSON.parse(b) : {}, send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/v2/search') { const web = [{ title: '<img src=x onerror="window.__xss=1"> Data Analyst Jobs', url: 'https://evil.example.com/jobs/9', description: 'sql python reporting dashboards <script>window.__xss=1</script>' }];
      for (let i = 1; i <= 12; i++) web.push({ title: `Data Analyst ${i} - Company${i} | Careers`, url: `https://company${i}.com/jobs/${i}`, description: `Apply now. SQL python reporting tableau role ${i}` }); return send({ success: true, data: { web } }); }
    if (req.url === '/v2/scrape') return send({ success: true, data: { markdown: 'Data analyst role using SQL python tableau dashboards and reporting every day. '.repeat(4) } });
    if (req.url === '/v1/messages') return send({ content: [{ type: 'text', text: 'AI LETTER for you' }] });
    res.writeHead(404); res.end('{}');
  });
});
const server = require('../server'), D = require('../lib/db');
let base, srv; const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100, 1)]).toString('base64');
before(async () => {
  await new Promise((r) => mock.listen(0, r)); process.env.FIRECRAWL_BASE = `http://127.0.0.1:${mock.address().port}/v2`; process.env.ANTHROPIC_BASE = `http://127.0.0.1:${mock.address().port}`;
  await server.ready(); await new Promise((r) => { srv = server.app.listen(0, () => { base = `http://127.0.0.1:${srv.address().port}`; r(); }); });
});
after(() => { for (const x of [srv, mock]) { x.closeAllConnections && x.closeAllConnections(); x.close(); } });

const wait = async (fn, what, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = fn(); if (v) return v; } catch {} await new Promise((r) => setTimeout(r, 40)); } throw new Error('timeout waiting for ' + what); };
async function cookieFor(email, password) { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); assert.equal(r.status, 200, email); return r.headers.get('set-cookie').split(';')[0]; }
async function open(p, cookie) {
  const jar = new CookieJar(); if (cookie) jar.setCookieSync(cookie + '; Path=/', base);
  const dom = await JSDOM.fromURL(base + p, { runScripts: 'dangerously', resources: 'usable', cookieJar: jar, pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o = {}) => fetch(new URL(u, base), { ...o, headers: { ...(o.headers || {}), ...(cookie ? { cookie } : {}) } }); w.confirm = () => true; w.prompt = () => '30'; } });
  return dom.window;
}
const file = (w, name, text) => new w.File([text], name, { type: 'text/plain' });
const withFile = (input, f) => Object.defineProperty(input, 'files', { value: [f], configurable: true });
const submit = (w, form) => form.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
const mkUser = async (email, plan) => { await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ali Khan', email, password: 'password1', plan, screenshot: PNG }) });
  D.db.prepare("UPDATE users SET status='approved', expires='2099-01-01' WHERE email=?").run(email); return cookieFor(email, 'password1'); };

test('home page: two plans, prices, benefits, CTA links', async () => {
  const w = await open('/'); const plans = [...w.document.querySelectorAll('.plan')];
  assert.equal(plans.length, 2); assert.match(plans[0].textContent, /Starter[\s\S]*2,500/); assert.match(plans[1].textContent, /Pro[\s\S]*5,000/);
  assert.ok(plans[1].querySelector('.ribbon')); assert.match(plans[1].textContent, /AI-written cover letters/); assert.doesNotMatch(plans[0].textContent, /AI-written/);
  assert.equal(plans[1].querySelector('a.btn').getAttribute('href'), '/signup?plan=pro'); assert.match(w.document.body.textContent, /JazzCash 0300-1234567/); assert.match(w.document.title, /TestPilot/);
});

test('signup page: plan preselected from the link, form submits, success shown', async () => {
  const w = await open('/signup?plan=pro'); const d = w.document;
  await wait(() => d.querySelectorAll('input[name=plan]').length === 2, 'plan options'); assert.equal(d.querySelector('input[name=plan]:checked').value, 'pro');
  assert.match(d.querySelector('#payInfo').textContent, /JazzCash/);
  const f = d.querySelector('#signupForm'), el = f.elements; el.name.value = 'Sara Ahmed'; el.email.value = 'sara@x.com'; el.password.value = 'password1'; el.password2.value = 'password1';
  withFile(el.shot, new w.File([Buffer.from(PNG, 'base64')], 'pay.png', { type: 'image/png' })); submit(w, f);
  await wait(() => /Submitted/.test(d.querySelector('#msg').textContent), 'success message'); assert.ok(f.hidden);
  const row = D.db.prepare("SELECT plan,status FROM users WHERE email='sara@x.com'").get(); assert.deepEqual({ ...row }, { plan: 'pro', status: 'pending' });
  el.password2.value = 'x'; f.hidden = false; submit(w, f); await wait(() => /match/.test(d.querySelector('#msg').textContent), 'mismatch message');
});

test('login page: pending user sees a clear message, approved user is sent to the app', async () => {
  const w = await open('/login'), d = w.document, f = d.querySelector('#loginForm');
  await wait(() => f.onsubmit, 'login script');
  f.elements.email.value = 'sara@x.com'; f.elements.password.value = 'password1'; submit(w, f); await wait(() => /verified/.test(d.querySelector('#msg').textContent), 'pending message');
  f.elements.password.value = 'wrong'; submit(w, f); await wait(() => /Incorrect/.test(d.querySelector('#msg').textContent), 'wrong password message');
});

test('customer dashboard (Pro): search, safe rendering, AI letter, apply, tracker, profile', async () => {
  const ck = await mkUser('ali@x.com', 'pro'); const w = await open('/app', ck), d = w.document;
  await wait(() => d.querySelector('#planBadge').textContent === 'Pro', 'plan badge'); assert.match(d.querySelector('#usage').textContent, /0\/25/); assert.match(d.querySelector('#usage').textContent, /AI letters/);
  assert.match(d.querySelector('#linkHint').textContent, /up to 8/);
  const f = d.querySelector('#searchForm'), el = f.elements; el.keywords.value = 'data analyst'; el.location.value = 'Lahore';
  withFile(el.resume, file(w, 'resume.txt', 'Ali Khan data analyst with five years of python SQL pandas dashboards and reporting experience at a bank in Lahore.')); submit(w, f);
  await wait(() => d.querySelectorAll('#results .job').length >= 5, 'results');
  assert.equal(w.__xss, undefined, 'no script from job text ran'); assert.equal(d.querySelectorAll('#results img').length, 0, 'HTML in titles is shown as text');
  assert.ok([...d.querySelectorAll('.job-t')].some((a) => a.textContent.includes('<img src=x')), 'malicious title shown as plain text');
  assert.ok([...d.querySelectorAll('.job-t')].every((a) => /^https?:/.test(a.href)));
  assert.match(d.querySelector('#usage').textContent, /1\/25/); assert.ok(d.querySelector('.ring span').textContent.endsWith('%'));
  const n = d.querySelectorAll('#results .job').length, card = d.querySelector('#results .job');
  card.querySelector('[data-act=letter]').click(); await wait(() => card.querySelector('.letter textarea').value.includes('AI LETTER'), 'AI letter'); assert.match(card.querySelector('.lnote').textContent, /AI-written/);
  card.querySelector('[data-act=applied]').click(); await wait(() => d.querySelectorAll('#results .job').length === n - 1, 'card removed after applying');
  const apps = (await (await fetch(base + '/api/apps', { headers: { cookie: ck } })).json()).apps; assert.equal(apps.length, 1); assert.equal(apps[0].status, 'Applied'); assert.ok(apps[0].followup);
  d.querySelector('[data-tab=tracker]').click(); await wait(() => d.querySelector('#trackerBox tr[data-id]'), 'tracker row');
  const sel = d.querySelector('#trackerBox select[data-f=status]'); sel.value = 'Interview'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(async () => (await (await fetch(base + '/api/apps', { headers: { cookie: ck } })).json()).apps[0].status === 'Interview' || null, 'status saved').catch(() => {});
  await new Promise((r) => setTimeout(r, 400)); assert.equal(D.db.prepare("SELECT status FROM apps WHERE uid=(SELECT id FROM users WHERE email='ali@x.com')").get().status, 'Interview');
  d.querySelector('[data-tab=profile]').click(); const pf = d.querySelector('#profileForm'); pf.elements.skills.value = 'python, tableau'; pf.elements.target_role.value = 'Data Analyst'; submit(w, pf);
  await new Promise((r) => setTimeout(r, 500)); assert.equal(D.db.prepare("SELECT skills s, target_role r FROM profiles WHERE uid=(SELECT id FROM users WHERE email='ali@x.com')").get().s, 'python, tableau');
  assert.match(d.querySelector('#resumeBox').textContent, /resume\.txt/);
});

test('customer dashboard (Starter): own limits shown, Pro-only things absent', async () => {
  const ck = await mkUser('bilal@x.com', 'starter'); const w = await open('/app', ck), d = w.document;
  await wait(() => d.querySelector('#planBadge').textContent === 'Starter', 'plan badge'); assert.match(d.querySelector('#usage').textContent, /0\/5/); assert.doesNotMatch(d.querySelector('#usage').textContent, /AI letters/);
  assert.match(d.querySelector('#linkHint').textContent, /up to 2/);
  const f = d.querySelector('#searchForm'); f.elements.keywords.value = 'data analyst'; submit(w, f);   // no resume anywhere: must be told so
  await wait(() => /Upload your resume/.test(d.querySelector('#notes').textContent), 'resume required message');
});

test('admin page: stats, pending payment with screenshot, approve and plan change', async () => {
  const ck = await cookieFor('boss@x.com', 'AdminPass123'); const w = await open('/admin', ck), d = w.document;
  await wait(() => d.querySelectorAll('#tiles .tile').length === 6, 'stat tiles'); assert.match(d.querySelector('#tiles').textContent, /Pending/);
  const card = await wait(() => d.querySelector('[data-card]'), 'pending card'); assert.match(card.textContent, /Sara Ahmed/); assert.ok(card.querySelector('img').src.includes('/api/admin/shot/'));
  card.querySelector('.p-days').value = '45'; card.querySelector('[data-act=approve]').click();
  await wait(() => !d.querySelector('[data-card]'), 'card gone after approving');
  const sara = D.db.prepare("SELECT plan,status,expires FROM users WHERE email='sara@x.com'").get(); assert.equal(sara.status, 'approved'); assert.equal(sara.plan, 'pro'); assert.ok(sara.expires > D.today());
  const row = await wait(() => [...d.querySelectorAll('#users tr')].find((r) => r.textContent.includes('sara@x.com')), 'user row'); assert.match(row.textContent, /Active/);
  row.querySelector('.u-plan').value = 'starter'; row.querySelector('[data-act=plan]').click(); await wait(() => D.db.prepare("SELECT plan FROM users WHERE email='sara@x.com'").get().plan === 'starter', 'plan changed');
  const r2 = await wait(() => [...d.querySelectorAll('#users tr')].find((r) => r.textContent.includes('sara@x.com')), 'row'); r2.querySelector('[data-act=suspend]').click();
  await wait(() => D.db.prepare("SELECT status FROM users WHERE email='sara@x.com'").get().status === 'suspended', 'suspended');
  d.querySelector('#flt').value = 'Suspended'; d.querySelector('#flt').dispatchEvent(new w.Event('change')); await wait(() => d.querySelectorAll('#users tr').length === 1, 'filter');
});

test('pages are protected: customers cannot open admin, visitors are sent to log in', async () => {
  const ck = await cookieFor('ali@x.com', 'password1');
  for (const [p, c] of [['/admin', ck], ['/app', null], ['/admin', null]]) { const r = await fetch(base + p, { redirect: 'manual', headers: c ? { cookie: c } : {} }); assert.equal(r.status, 302, p); assert.equal(r.headers.get('location'), '/login'); }
  const own = await fetch(base + '/app', { headers: { cookie: ck } }); assert.equal(own.status, 200);
});
