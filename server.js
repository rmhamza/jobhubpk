require('./lib/env');
const express = require('express'), fs = require('fs'), path = require('path');
const D = require('./lib/db'), A = require('./lib/auth'), M = require('./lib/match'), R = require('./lib/resume'), S = require('./lib/search');
const { PLANS, planOf, list: planList, plansHtml } = require('./lib/plans');
const { db, today, addDays } = D;

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
const aiOn = () => !!process.env.ANTHROPIC_API_KEY;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400, extra = {}) => res.status(code).json({ error: msg, ...extra });
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const httpUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol) && u.length < 500; } catch { return false; } };
const hits = {};
const limiter = (max, win) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now(), a = (hits[k] || []).filter((t) => now - t < win);
  if (a.length >= max) return bad(res, 'Too many requests. Please wait a few minutes and try again.', 429);
  a.push(now); hits[k] = a; next();
};
setInterval(() => { for (const k of Object.keys(hits)) if (!hits[k].some((t) => Date.now() - t < 3600e3)) delete hits[k]; D.purge(); }, 600e3).unref();

app.get('/healthz', (req, res) => res.type('text').send('ok'));   // for hosting health checks
// ---------- security middleware ----------
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" });
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('origin')) {   // block cross-site form posts
    try { if (new URL(req.get('origin')).host !== req.get('host')) return bad(res, 'Bad origin', 403); } catch { return bad(res, 'Bad origin', 403); }
  }
  next();
});
app.use(express.json({ limit: '12mb' }));
app.use(A.loadUser);

// ---------- pages ----------
const pages = {};
const render = (f) => (pages[f] ||= fs.readFileSync(path.join(__dirname, 'public', f), 'utf8'))
  .replace(/{{APP_NAME}}/g, esc(process.env.APP_NAME || 'JobPilot PK'))
  .replace('{{PLANS}}', plansHtml(aiOn()))
  .replace('{{PAYMENT_INFO}}', esc(process.env.PAYMENT_INFO || 'Send the payment to JazzCash / Easypaisa: 03XX-XXXXXXX (Account name)').replace(/\n/g, '<br>'))
  .replace('{{APPROVAL}}', esc(process.env.APPROVAL_TEXT || 'within 24 hours'));
const send = (res, f) => res.type('html').send(render(f));
app.get('/', (req, res) => send(res, 'index.html'));
app.get('/login', (req, res) => send(res, 'login.html'));
app.get('/signup', (req, res) => send(res, 'signup.html'));
app.get('/app', (req, res) => (A.isActive(req.user) ? send(res, 'app.html') : res.redirect('/login')));
app.get('/admin', (req, res) => (req.user && req.user.is_admin ? send(res, 'admin.html') : res.redirect('/login')));
app.use((req, res, next) => (/\.html$/i.test(req.path) ? res.status(404).end() : next()));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------- public API ----------
app.get('/api/plans', (req, res) => res.json({ plans: planList(aiOn()), payment: process.env.PAYMENT_INFO || '', appName: process.env.APP_NAME || 'JobPilot PK' }));

app.post('/api/signup', limiter(+process.env.RATE_SIGNUP || 10, 3600e3), wrap(async (req, res) => {
  const b = req.body || {}, email = clip(b.email, 120).toLowerCase(), name = clip(b.name, 80);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Please enter a valid email.');
  if (name.length < 2) return bad(res, 'Please enter your name.');
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200) return bad(res, 'Password must be at least 8 characters.');
  if (!PLANS[b.plan]) return bad(res, 'Please choose a plan.');
  const shot = R.image(b.screenshot);
  if (!shot) return bad(res, 'Please upload your payment screenshot (PNG or JPG, under 5 MB).');
  const txid = clip(b.txid, 40), row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const done = { ok: true, message: 'Submitted! You can log in once your payment is verified.' };
  if (row) {
    if (!row.is_admin && row.status !== 'suspended' && !A.isActive(row) && await A.verify(b.password, row.pw)) {   // rejected / pending / expired: resubmit payment
      db.prepare("UPDATE users SET plan=?, status='pending', shot=?, txid=? WHERE id=?").run(b.plan, shot, txid, row.id);
      return res.json({ ...done, message: 'Payment resubmitted. You can log in once it is verified.' });
    }
    return bad(res, 'This email is already registered. Please log in.', 409);
  }
  try { db.prepare('INSERT INTO users(email,name,pw,plan,shot,txid,created) VALUES(?,?,?,?,?,?,?)').run(email, name, await A.hash(b.password), b.plan, shot, txid, today()); }
  catch (e) { if (!/UNIQUE/.test(e.message)) throw e; }   // double-click: first submit already saved it
  res.json(done);
}));

