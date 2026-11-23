'use strict';
// The "I am human" check (hCaptcha) on the forms that reach Supabase's sign-in door: sign in, create an account, forgot password, and
// change password. Supabase checks the answer itself when CAPTCHA protection is switched on there (Authentication > Attack Protection).
// Off until data/config.json has a captchaSiteKey; the site key is public, the secret lives only in Supabase.
// Usage: const cap = Captcha.mount(el); ... body.gotrue_meta_security = { captcha_token: cap.token() }; ... cap.reset() after every try.
const Captcha = (() => {
  let key = '', loading = null;
  const SRC = 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=qbankCaptchaReady';
  const dark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  function init(siteKey) { key = /^[0-9a-f-]{20,64}$/i.test(String(siteKey || '')) ? String(siteKey) : ''; }
  function load() {
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      if (window.hcaptcha && window.hcaptcha.render) return res(window.hcaptcha);
      window.qbankCaptchaReady = () => res(window.hcaptcha);
      const s = document.createElement('script'); s.src = SRC; s.async = true;
      s.onerror = () => { loading = null; rej(new Error('blocked')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  // Puts the check into el. Returns { on, token(), reset() }; with no site key it is a no-op whose token() is null.
  function mount(el) {
    const st = { on: !!key, tok: null, id: null, failed: false };
    const api = { get on() { return st.on; }, token: () => st.tok, reset() { st.tok = null; if (st.id !== null && window.hcaptcha) try { window.hcaptcha.reset(st.id); } catch { /* gone */ } }, get failed() { return st.failed; } };
    if (!st.on || !el) return api;
    el.classList.add('captcha'); el.innerHTML = '<p class="muted small" aria-live="polite">Loading the "I am human" check...</p>';
    load().then(h => {
      if (!document.body.contains(el)) return;
      el.innerHTML = '';
      st.id = h.render(el, { sitekey: key, theme: dark() ? 'dark' : 'light', callback: t => { st.tok = t; }, 'expired-callback': () => { st.tok = null; }, 'error-callback': () => { st.tok = null; } });
    }).catch(() => { st.failed = true; if (document.body.contains(el)) el.innerHTML = '<p class="notice small" role="alert">The "I am human" check could not load. Check your connection, then reload the page.</p>'; });
    return api;
  }
  // The message to show when the check was not done before pressing the button (null when it is fine to go ahead)
  const missing = cap => (cap && cap.on && !cap.token() ? (cap.failed ? 'The "I am human" check could not load. Check your connection, then reload the page.' : 'Please tick the "I am human" box first.') : null);
  return { init, mount, missing, get on() { return !!key; } };
})();
