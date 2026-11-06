const crypto = require('crypto'), { promisify } = require('util'), scrypt = promisify(crypto.scrypt);
const D = require('./db'), { db, today } = D;

const hash = async (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + (await scrypt(pw, salt, 64)).toString('hex'); };
const verify = async (pw, stored) => { const [salt, h] = String(stored).split(':'); return crypto.timingSafeEqual(await scrypt(pw, salt, 64), Buffer.from(h, 'hex')); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isActive = (u) => !!u && u.status === 'approved' && (!!u.is_admin || (u.expires || '') >= today());

function newSession(res, uid) {
  const token = crypto.randomBytes(32).toString('hex'), ttl = 14 * 864e5;
  db.prepare('INSERT INTO sessions(token,uid,expires) VALUES(?,?,?)').run(sha(token), uid, Date.now() + ttl);
  res.append('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttl / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
const clearCookie = (res) => res.append('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
const cookie = (req, name) => { for (const p of (req.headers.cookie || '').split(';')) { const [k, ...v] = p.trim().split('='); if (k === name) return v.join('='); } return null; };

function loadUser(req, res, next) {
  const t = cookie(req, 'sid');
  if (t) {
    const s = db.prepare('SELECT uid,expires FROM sessions WHERE token=?').get(sha(t));
    if (s && s.expires > Date.now()) req.user = db.prepare('SELECT id,email,name,plan,status,is_admin,expires FROM users WHERE id=?').get(s.uid);
    req.sid = sha(t);
  }
  next();
}
const needLogin = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please log in.', code: 'login' }));
const needActive = (req, res, next) => !req.user ? res.status(401).json({ error: 'Please log in.', code: 'login' })
  : !isActive(req.user) ? res.status(403).json({ error: 'Your subscription is not active.', code: 'inactive' }) : next();
const needAdmin = (req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'Admins only.' }));

async function ensureAdmin() {
  const e = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), p = process.env.ADMIN_PASSWORD;
  if (!e || !p) { console.warn('WARNING: set ADMIN_EMAIL and ADMIN_PASSWORD to create the admin account.'); return false; }
  db.prepare(`INSERT INTO users(email,name,pw,plan,status,is_admin,created) VALUES(?,?,?,?,'approved',1,?)
    ON CONFLICT(email) DO UPDATE SET pw=excluded.pw, status='approved', is_admin=1`).run(e, 'Admin', await hash(p), 'pro', today());
  return true;
}
module.exports = { hash, verify, isActive, newSession, clearCookie, loadUser, needLogin, needActive, needAdmin, ensureAdmin, sha };
