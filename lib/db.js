const path = require('path'), fs = require('fs'), Database = require('better-sqlite3');
const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pw TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter', status TEXT NOT NULL DEFAULT 'pending', is_admin INTEGER NOT NULL DEFAULT 0, shot BLOB, txid TEXT,
  created TEXT, expires TEXT, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, uid INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profiles(uid INTEGER PRIMARY KEY, full_name TEXT, phone TEXT, target_role TEXT, skills TEXT, keywords TEXT,
  location TEXT, links TEXT, resume_name TEXT, resume_text TEXT, resume_blob BLOB, updated TEXT);
CREATE TABLE IF NOT EXISTS apps(id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, url TEXT NOT NULL, title TEXT, company TEXT,
  source TEXT, match INTEGER, status TEXT, date TEXT, followup TEXT, notes TEXT, UNIQUE(uid, url));
CREATE TABLE IF NOT EXISTS usage(uid INTEGER, kind TEXT, period TEXT, n INTEGER DEFAULT 0, PRIMARY KEY(uid, kind, period));
CREATE TABLE IF NOT EXISTS cache(k TEXT PRIMARY KEY, ts INTEGER, v TEXT);
CREATE INDEX IF NOT EXISTS apps_uid ON apps(uid);`);

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.APP_TZ || 'Asia/Karachi' });
const addDays = (iso, d) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const period = (kind) => (kind === 'letter' ? today().slice(0, 7) : today());
const used = (uid, kind) => (db.prepare('SELECT n FROM usage WHERE uid=? AND kind=? AND period=?').get(uid, kind, period(kind)) || { n: 0 }).n;
const bump = (uid, kind, by = 1) => {
  db.prepare('INSERT INTO usage(uid,kind,period,n) VALUES(?,?,?,?) ON CONFLICT(uid,kind,period) DO UPDATE SET n=n+excluded.n').run(uid, kind, period(kind), by);
  return used(uid, kind);
};
const cacheGet = (k, ttl) => { const r = db.prepare('SELECT ts,v FROM cache WHERE k=?').get(k); return r && Date.now() - r.ts < ttl ? JSON.parse(r.v) : null; };
const cacheSet = (k, v) => db.prepare('INSERT OR REPLACE INTO cache(k,ts,v) VALUES(?,?,?)').run(k, Date.now(), JSON.stringify(v));
const purge = () => { db.prepare('DELETE FROM cache WHERE ts<?').run(Date.now() - 3 * 864e5); db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); };

const PF = ['full_name', 'phone', 'target_role', 'skills', 'keywords', 'location', 'links', 'resume_name', 'resume_text', 'resume_blob'];
const getProfile = (uid) => db.prepare('SELECT uid,full_name,phone,target_role,skills,keywords,location,links,resume_name,resume_text,updated FROM profiles WHERE uid=?').get(uid) || {};
const saveProfile = (uid, f) => {
  f = Object.fromEntries(Object.entries(f).filter(([k]) => PF.includes(k))); f.updated = today();
  db.prepare('INSERT OR IGNORE INTO profiles(uid) VALUES (?)').run(uid);
  db.prepare(`UPDATE profiles SET ${Object.keys(f).map((k) => k + '=@' + k).join(',')} WHERE uid=@uid`).run({ ...f, uid });
};
const deleteUser = db.transaction((uid) => {
  for (const t of ['apps', 'usage', 'profiles', 'sessions']) db.prepare(`DELETE FROM ${t} WHERE uid=?`).run(uid);
  db.prepare('DELETE FROM users WHERE id=? AND is_admin=0').run(uid);
});
module.exports = { db, today, addDays, used, bump, cacheGet, cacheSet, purge, getProfile, saveProfile, deleteUser };
