# Browser tests

`mock-supabase.js` (port 9998) is a small stand-in for the Supabase API, `serve.js` (port 8132) serves the app with its content security policy allowing that stand-in, and `test-reviewer.js` drives the reviewer proposal flow (a reviewer edits, writes and imports; an admin accepts, edits first or declines), and `test-viewas.js` drives a real browser through the View as switch (admin, reviewer, faculty by program) and checks accessibility in light and dark.

```
npm i playwright axe-core        # once, anywhere on the module path
node tools/browser/mock-supabase.js &
node tools/browser/serve.js &
node tools/browser/test-viewas.js
node tools/browser/test-reviewer.js      # restart mock-supabase.js first: it keeps the proposals in memory
```

The test temporarily points `data/config.json` at the stand-in and restores it when it ends (also on Ctrl+C). Check `git status` shows no change to that file before you commit.
