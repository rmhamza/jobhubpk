(async () => {
  const msg = $('#msg'), show = (t, ok) => { msg.hidden = false; msg.className = 'alert ' + (ok ? 'ok' : 'err'); msg.textContent = t; };
  const lf = $('#loginForm');
  if (lf) {
    if (new URLSearchParams(location.search).get('inactive')) show('Your subscription is not active. Log in again, or sign up again to renew.');
    lf.onsubmit = async (e) => {
      e.preventDefault(); const btn = lf.querySelector('button'); btn.disabled = true;
      try { const r = await api('/login', { method: 'POST', body: { email: lf.elements.email.value, password: lf.elements.password.value } }); location.href = r.admin ? '/admin' : '/app'; }
      catch (err) { show(err.message); btn.disabled = false; }
    };
  }
  const sf = $('#signupForm');
  if (sf) {
    const { plans, payment } = await api('/plans'), want = new URLSearchParams(location.search).get('plan');
    $('#planOpts').innerHTML = plans.map((p, i) => `<label class="plan-opt"><input type="radio" name="plan" value="${esc(p.id)}"${(want ? want === p.id : i === 0) ? ' checked' : ''}>${esc(p.name)}: Rs. ${p.price.toLocaleString('en-US')} / month<small>${esc(p.benefits.slice(0, 3).join(' \u00b7 '))}</small></label>`).join('');
    $('#payInfo').textContent = payment || 'Payment details will be shared by the administrator.';
    sf.onsubmit = async (e) => {
      e.preventDefault(); const el = sf.elements, btn = sf.querySelector('button'); msg.hidden = true;
      if (el.password.value !== el.password2.value) return show("Passwords don't match.");
      const file = el.shot.files[0]; if (!file) return show('Please upload your payment screenshot.');
      if (file.size > 5e6) return show('The screenshot must be under 5 MB.');
      btn.disabled = true;
      try {
        const shot = await readFile(file);
        const r = await api('/signup', { method: 'POST', body: { name: el.name.value, email: el.email.value, password: el.password.value, plan: el.plan.value, txid: el.txid.value, screenshot: shot.data } });
        sf.hidden = true; show(r.message + ' We will approve your account soon. After that, log in with your email and password.', true);
      } catch (err) { show(err.message); btn.disabled = false; }
    };
  }
})();
