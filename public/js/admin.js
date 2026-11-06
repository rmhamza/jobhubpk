(async () => {
  let data; const money = (n) => 'Rs. ' + Number(n).toLocaleString('en-US');
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.href = '/'; };
  const planSel = (cls, cur) => `<select class="${cls}">${data.plans.map((p) => `<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.name)} (${money(p.price)})</option>`).join('')}</select>`;
  async function load() { data = await api('/admin/overview'); render(); }
  function render() {
    const s = data.stats; $('#fc').textContent = `Firecrawl calls today: ${s.firecrawlToday}`;
    $('#tiles').innerHTML = [['Pending', s.pending], ['Active', s.active], ['Expiring in 7 days', s.expiring], ['Expired', s.expired], ['Total users', s.total], ['Active monthly value', money(s.monthly)]].map(([l, v]) => `<div class="tile"><b>${esc(v)}</b><span>${l}</span></div>`).join('');
    const pend = data.users.filter((u) => u.state === 'Pending'); $('#pcount').textContent = `(${pend.length})`;
    $('#pending').innerHTML = pend.map((u) => `<div class="panel pending" data-card="${u.id}"><a href="/api/admin/shot/${u.id}" target="_blank" rel="noopener"><img src="/api/admin/shot/${u.id}" alt="Payment screenshot"></a>
<div><b>${esc(u.name)}</b> &middot; ${esc(u.email)}<br><span class="muted">Transaction ID: ${esc(u.txid || '-')} &middot; signed up ${esc(u.created)}</span>
<div class="form2" style="margin-top:8px"><label>Plan${planSel('p-plan', u.plan)}</label><label>Days of access<input class="p-days" type="number" min="1" max="365" value="30"></label></div>
<p class="muted" style="margin:6px 0">Check this payment in your JazzCash or Easypaisa app before approving.</p>
<button class="btn btn-green btn-sm" data-act="approve" data-id="${u.id}">Approve</button> <button class="btn btn-red btn-sm" data-act="reject" data-id="${u.id}">Reject</button></div></div>`).join('') || '<p class="muted">No pending payments.</p>';
    const q = $('#q').value.toLowerCase(), flt = $('#flt').value;
    $('#users').innerHTML = data.users.filter((u) => (!q || (u.name + u.email).toLowerCase().includes(q)) && (flt === 'All' || (flt === 'Expiring' ? u.state === 'Active' && u.daysLeft <= 7 : u.state === flt)))
      .map((u) => `<tr data-id="${u.id}"><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${planSel('u-plan', u.plan)} <button class="btn btn-sm btn-ghost" data-act="plan" data-id="${u.id}">Set</button></td>
<td><span class="st ${esc(u.state)}">${esc(u.state)}</span></td><td>${esc(u.expires || '-')}${u.daysLeft != null && u.state === 'Active' ? ` <span class="muted">(${u.daysLeft}d)</span>` : ''}</td>
<td><button class="btn btn-sm btn-ghost" data-act="extend" data-id="${u.id}">+Days</button> <button class="btn btn-sm btn-ghost" data-act="${u.state === 'Suspended' ? 'unsuspend' : 'suspend'}" data-id="${u.id}">${u.state === 'Suspended' ? 'Unsuspend' : 'Suspend'}</button>
<button class="btn btn-sm btn-ghost" data-act="password" data-id="${u.id}">Reset password</button> <button class="btn btn-sm btn-red" data-act="delete" data-id="${u.id}">Delete</button></td></tr>`).join('');
  }
  $('#q').oninput = $('#flt').onchange = render;
  document.body.onclick = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return; const id = +b.dataset.id, act = b.dataset.act, card = b.closest('[data-card]'), row = b.closest('tr');
    try {
      if (act === 'approve') await api('/admin/approve', { method: 'POST', body: { id, plan: $('.p-plan', card).value, days: +$('.p-days', card).value } });
      else if (act === 'reject') await api('/admin/status', { method: 'POST', body: { id, status: 'rejected' } });
      else if (act === 'plan') await api('/admin/approve', { method: 'POST', body: { id, plan: $('.u-plan', row).value, days: 0 } });
      else if (act === 'extend') { const d = parseInt(prompt('Add how many days?', '30'), 10); if (!d) return; await api('/admin/approve', { method: 'POST', body: { id, days: d } }); }
      else if (act === 'suspend' || act === 'unsuspend') await api('/admin/status', { method: 'POST', body: { id, status: act === 'suspend' ? 'suspended' : 'approved' } });
      else if (act === 'password') { const p = prompt('New password for this user (min 8 characters):'); if (!p) return; await api('/admin/password', { method: 'POST', body: { id, password: p } }); toast('Password reset. Send the new password to the user.'); return; }
      else if (act === 'delete') { if (!confirm('Permanently delete this user and all their data?')) return; await api('/admin/delete', { method: 'POST', body: { id } }); }
      toast('Done.'); await load();
    } catch (err) { toast(err.message, true); }
  };
  try { await load(); } catch { /* redirected to login */ }
})();
