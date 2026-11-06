(async () => {
  let me, profile = {}, results = [];
  const f = $('#searchForm'), STATUS = ['Applied', 'Interview', 'Offer', 'Rejected', 'Skipped'], tabs = { find: $('#tab-find'), tracker: $('#tab-tracker'), profile: $('#tab-profile') };
  const name = () => profile.full_name || me.user.name;
  $$('.tabs button').forEach((b) => (b.onclick = () => { $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); for (const k in tabs) tabs[k].hidden = k !== b.dataset.tab; if (b.dataset.tab === 'tracker') loadTracker(); }));
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.href = '/'; };

  function header() {
    $('#planBadge').textContent = me.user.planName; $('#planBadge').className = 'badge ' + me.user.plan;
    $('#usage').textContent = `Searches today: ${me.usage.searches}/${me.limits.searchesPerDay}` + (me.limits.aiLetters ? ` \u00b7 AI letters this month: ${me.usage.letters}/${me.limits.aiLetters}` : '');
    $('#expires').textContent = me.user.isAdmin ? '' : 'Access until ' + me.user.expires;
  }
  async function loadProfile() {
    profile = (await api('/profile')).profile; const el = f.elements, pf = $('#profileForm').elements;
    el.keywords.value = profile.keywords || profile.target_role || ''; el.location.value = profile.location || ''; el.links.value = profile.links || '';
    $('#linkHint').textContent = `Your ${me.user.planName} plan allows up to ${me.limits.careerLinks} links per search.`;
    $('#resumeHint').textContent = profile.has_resume ? `Saved resume: ${profile.resume_name}. Upload a file only to replace it.` : 'Upload your resume so we can match jobs to it.';
    for (const k of ['full_name', 'phone', 'target_role', 'skills']) pf[k].value = profile[k] || '';
    $('#resumeBox').innerHTML = profile.has_resume ? `<p><b>${esc(profile.resume_name)}</b> <span class="muted">updated ${esc(profile.updated)}</span></p><a class="btn btn-sm btn-outline" href="/api/resume/download">Download</a> <button class="btn btn-sm btn-red" id="resumeDel">Delete</button>` : '<p class="muted">No resume saved yet.</p>';
    const d = $('#resumeDel'); if (d) d.onclick = async () => { await api('/resume', { method: 'DELETE' }); await loadProfile(); toast('Resume deleted.'); };
  }

  // ----- search -----
  f.onsubmit = async (e) => {
    e.preventDefault(); const el = f.elements, file = el.resume.files[0];
    const body = { keywords: el.keywords.value, location: el.location.value, links: el.links.value.split('\n').map((s) => s.trim()).filter(Boolean), minMatch: +el.minMatch.value, remember: el.remember.checked };
    try { if (file) { if (file.size > 5e6) throw new Error('Resume must be under 5 MB.'); body.resume = await readFile(file); } } catch (err) { return toast(err.message, true); }
    const btn = $('#searchBtn'); btn.disabled = true; $('#searchState').textContent = 'Searching the web and matching your resume. This can take up to a minute...'; $('#results').innerHTML = ''; $('#notes').innerHTML = '';
    try {
      const r = await api('/search', { method: 'POST', body }); results = r.jobs; me.usage.searches = r.usage.searches; header();
      $('#notes').innerHTML = r.notes.map((n) => `<div class="alert info">${esc(n)}</div>`).join(''); renderResults();
      if (body.remember) await loadProfile();
    } catch (err) { $('#notes').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    finally { btn.disabled = false; $('#searchState').textContent = ''; }
  };
  function renderResults() {
    $('#results').innerHTML = results.map((j, i) => `<article class="job" data-i="${i}"><div class="job-h"><div>
<a class="job-t" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">${esc(j.title)}</a>
<div class="muted">${esc(j.company)}${j.location ? ' \u00b7 ' + esc(j.location) : ''} \u00b7 ${esc(j.source)}${j.deep ? ' \u00b7 full page read' : ''}</div></div>
<div class="ring ${matchClass(j.match)}" style="--p:${+j.match || 0}" title="Resume match"><span>${+j.match || 0}%</span></div></div>
${j.desc ? `<p class="desc">${esc(j.desc.slice(0, 260))}${j.desc.length > 260 ? '...' : ''}</p>` : ''}
${j.missing && j.missing.length ? `<div class="chips">Keywords this job wants that your resume lacks (add only if true): ${j.missing.map((w) => `<b>${esc(w)}</b>`).join('')}</div>` : ''}
<div class="job-a"><a class="btn btn-sm btn-primary" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">Open job</a><button class="btn btn-sm btn-outline" data-act="letter">Cover letter</button><button class="btn btn-sm btn-green" data-act="applied">I applied</button><button class="btn btn-sm btn-ghost" data-act="skip">Skip</button></div>
<div class="letter" hidden><textarea></textarea><div style="margin-top:6px"><button class="btn btn-sm btn-outline" data-act="copy">Copy</button> <span class="muted lnote"></span></div></div></article>`).join('')
      || '<div class="panel muted">No jobs to show. Try broader keywords or a different location.</div>';
  }
  $('#results').onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const card = b.closest('.job'), j = results[+card.dataset.i], act = b.dataset.act, box = card.querySelector('.letter');
    if (act === 'copy') { const t = box.querySelector('textarea'); try { await navigator.clipboard.writeText(t.value); toast('Copied.'); } catch { t.select(); toast('Press Ctrl+C to copy.'); } return; }
    b.disabled = true;
    try {
      if (act === 'letter') {
        const r = await api('/letter', { method: 'POST', body: { job: { title: j.title, company: j.company, desc: j.desc, hits: j.hits } } });
        box.hidden = false; box.querySelector('textarea').value = r.letter;
        box.querySelector('.lnote').textContent = r.ai ? 'AI-written from your saved resume. Review it before sending.' : 'Template letter. Edit it before sending.';
        if (r.aiLimit) { me.usage.letters = r.aiUsed; header(); }
      } else {
        await api('/apps', { method: 'POST', body: { job: { url: j.url, title: j.title, company: j.company, source: j.source, match: j.match }, status: act === 'applied' ? 'Applied' : 'Skipped' } });
        card.remove(); toast(act === 'applied' ? 'Saved to your tracker. Follow-up set for 6 days from now.' : 'Skipped. It will not show up again.');
      }
    } catch (err) { toast(err.message, true); } finally { b.disabled = false; }
  };

  // ----- tracker -----
  const followup = (a) => `Subject: Following up - ${a.title}\n\nDear ${a.company || 'Hiring'} Team,\n\nI applied for the ${a.title} role recently and remain very interested. Could you share any update on my application? I am happy to provide anything further.\n\nThank you,\n${name()}`;
  async function loadTracker() {
    const { apps } = await api('/apps'), today = new Date().toLocaleDateString('en-CA'), due = apps.filter((a) => a.status === 'Applied' && a.followup && a.followup <= today);
    $('#due').innerHTML = due.length ? `<div class="alert info"><b>${due.length} follow-up(s) due</b>${due.map((a) => `<details><summary>${esc(a.title)} - ${esc(a.company)}</summary><textarea rows="8" readonly>${esc(followup(a))}</textarea></details>`).join('')}</div>` : '';
    $('#trackerBox').innerHTML = apps.length ? `<table><thead><tr><th>Job</th><th>Match</th><th>Status</th><th>Follow-up</th><th>Notes</th></tr></thead><tbody>${apps.map((a) => `<tr data-id="${a.id}">
<td><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title || a.url)}</a><br><span class="muted">${esc(a.company)}</span></td><td>${+a.match || 0}%</td>
<td><select data-f="status">${STATUS.map((s) => `<option${s === a.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
<td><input type="date" data-f="followup" value="${esc(a.followup)}"></td><td><input data-f="notes" value="${esc(a.notes)}" maxlength="500"></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Nothing tracked yet. Jobs you mark as applied appear here.</p>';
  }
  $('#trackerBox').onchange = async (e) => {
    const t = e.target.closest('[data-f]'); if (!t) return;
    try { await api('/apps/' + t.closest('tr').dataset.id, { method: 'PATCH', body: { [t.dataset.f]: t.value } }); toast('Saved.'); } catch (err) { toast(err.message, true); }
  };

  // ----- profile -----
  $('#profileForm').onsubmit = async (e) => {
    e.preventDefault(); const el = e.target.elements;
    try { await api('/profile', { method: 'POST', body: { full_name: el.full_name.value, phone: el.phone.value, target_role: el.target_role.value, skills: el.skills.value } }); await loadProfile(); toast('Profile saved.'); } catch (err) { toast(err.message, true); }
  };
  $('#resumeSave').onclick = async () => {
    const file = $('#resumeFile').files[0]; if (!file) return toast('Choose a resume file first.', true);
    try { await api('/resume', { method: 'POST', body: await readFile(file) }); $('#resumeFile').value = ''; await loadProfile(); toast('Resume saved.'); } catch (err) { toast(err.message, true); }
  };
  $('#wipe').onclick = async () => { if (!confirm('Delete your saved profile and resume?')) return; await api('/profile', { method: 'DELETE' }); await loadProfile(); toast('Profile data deleted.'); };

  try { me = await api('/me'); } catch { return; }
  if (!me.user.active) return (location.href = '/login?inactive=1');
  header(); await loadProfile();
})();
