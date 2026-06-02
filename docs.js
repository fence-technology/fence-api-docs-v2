/* =====================================================================
   Fence API Guide — interactions
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- JSON highlighter (lexer-based, tolerant of `...`) ---------- */
  function highlightJSON(src) {
    let out = '', i = 0; const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === '"') {
        let j = i + 1, str = '"';
        while (j < n) {
          if (src[j] === '\\') { str += src[j] + (src[j + 1] || ''); j += 2; continue; }
          str += src[j];
          if (src[j] === '"') { j++; break; }
          j++;
        }
        let k = j; while (k < n && /\s/.test(src[k])) k++;
        const isKey = src[k] === ':';
        out += '<span class="' + (isKey ? 't-key' : 't-str') + '">' + esc(str) + '</span>';
        i = j; continue;
      }
      if (/[-0-9]/.test(c) && /[\s:,\[\{]/.test(src[i - 1] || ' ')) {
        let j = i, num = '';
        while (j < n && /[-0-9.eE+]/.test(src[j])) { num += src[j]; j++; }
        out += '<span class="t-num">' + esc(num) + '</span>'; i = j; continue;
      }
      if (src.startsWith('true', i) || src.startsWith('false', i)) {
        const lit = src.startsWith('true', i) ? 'true' : 'false';
        out += '<span class="t-bool">' + lit + '</span>'; i += lit.length; continue;
      }
      if (src.startsWith('null', i)) { out += '<span class="t-null">null</span>'; i += 4; continue; }
      if ('{}[]:,'.indexOf(c) !== -1) { out += '<span class="t-punct">' + esc(c) + '</span>'; i++; continue; }
      out += esc(c); i++;
    }
    return out;
  }

  function hlPath(p) {
    const parts = p.split('?');
    let out = esc(parts[0]).replace(/(\{[^}]+\})/g, '<span style="color:#DEB483">$1</span>');
    if (parts[1] !== undefined) {
      out += '<span class="t-punct">?</span><span style="color:#A8C3A0">' + esc(parts[1]) + '</span>';
    }
    return out;
  }

  function highlightHTTP(src) {
    return src.split('\n').map(function (line) {
      const m = line.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.*)$/);
      if (m) return '<span class="t-method">' + m[1] + '</span> <span class="t-path">' + hlPath(m[2]) + '</span>';
      const h = line.match(/^([A-Za-z][A-Za-z-]*):\s*(.*)$/);
      if (h) return '<span class="t-header">' + esc(h[1]) + ':</span> <span class="t-hval">' + esc(h[2]) + '</span>';
      return '<span style="color:#A8C3A0">' + esc(line) + '</span>';
    }).join('\n');
  }

  function applyHighlighting() {
    document.querySelectorAll('code[data-lang]').forEach(function (code) {
      const lang = code.getAttribute('data-lang');
      const raw = code.textContent.replace(/\n$/, '');
      code.dataset.raw = raw;
      code.innerHTML = lang === 'http' ? highlightHTTP(raw) : highlightJSON(raw);
    });
  }

  /* ---------- copy buttons ---------- */
  const COPY_ICON = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const CHECK_ICON = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  function wireCopy() {
    document.querySelectorAll('[data-copy]').forEach(function (btn) {
      const labelTxt = btn.getAttribute('data-label');
      btn.innerHTML = COPY_ICON + (labelTxt ? '<span>' + labelTxt + '</span>' : '');
      btn.addEventListener('click', function () {
        let text = '';
        const sel = btn.getAttribute('data-copy');
        if (sel === 'code') {
          const pre = btn.closest('.code').querySelector('code');
          text = pre.dataset.raw || pre.textContent;
        } else if (sel === 'endpoint') {
          text = btn.closest('.endpoint').querySelector('.path').textContent.trim();
        } else {
          const el = document.querySelector(sel);
          text = el ? (el.dataset.raw || el.textContent) : '';
        }
        navigator.clipboard && navigator.clipboard.writeText(text);
        const prev = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = CHECK_ICON + (labelTxt ? '<span>Copied</span>' : '');
        setTimeout(function () { btn.classList.remove('copied'); btn.innerHTML = prev; }, 1400);
      });
    });
  }

  /* ---------- environment toggle ---------- */
  const ENVS = {
    sandbox: { base: 'https://dev-api.fence.finance', name: 'Sandbox' },
    prod: { base: 'https://api.fence.finance', name: 'Production' }
  };
  function setEnv(env) {
    const cfg = ENVS[env] || ENVS.sandbox;
    document.querySelectorAll('.env-base').forEach(function (el) { el.textContent = cfg.base; });
    document.querySelectorAll('.env-name').forEach(function (el) { el.textContent = cfg.name; });
    document.querySelectorAll('.env-toggle button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-env') === env ? 'true' : 'false');
    });
    try { localStorage.setItem('fence-api-env', env); } catch (e) {}
  }
  function wireEnv() {
    document.querySelectorAll('.env-toggle button').forEach(function (b) {
      b.addEventListener('click', function () { setEnv(b.getAttribute('data-env')); });
    });
    let saved = 'sandbox';
    try { saved = localStorage.getItem('fence-api-env') || 'sandbox'; } catch (e) {}
    setEnv(saved);
  }

  /* ---------- scrollspy ---------- */
  function wireScrollSpy() {
    // Build independent tracking lists for the left nav and the right rail.
    // They share no logic so a heading that only exists in one rail can never
    // hijack the other (the cause of the "lands one entry early" symptom).
    function collect(selector) {
      const links = Array.from(document.querySelectorAll(selector));
      const items = [];
      links.forEach(function (a) {
        const id = a.getAttribute('href').slice(1);
        if (id === 'top') return;                 // ignore "back to top"
        const el = document.getElementById(id);
        if (el) items.push({ id: id, el: el, link: a });
      });
      return { links: links, items: items };
    }
    const nav = collect('.nav-link[href^="#"]');
    const toc = collect('.toc a[href^="#"]');

    function activeId(items) {
      const line = 104;
      let cur = null, bestTop = -Infinity, first = null, firstTop = Infinity;
      for (let i = 0; i < items.length; i++) {
        const top = items[i].el.getBoundingClientRect().top;
        if (top < firstTop) { firstTop = top; first = items[i]; }
        if (top <= line && top > bestTop) { bestTop = top; cur = items[i]; }
      }
      cur = cur || first;
      return cur ? cur.id : null;
    }

    function onScroll() {
      const navId = activeId(nav.items);
      nav.links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + navId); });
      const tocId = activeId(toc.items);
      toc.links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + tocId); });
      // keep the active nav link scrolled into view within the nav rail
      const activeNav = document.querySelector('.nav-link.active');
      if (activeNav) {
        const navEl = document.querySelector('.nav');
        const r = activeNav.getBoundingClientRect(), nr = navEl.getBoundingClientRect();
        if (r.top < nr.top + 40 || r.bottom > nr.bottom - 40) {
          navEl.scrollTop += (r.top - nr.top) - nr.height / 2;
        }
      }
    }
    let ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(function () { onScroll(); ticking = false; }); ticking = true; }
    }, { passive: true });
    onScroll();
  }

  /* ---------- mobile nav ---------- */
  function wireMobileNav() {
    const burger = document.querySelector('.topbar-burger');
    const scrim = document.querySelector('.nav-scrim');
    function close() { document.body.classList.remove('nav-open'); }
    if (burger) burger.addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
    if (scrim) scrim.addEventListener('click', close);
    document.querySelectorAll('.nav-link').forEach(function (a) { a.addEventListener('click', close); });
  }

  /* ---------- search filter (nav) ---------- */
  function wireSearch() {
    const input = document.querySelector('.topbar-search input');
    if (!input) return;
    input.addEventListener('input', function () {
      const q = input.value.trim().toLowerCase();
      document.querySelectorAll('.nav-group').forEach(function (group) {
        let any = false;
        group.querySelectorAll('.nav-link').forEach(function (a) {
          const match = !q || a.textContent.toLowerCase().indexOf(q) !== -1;
          a.style.display = match ? '' : 'none';
          if (match) any = true;
        });
        group.style.display = any ? '' : 'none';
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
    });
  }

  /* ---------- init ---------- */
  function init() {
    applyHighlighting();
    wireCopy();
    wireEnv();
    wireScrollSpy();
    wireMobileNav();
    wireSearch();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
