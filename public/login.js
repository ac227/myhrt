const $ = (id) => document.getElementById(id);

function setLoginRole(role) {
  const sw = $('login-role-switch');
  if (role !== 'admin' && role !== 'guest') role = 'admin';
  $('login-role').value = role;
  sw.dataset.value = role;
  sw.querySelectorAll('.role-switch-btn').forEach((btn) => {
    const on = btn.dataset.role === role;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

function initRoleSwitch() {
  const sw = $('login-role-switch');
  sw.addEventListener('click', (e) => {
    const btn = e.target.closest('.role-switch-btn');
    if (!btn) return;
    setLoginRole(btn.dataset.role);
  });
  sw.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setLoginRole($('login-role').value === 'admin' ? 'guest' : 'admin');
  });
}

async function init() {
  const langSwitch = $('lang-switch');
  langSwitch.value = getLang();
  langSwitch.addEventListener('change', () => setLang(langSwitch.value));
  applyI18n();
  initRoleSwitch();

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('login-error');
    errEl.hidden = true;
    const role = $('login-role').value;
    const password = $('login-password').value;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ role, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = t('login_failed');
        errEl.hidden = false;
        return;
      }
      location.href = 'index.html';
    } catch {
      errEl.textContent = t('network_error');
      errEl.hidden = false;
    }
  });
}

init();