app.post('/api/login', limiter(+process.env.RATE_LOGIN || 30, 600e3), wrap(async (req, res) => {
  const b = req.body || {}, row = db.prepare('SELECT * FROM users WHERE email=?').get(clip(b.email, 120).toLowerCase()), wrong = 'Incorrect email or password.';
  if (!row || typeof b.password !== 'string') { await A.hash('x'); return bad(res, wrong, 401); }
  if (row.locked_until > Date.now()) return bad(res, 'Too many attempts. Try again in 10 minutes.', 429);
  if (!(await A.verify(b.password, row.pw))) {
    const f = row.fails + 1; db.prepare('UPDATE users SET fails=?, locked_until=? WHERE id=?').run(f >= 5 ? 0 : f, f >= 5 ? Date.now() + 600e3 : 0, row.id);
    return bad(res, wrong, 401);
  }
  db.prepare('UPDATE users SET fails=0 WHERE id=?').run(row.id);
  const msg = row.status === 'pending' ? 'Your payment is still being verified. Please try again later.'
    : row.status === 'rejected' ? "We couldn't verify your payment. Sign up again with the same email and password and upload the correct screenshot."
    : row.status === 'suspended' ? 'Your account is suspended. Please contact support.'
    : !A.isActive(row) ? 'Your subscription has expired. Sign up again with the same email and password to send a new payment.' : '';
  if (msg) return bad(res, msg, 403);
  A.newSession(res, row.id); res.json({ ok: true, admin: !!row.is_admin });
}));
app.post('/api/logout', (req, res) => { if (req.sid) db.prepare('DELETE FROM sessions WHERE token=?').run(req.sid); A.clearCookie(res); res.json({ ok: true }); });

// ---------- customer API ----------
app.get('/api/me', A.needLogin, (req, res) => {
  const u = req.user, p = planOf(u);
  res.json({ user: { name: u.name, email: u.email, plan: p.id, planName: p.name, expires: u.expires, isAdmin: !!u.is_admin, active: A.isActive(u) },
    limits: { searchesPerDay: p.searchesPerDay, resultsPerSearch: p.resultsPerSearch, careerLinks: p.careerLinks, deepReads: p.deepReads, trackerLimit: p.trackerLimit, aiLetters: aiOn() ? p.aiLettersPerMonth : 0 },
    usage: { searches: D.used(u.id, 'search'), letters: D.used(u.id, 'letter') } });
});

app.get('/api/profile', A.needActive, (req, res) => { const p = D.getProfile(req.user.id); const { resume_text, ...rest } = p; res.json({ profile: { ...rest, has_resume: !!p.resume_name } }); });
app.post('/api/profile', A.needActive, (req, res) => {
  const b = req.body || {};
  D.saveProfile(req.user.id, { full_name: clip(b.full_name, 80), phone: clip(b.phone, 30), target_role: clip(b.target_role, 80), skills: clip(b.skills, 500) });
  res.json({ ok: true });
});
app.post('/api/resume', A.needActive, wrap(async (req, res) => {
  const b = req.body || {};
  try { const buf = R.b64(b.data), text = await R.resumeText(b.name, buf); D.saveProfile(req.user.id, { resume_name: clip(b.name, 120), resume_text: text, resume_blob: buf }); res.json({ ok: true }); }
  catch (e) { bad(res, e.message); }
}));
app.get('/api/resume/download', A.needActive, (req, res) => {
  const r = db.prepare('SELECT resume_name n, resume_blob b FROM profiles WHERE uid=?').get(req.user.id);
  if (!r || !r.b) return bad(res, 'No saved resume.', 404);
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${String(r.n).replace(/[^\w.\- ]/g, '_')}"` }).send(r.b);
});
app.delete('/api/resume', A.needActive, (req, res) => { db.prepare('UPDATE profiles SET resume_name=NULL, resume_text=NULL, resume_blob=NULL WHERE uid=?').run(req.user.id); res.json({ ok: true }); });
app.delete('/api/profile', A.needActive, (req, res) => { db.prepare('DELETE FROM profiles WHERE uid=?').run(req.user.id); res.json({ ok: true }); });

