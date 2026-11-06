// Firecrawl client. The API key lives ONLY in the server environment, never in the browser.
const D = require('./db');
const BLOCK = /(^|\.)(linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|facebook\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com)$/i;
const blocked = (u) => { try { return BLOCK.test(new URL(u).hostname); } catch { return true; } };

let active = 0; const waiters = [];  // concurrency limiter (free plan allows only 2 at a time)
const slot = async () => { if (active < (+process.env.FIRECRAWL_CONCURRENCY || 2)) { active++; return; } await new Promise((r) => waiters.push(r)); };
const release = () => { const w = waiters.shift(); if (w) w(); else active--; };

async function call(path, body, timeout) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('FIRECRAWL_API_KEY is not set');
  if (D.bump(0, 'firecrawl') > (+process.env.FIRECRAWL_DAILY_CALLS || 1500)) throw new Error('Daily Firecrawl call cap reached');
  await slot();
  try {
    const r = await fetch((process.env.FIRECRAWL_BASE || 'https://api.firecrawl.dev/v2') + path, { method: 'POST', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(`Firecrawl ${r.status}: ${j.error || j.message || 'request failed'}`);
    return j;
  } finally { release(); }
}
async function search(query, { limit, country, tbs }) {
  const body = { query, limit, tbs: tbs || 'qdr:m' }; if (country) body.country = country;
  const d = (await call('/search', body, 60000)).data;
  return (Array.isArray(d) ? d : (d && d.web) || []).filter((x) => x && x.url).map((x) => ({ url: x.url, title: x.title || '', description: x.description || '' }));
}
async function scrapeMarkdown(url) {
  const j = await call('/scrape', { url, formats: ['markdown'], onlyMainContent: true }, 60000);
  return (j.data && j.data.markdown) || '';
}
const SCHEMA = { type: 'object', properties: { jobs: { type: 'array', items: { type: 'object', properties: {
  title: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' }, url: { type: 'string' }, description: { type: 'string' } }, required: ['title'] } } } };
async function scrapeJobs(url) {
  const j = await call('/scrape', { url, formats: [{ type: 'json', schema: SCHEMA, prompt: 'List every job opening on this page with its title, location, apply link and a short description.' }] }, 120000);
  const jobs = j.data && j.data.json && j.data.json.jobs;
  return Array.isArray(jobs) ? jobs.slice(0, 100) : [];
}
module.exports = { blocked, search, scrapeMarkdown, scrapeJobs };
