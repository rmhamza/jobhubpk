const crypto = require('crypto'), D = require('./db'), fc = require('./firecrawl'), M = require('./match');
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const JOBISH = /job|career|hiring|vacanc|opening|position|recruit|apply|hire|employment|naukri|rozee|bayt|opportunit/i;
const COUNTRY = { pakistan: 'PK', lahore: 'PK', karachi: 'PK', islamabad: 'PK', rawalpindi: 'PK', faisalabad: 'PK', peshawar: 'PK', multan: 'PK', dubai: 'AE', 'abu dhabi': 'AE', uae: 'AE',
  riyadh: 'SA', jeddah: 'SA', saudi: 'SA', doha: 'QA', qatar: 'QA', london: 'GB', uk: 'GB', 'united kingdom': 'GB', usa: 'US', 'united states': 'US', canada: 'CA', germany: 'DE', india: 'IN' };
const countryOf = (loc) => { const l = String(loc || '').toLowerCase(); for (const k of Object.keys(COUNTRY)) if (new RegExp('\\b' + k + '\\b').test(l)) return COUNTRY[k]; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const httpUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
function companyOf(title, host) {
  const at = title.match(/\bat\s+([^|\-–—]{2,40})/i); if (at) return at[1].trim();
  const parts = title.split(/\s[|\-–—]\s/);
  if (parts.length > 1) { const c = parts[parts.length - 1].trim(); if (c.length < 40 && !/jobs?|careers?|indeed|linkedin|glassdoor|rozee|vacanc/i.test(c)) return c; }
  return host;
}
function toJobs(rows) {
  const out = [], seen = new Set();
  for (const r of rows) {
    if (!httpUrl(r.url) || seen.has(r.url) || !JOBISH.test(`${r.title} ${r.url} ${r.description}`)) continue;
    seen.add(r.url);
    const title = String(r.title).replace(/\s+/g, ' ').trim().slice(0, 140) || 'Job opening', host = hostOf(r.url);
    out.push({ title, company: companyOf(title, host), location: '', url: r.url, source: host, desc: M.clean(r.description).slice(0, 600), deep: false });
  }
  return out;
}

async function runSearch({ user, plan, keywords, location, links, resume, skills, minMatch }) {
  const notes = [], seenApps = new Set(D.db.prepare('SELECT url FROM apps WHERE uid=?').all(user.id).map((r) => r.url));
  const resumeAll = resume + '\nSkills: ' + (skills || ''), fetchLimit = Math.min(100, plan.resultsPerSearch * 2);
  const kw = new Set(M.toklist(keywords));

  let rows = [];
  const key = 'search:' + sha(JSON.stringify([keywords.toLowerCase(), location.toLowerCase()])), cached = D.cacheGet(key, 6 * 3600e3);
  if (cached && cached.limit >= fetchLimit) rows = cached.rows;
  else {
    try { rows = await fc.search(`${keywords} jobs ${location}`.trim(), { limit: fetchLimit, country: countryOf(location) }); D.cacheSet(key, { limit: fetchLimit, rows }); }
    catch (e) { if (!links.length) throw e; console.error(e.message); notes.push('Web search is unavailable right now; showing career-page results only.'); }
  }
  let jobs = toJobs(rows).slice(0, fetchLimit);

  await Promise.all(links.map(async (link) => {   // company career pages the user pasted (read by Firecrawl, JavaScript pages included)
    if (fc.blocked(link)) return notes.push(`Skipped ${hostOf(link)}: this site doesn't allow automated reading.`);
    try {
      const ck = 'career:' + sha(link); let list = D.cacheGet(ck, 6 * 3600e3);
      if (!list) { list = await fc.scrapeJobs(link); D.cacheSet(ck, list); }
      let added = 0;
      for (const j of list) {
        let url; try { url = new URL(j.url || link, link).href; } catch { continue; }
        if (!j.title || !httpUrl(url) || !M.toklist(j.title).some((w) => kw.has(w))) continue;
        jobs.push({ title: String(j.title).slice(0, 140), company: String(j.company || hostOf(link)).slice(0, 80), location: String(j.location || '').slice(0, 80), url,
          source: 'Career page', desc: M.clean(j.description).slice(0, 3000), deep: true }); added++;
      }
      if (!added) notes.push(`No matching jobs found on ${hostOf(link)}.`);
    } catch (e) { console.error(e.message); notes.push(`Couldn't read ${hostOf(link)}.`); }
  }));

  const seen = new Set(); jobs = jobs.filter((j) => !seenApps.has(j.url) && !seen.has(j.url) && seen.add(j.url));
  let scored = M.score(jobs, resumeAll, keywords);

  if (plan.deepReads > 0) {   // Pro: read the full job pages of the best leads for a more accurate match
    const targets = scored.filter((j) => !j.deep && !fc.blocked(j.url)).slice(0, plan.deepReads);
    await Promise.all(targets.map(async (j) => {
      try {
        const pk = 'page:' + sha(j.url); let md = D.cacheGet(pk, 24 * 3600e3);
        if (md == null) { md = await fc.scrapeMarkdown(j.url); D.cacheSet(pk, md); }
        const t = M.plain(md).slice(0, 6000); if (t.length > 80) { j.desc = t; j.deep = true; }
      } catch (e) { console.error(e.message); }
    }));
    scored = M.score(scored, resumeAll, keywords);
  }
  // career pages the user pasted are explicit intent: guarantee them up to half of the result slots, fill the rest by match
  const ok = scored.filter((j) => j.match >= minMatch), cap = plan.resultsPerSearch, careers = ok.filter((j) => j.source === 'Career page').slice(0, Math.ceil(cap / 2));
  const picked = new Set(careers), rest = ok.filter((j) => !picked.has(j)).slice(0, cap - careers.length);
  const final = [...careers, ...rest].sort((a, b) => b.match - a.match).map((j) => ({ ...j, id: sha(j.url).slice(0, 12), desc: j.desc.slice(0, 1500) }));
  if (!final.length) notes.push('No new matching jobs found. Try broader keywords or a different location.');
  return { jobs: final, notes };
}
module.exports = { runSearch, toJobs, countryOf };