app.post('/api/search', A.needActive, wrap(async (req, res) => {
  const u = req.user, plan = planOf(u), b = req.body || {};
  const keywords = clip(b.keywords, 100), location = clip(b.location, 80), minMatch = Math.max(0, Math.min(60, parseInt(b.minMatch, 10) || 0));
  if (keywords.length < 2) return bad(res, 'Enter the job keywords you want, for example "data analyst".');
  const links = [...new Set((Array.isArray(b.links) ? b.links : []).map((s) => String(s).trim()).filter(Boolean))];
  if (links.some((l) => !httpUrl(l))) return bad(res, 'Career page links must start with http:// or https://');
  if (links.length > plan.careerLinks) return bad(res, `Your ${plan.name} plan allows ${plan.careerLinks} career-page links per search.`, 403, { code: 'plan' });
  if (D.used(u.id, 'search') >= plan.searchesPerDay) return bad(res, `You've used all ${plan.searchesPerDay} searches for today on the ${plan.name} plan. Try again tomorrow${plan.id === 'starter' ? ' or upgrade to Pro' : ''}.`, 429, { code: 'plan' });
  let resume, prof = D.getProfile(u.id);
  if (b.resume && b.resume.data) {
    try { const buf = R.b64(b.resume.data); resume = await R.resumeText(b.resume.name, buf); if (b.remember) D.saveProfile(u.id, { resume_name: clip(b.resume.name, 120), resume_text: resume, resume_blob: buf }); }
    catch (e) { return bad(res, e.message); }
  } else resume = prof.resume_text;
  if (!resume || resume.length < 50) return bad(res, 'Upload your resume (or save one in My profile) so we can match jobs to it.');
  if (b.remember) D.saveProfile(u.id, { keywords, location, links: links.join('\n') });
  D.bump(u.id, 'search');
  try { const out = await S.runSearch({ user: u, plan, keywords, location, links, resume, skills: prof.skills, minMatch }); res.json({ ...out, usage: { searches: D.used(u.id, 'search'), limit: plan.searchesPerDay } }); }
  catch (e) { D.bump(u.id, 'search', -1); console.error('search failed:', e.message); bad(res, 'The job search service is temporarily unavailable. Please try again in a few minutes.', 503); }
}));

app.post('/api/letter', A.needActive, wrap(async (req, res) => {
  const j = (req.body && req.body.job) || {}, plan = planOf(req.user), prof = D.getProfile(req.user.id), name = prof.full_name || req.user.name;
  const job = { title: clip(j.title, 160), company: clip(j.company, 120), desc: clip(j.desc, 6000), hits: (Array.isArray(j.hits) ? j.hits : []).slice(0, 8).map((x) => clip(x, 30)) };
  let letter, ai = false;
  if (aiOn() && plan.aiLettersPerMonth && prof.resume_text && D.used(req.user.id, 'letter') < plan.aiLettersPerMonth) {
    try { letter = await M.letterAI(job, name, prof.resume_text + '\nSkills: ' + (prof.skills || '')); if (letter) { D.bump(req.user.id, 'letter'); ai = true; } } catch (e) { console.error('AI letter failed:', e.message); }
  }
  res.json({ letter: letter || M.letterTemplate(job, name), ai, aiUsed: D.used(req.user.id, 'letter'), aiLimit: aiOn() ? plan.aiLettersPerMonth : 0 });
}));

const STATUSES = ['Applied', 'Interview', 'Offer', 'Rejected', 'Skipped'];
app.get('/api/apps', A.needActive, (req, res) => res.json({ apps: db.prepare('SELECT * FROM apps WHERE uid=? ORDER BY id DESC').all(req.user.id) }));
app.post('/api/apps', A.needActive, (req, res) => {
  const j = (req.body && req.body.job) || {}, status = req.body && req.body.status, plan = planOf(req.user);
  if (!['Applied', 'Skipped'].includes(status) || !httpUrl(j.url)) return bad(res, 'Invalid job.');
  const exists = db.prepare('SELECT id FROM apps WHERE uid=? AND url=?').get(req.user.id, j.url);
  if (!exists && status === 'Applied' && db.prepare("SELECT COUNT(*) c FROM apps WHERE uid=? AND status!='Skipped'").get(req.user.id).c >= plan.trackerLimit)
    return bad(res, `Your ${plan.name} tracker is full (${plan.trackerLimit} jobs).`, 403, { code: 'plan' });
  db.prepare(`INSERT INTO apps(uid,url,title,company,source,match,status,date,followup,notes) VALUES(?,?,?,?,?,?,?,?,?,'')
    ON CONFLICT(uid,url) DO UPDATE SET status=excluded.status`).run(req.user.id, j.url, clip(j.title, 160), clip(j.company, 120), clip(j.source, 80), parseInt(j.match, 10) || 0, status, today(), status === 'Applied' ? addDays(today(), 6) : '');
  res.json({ ok: true });
});
app.patch('/api/apps/:id', A.needActive, (req, res) => {
  const b = req.body || {}, row = db.prepare('SELECT * FROM apps WHERE id=? AND uid=?').get(+req.params.id, req.user.id);
  if (!row) return bad(res, 'Not found.', 404);
  const status = STATUSES.includes(b.status) ? b.status : row.status, followup = b.followup === '' || /^\d{4}-\d{2}-\d{2}$/.test(b.followup || '') ? b.followup : row.followup;
  db.prepare('UPDATE apps SET status=?, followup=?, notes=? WHERE id=?').run(status, followup ?? row.followup, b.notes === undefined ? row.notes : clip(b.notes, 500), row.id);
  res.json({ ok: true });
});
app.get('/api/apps.csv', A.needActive, (req, res) => {
  const q = (v) => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const rows = db.prepare('SELECT title,company,source,match,status,date,followup,notes,url FROM apps WHERE uid=? ORDER BY id DESC').all(req.user.id);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="job_tracker.csv"' })
    .send(['title,company,source,match,status,date,followup,notes,url', ...rows.map((r) => Object.values(r).map(q).join(','))].join('\n'));
});

