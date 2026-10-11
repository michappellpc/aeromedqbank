'use strict';
// The live site's config must point at the real Supabase project, never at a test address on the member's own machine
// (that makes Chrome ask "access other apps and services on this device" and breaks sign-in).
const fs = require('fs'), path = require('path');
const c = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));
let bad = 0; const ok = (d, v) => { if (!v) bad++; console.log(`  ${v ? 'pass' : 'FAIL'}  ${d}`); };
const url = c.supabase && c.supabase.url;
ok('config has a Supabase address and key', !!(url && c.supabase.anonKey));
ok('the address is https', /^https:\/\//.test(url || ''));
ok('it is not localhost or a private network address', !/^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url || ''));
ok('the key is a publishable/anon key, not a secret key', !/service_role|sb_secret_/i.test(c.supabase.anonKey || '') && !/^eyJ.*service_role/.test(c.supabase.anonKey || ''));

// The Content-Security-Policy on every page: code only from the app itself, data only to the app and the configured database
for (const f of ['index.html', 'privacy.html', 'terms.html']) {
  const h = fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), m = h.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  ok(f + ' has a Content-Security-Policy', !!m);
  const csp = m ? m[1] : '', dir = n => ((csp.split(';').map(x => x.trim()).find(x => x.startsWith(n + ' ')) || '').slice(n.length + 1));
  ok(f + ': scripts only from the app itself (no inline, no eval)', dir('script-src') === "'self'");
  ok(f + ': connections only to the app and the configured database', dir('connect-src') === "'self' " + (url ? new URL(url).origin : '?'));
  ok(f + ': no plugins, base and forms locked to the app', /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /form-action 'self'/.test(csp));
  ok(f + ': no inline scripts or inline event handlers in the page', !/<script(?![^>]*\ssrc=)[^>]*>/i.test(h) && !/\son[a-z]+\s*=\s*["']/i.test(h));
}
console.log(bad ? `${bad} failed` : 'config ok'); process.exit(bad ? 1 : 0);
