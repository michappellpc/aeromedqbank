'use strict';
// The calculator pop-up on the question screen. It floats above the page so it stays open from question to question.
const CalcUI = (() => {
  let el = null, ans = 0, hist = [];
  const KEYS = [['(', '('], [')', ')'], ['%', '%'], ['C', 'clear'], ['⌫', 'back'],
    ['sqrt', 'sqrt('], ['x²', '^2'], ['xʸ', '^'], ['1/x', '1/('], ['n!', '!'],
    ['log', 'log('], ['ln', 'ln('], ['eˣ', 'exp('], ['π', 'pi'], ['ans', 'ans'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '/'], ['±', 'neg'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['×', '*'], ['EE', 'e'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['−', '-'], ['e', 'e'],
    ['0', '0'], ['.', '.'], ['=', 'eq'], ['+', '+']];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function build() {
    el = document.createElement('div'); el.className = 'calc'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Calculator');
    el.innerHTML = `<div class="calchead"><b>Calculator</b><button type="button" class="calcx" aria-label="Close the calculator">✕</button></div>
      <input class="calcin" type="text" inputmode="text" autocomplete="off" spellcheck="false" aria-label="Expression. Type a sum and press Enter." placeholder="Type or tap, then press =">
      <div class="calcout" aria-live="polite"></div>
      <div class="calckeys">${KEYS.map(([l, v], i) => `<button type="button" data-k="${i}" class="${v === 'eq' ? 'primary' : /^\d$|^\.$/.test(v) ? 'num' : ''}"${l.length > 2 ? ` aria-label="${esc(l)}"` : ''}>${esc(l)}</button>`).join('')}</div>
      <ul class="calchist" aria-label="Earlier results"></ul>`;
    document.body.appendChild(el);
    const inp = el.querySelector('.calcin'), out = el.querySelector('.calcout');
    const put = txt => { const a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a; inp.setRangeText(txt, a, b, 'end'); inp.focus(); out.textContent = ''; out.classList.remove('err'); };
    const equals = () => {
      if (!inp.value.trim()) return;
      try { const v = Calc.evaluate(inp.value, { ans }), s = Calc.format(v); hist.unshift({ e: inp.value, r: s, v }); hist = hist.slice(0, 5); ans = v; out.textContent = '= ' + s; out.classList.remove('err'); inp.value = s; drawHist(); }
      catch (e) { out.textContent = e.message; out.classList.add('err'); }
    };
    const drawHist = () => { el.querySelector('.calchist').innerHTML = hist.map((h, i) => `<li><button type="button" data-h="${i}" title="Use this result">${esc(h.e)} = <b>${esc(h.r)}</b></button></li>`).join(''); };
    el.querySelector('.calckeys').onclick = ev => {
      const b = ev.target.closest('button'); if (!b) return; const v = KEYS[+b.dataset.k][1];
      if (v === 'clear') { inp.value = ''; out.textContent = ''; inp.focus(); }
      else if (v === 'back') { const a = inp.selectionStart ?? inp.value.length; if (a > 0) { inp.setRangeText('', a - 1, a, 'end'); } inp.focus(); }
      else if (v === 'neg') { inp.value = inp.value.startsWith('-') ? inp.value.slice(1) : '-' + inp.value; inp.focus(); }
      else if (v === 'eq') equals();
      else put(v);
    };
    el.querySelector('.calchist').onclick = ev => { const b = ev.target.closest('[data-h]'); if (b) put(hist[+b.dataset.h].r); };
    inp.oninput = () => { out.textContent = ''; out.classList.remove('err'); };
    inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); equals(); } };
    el.querySelector('.calcx').onclick = () => close(true);
    const head = el.querySelector('.calchead');   // drag it out of the way by the title bar
    head.onpointerdown = ev => {
      if (ev.target.closest('button') || innerWidth <= 600) return;
      const r = el.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top; head.setPointerCapture(ev.pointerId);
      head.onpointermove = m => { el.style.left = Math.max(0, Math.min(innerWidth - r.width, m.clientX - dx)) + 'px'; el.style.top = Math.max(0, Math.min(innerHeight - 60, m.clientY - dy)) + 'px'; el.style.right = 'auto'; };
      head.onpointerup = () => { head.onpointermove = head.onpointerup = null; };
    };
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && isOpen() && !document.querySelector('.modal')) close(true); });
    window.addEventListener('hashchange', () => { if (!/^#\/test/.test(location.hash)) close(); });
  }
  function open() { if (!el) build(); el.hidden = false; setSync(true); el.querySelector('.calcin').focus(); }
  function close(focusBack) { if (!el || el.hidden) return; el.hidden = true; setSync(false); const b = document.getElementById('calc'); if (focusBack && b) b.focus(); }
  function setSync(on) { const b = document.getElementById('calc'); if (b) b.setAttribute('aria-expanded', String(on)); }
  const isOpen = () => !!el && !el.hidden;
  return { open, close, isOpen, toggle: btn => (isOpen() ? close() : open(btn)) };
})();