// ---------- admin API ----------
const stateOf = (u) => (u.status === 'approved' ? ((u.expires || '') < today() ? 'Expired' : 'Active') : u.status[0].toUpperCase() + u.status.slice(1));
app.get('/api/admin/overview', A.needAdmin, (req, res) => {
  const users = db.prepare('SELECT id,name,email,plan,status,expires,created,txid FROM users WHERE is_admin=0 ORDER BY id DESC').all().map((u) => ({ ...u, state: stateOf(u),
    daysLeft: u.expires ? Math.round((new Date(u.expires) - new Date(today())) / 864e5) : null }));
  const c = (s) => users.filter((u) => u.state === s).length, active = users.filter((u) => u.state === 'Active');
  res.json({ stats: { pending: c('Pending'), active: c('Active'), expiring: active.filter((u) => u.daysLeft <= 7).length, expired: c('Expired'), total: users.length,
    monthly: active.reduce((s, u) => s + (PLANS[u.plan] ? PLANS[u.plan].price : 0), 0), firecrawlToday: D.used(0, 'firecrawl') }, users, plans: planList(aiOn()).map((p) => ({ id: p.id, name: p.name, price: p.price })) });
});
app.get('/api/admin/shot/:id', A.needAdmin, (req, res) => {
  const r = db.prepare('SELECT shot FROM users WHERE id=?').get(+req.params.id);
  if (!r || !r.shot) return res.status(404).end();
  res.set({ 'Content-Type': r.shot[0] === 0x89 ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, no-store' }).send(r.shot);
});
const target = (req, res) => { const u = db.prepare('SELECT * FROM users WHERE id=? AND is_admin=0').get(+(req.body && req.body.id)); if (!u) bad(res, 'User not found.', 404); return u; };
app.post('/api/admin/approve', A.needAdmin, (req, res) => {
  const u = target(req, res); if (!u) return;
  const plan = PLANS[req.body.plan] ? req.body.plan : u.plan, d = parseInt(req.body.days, 10), days = Number.isNaN(d) ? 30 : Math.max(0, Math.min(365, d));
  if (days === 0) { db.prepare('UPDATE users SET plan=? WHERE id=?').run(plan, u.id); return res.json({ ok: true }); }   // plan change only
  const start = u.expires && u.expires > today() && u.status === 'approved' ? u.expires : today();
  db.prepare("UPDATE users SET status='approved', plan=?, expires=? WHERE id=?").run(plan, addDays(start, days), u.id); res.json({ ok: true });
});
app.post('/api/admin/status', A.needAdmin, (req, res) => {
  const u = target(req, res); if (!u) return;
  if (!['rejected', 'suspended', 'approved'].includes(req.body.status)) return bad(res, 'Invalid status.');
  db.prepare('UPDATE users SET status=? WHERE id=?').run(req.body.status, u.id);
  if (req.body.status !== 'approved') db.prepare('DELETE FROM sessions WHERE uid=?').run(u.id);
  res.json({ ok: true });
});
app.post('/api/admin/password', A.needAdmin, wrap(async (req, res) => {
  const u = target(req, res); if (!u) return;
  if (typeof req.body.password !== 'string' || req.body.password.length < 8) return bad(res, 'Password must be at least 8 characters.');
  db.prepare('UPDATE users SET pw=?, fails=0, locked_until=0 WHERE id=?').run(await A.hash(req.body.password), u.id); db.prepare('DELETE FROM sessions WHERE uid=?').run(u.id); res.json({ ok: true });
}));
app.post('/api/admin/delete', A.needAdmin, (req, res) => { const u = target(req, res); if (!u) return; D.deleteUser(u.id); res.json({ ok: true }); });

// ---------- errors ----------
app.use('/api', (req, res) => bad(res, 'Not found.', 404));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return bad(res, 'That file is too large.', 413);
  if (err.type === 'entity.parse.failed') return bad(res, 'Bad request.', 400);
  console.error(err); bad(res, 'Something went wrong. Please try again.', 500);
});

const ready = A.ensureAdmin;
if (require.main === module) {
  ready().then(() => app.listen(process.env.PORT || 3000, () => console.log(`${process.env.APP_NAME || 'JobPilot PK'} running on http://localhost:${process.env.PORT || 3000}`)));
}
module.exports = { app, ready };
