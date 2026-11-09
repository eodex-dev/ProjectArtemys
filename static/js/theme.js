/* Motor de temas sazonais da Luna: escolhe o tema pela data (ou pela preferência), monta o fundo e a neve. */
(function () {
  'use strict';

  var STORAGE_KEY = 'luna_theme_v1';
  var THEMES = { natal: { label: 'Natal', color: '#0a1030' } };       // temas com arte pronta
  var COMING = [{ id: 'anonovo', label: 'Ano Novo' }, { id: 'pascoa', label: 'Páscoa' }];
  var DEFAULTS = { mode: 'auto', manual: 'natal', snow: true, bg: 'medium' };
  var DEFAULT_COLOR = '#212121';
  var SLEIGH = `<svg class="sleigh-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 44" aria-hidden="true"><g class="deer r2"><g class="leg leg-a" style="transform-origin:60px 26px"><line x1="60" y1="26" x2="58" y2="35" stroke="#d9a45a" stroke-width="2.1" stroke-linecap="round"/></g><g class="leg leg-b" style="transform-origin:63px 26px"><line x1="63" y1="26" x2="61.5" y2="35" stroke="#d9a45a" stroke-width="2.1" stroke-linecap="round"/></g><g class="leg leg-c" style="transform-origin:70px 26px"><line x1="70" y1="26" x2="72.5" y2="35" stroke="#d9a45a" stroke-width="2.1" stroke-linecap="round"/></g><g class="leg leg-d" style="transform-origin:73px 26px"><line x1="73" y1="26" x2="76" y2="34" stroke="#d9a45a" stroke-width="2.1" stroke-linecap="round"/></g><polygon points="57.5,21 53.5,17.2 55.5,23.5" fill="#d9a45a"/><ellipse cx="66" cy="23" rx="9.2" ry="4.8" fill="#d9a45a"/><polygon points="70.5,21 74.8,12.5 79,13.8 77,22.5" fill="#d9a45a"/><ellipse cx="78.6" cy="11.2" rx="3.7" ry="2.5" fill="#d9a45a"/><polygon points="76.5,9.6 75.4,6.8 78,8.6" fill="#d9a45a"/><circle cx="81.9" cy="11.6" r="1.15" fill="#3a2412"/><line x1="78.2" y1="9.3" x2="76.2" y2="3.2" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/><line x1="76.2" y1="3.2" x2="74.2" y2="4.2" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/><line x1="77.1" y1="6" x2="74.6" y2="6.9" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/><line x1="79.2" y1="9" x2="80.6" y2="3.4" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/><line x1="80.6" y1="3.4" x2="82.6" y2="4.4" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/></g><g class="deer r1"><g class="leg leg-a" style="transform-origin:88px 26px"><line x1="88" y1="26" x2="86" y2="35" stroke="#d9a45a" stroke-width="2.1" stroke-linecap="round"/></g><g class="leg leg-b" style="transform-origin:91px 26px"><line x1="91" y1="26" x2="89.5" y2="35" stroke="#d9a45a" stroke-width="2.1" stroke-linecap="round"/></g><g class="leg leg-c" style="transform-origin:98px 26px"><line x1="98" y1="26" x2="100.5" y2="35" stroke="#d9a45a" stroke-width="2.1" stroke-linecap="round"/></g><g class="leg leg-d" style="transform-origin:101px 26px"><line x1="101" y1="26" x2="104" y2="34" stroke="#d9a45a" stroke-width="2.1" stroke-linecap="round"/></g><polygon points="85.5,21 81.5,17.2 83.5,23.5" fill="#d9a45a"/><ellipse cx="94" cy="23" rx="9.2" ry="4.8" fill="#d9a45a"/><polygon points="98.5,21 102.8,12.5 107,13.8 105,22.5" fill="#d9a45a"/><ellipse cx="106.6" cy="11.2" rx="3.7" ry="2.5" fill="#d9a45a"/><polygon points="104.5,9.6 103.4,6.8 106,8.6" fill="#d9a45a"/><circle cx="109.9" cy="11.6" r="1.15" fill="#d7332b"/><line x1="106.2" y1="9.3" x2="104.2" y2="3.2" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/><line x1="104.2" y1="3.2" x2="102.2" y2="4.2" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/><line x1="105.1" y1="6" x2="102.6" y2="6.9" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/><line x1="107.2" y1="9" x2="108.6" y2="3.4" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/><line x1="108.6" y1="3.4" x2="110.6" y2="4.4" stroke="#f0c060" stroke-width="1.1" stroke-linecap="round"/></g><line x1="46.5" y1="27.5" x2="57" y2="24.5" stroke="#f0c060" stroke-width="0.9" stroke-linecap="round"/><line x1="75" y1="23.5" x2="85" y2="22.5" stroke="#f0c060" stroke-width="0.9" stroke-linecap="round"/><g class="sled"><line x1="6" y1="38.5" x2="44" y2="38.5" stroke="#f0c060" stroke-width="2.4" stroke-linecap="round"/><line x1="44" y1="38.5" x2="49.5" y2="36.5" stroke="#f0c060" stroke-width="2.4" stroke-linecap="round"/><line x1="49.5" y1="36.5" x2="50.5" y2="32" stroke="#f0c060" stroke-width="2.4" stroke-linecap="round"/><line x1="14" y1="33" x2="14" y2="38.5" stroke="#f0c060" stroke-width="1.6" stroke-linecap="round"/><line x1="36" y1="33" x2="36" y2="38.5" stroke="#f0c060" stroke-width="1.6" stroke-linecap="round"/><polygon points="9,22 41,22 45,26 40.5,33.5 12,33.5 8,28" fill="#d7332b"/><line x1="9" y1="22.5" x2="41" y2="22.5" stroke="#f0c060" stroke-width="1.4" stroke-linecap="round"/><circle cx="13" cy="19.5" r="5.6" fill="#8a5a2b"/><line x1="11" y1="14.6" x2="15" y2="14.6" stroke="#f0c060" stroke-width="1.2" stroke-linecap="round"/><circle cx="23" cy="18" r="6" fill="#d7332b"/><circle cx="23" cy="11.4" r="3.3" fill="#f3c9a5"/><circle cx="23" cy="13.6" r="2.5" fill="#ffffff"/><polygon points="19.6,9.6 26.4,9.6 25,4.2" fill="#d7332b"/><rect x="19.2" y="8.6" width="7.6" height="1.8" rx="0.9" fill="#ffffff"/><circle cx="25.4" cy="3.9" r="1.4" fill="#ffffff"/></g></svg>`;
  var root = document.documentElement;
  var prefs = loadPrefs();
  var snow = null;

  // Dezembro é Natal; em 2026 a regra especial começa em 1º de novembro. Janeiro = Ano Novo, abril = Páscoa.
  function seasonForDate(date) {
    var month = date.getMonth();
    if (month === 11) return 'natal';
    if (date.getFullYear() === 2026 && month === 10) return 'natal';
    if (month === 0) return 'anonovo';
    if (month === 3) return 'pascoa';
    return 'clean';
  }

  function loadPrefs() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) {}
    return {
      mode: ['auto', 'clean', 'manual'].indexOf(saved.mode) >= 0 ? saved.mode : DEFAULTS.mode,
      manual: THEMES[saved.manual] ? saved.manual : DEFAULTS.manual,
      snow: typeof saved.snow === 'boolean' ? saved.snow : DEFAULTS.snow,
      bg: ['soft', 'medium', 'strong'].indexOf(saved.bg) >= 0 ? saved.bg : DEFAULTS.bg
    };
  }

  function savePrefs() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (_) {}
  }

  function resolveSeason(p, date) {
    if (p.mode === 'clean') return 'clean';
    if (p.mode === 'manual') return THEMES[p.manual] ? p.manual : 'clean';
    var season = seasonForDate(date || new Date());
    return THEMES[season] ? season : 'clean';       // estações sem arte pronta caem no visual limpo
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ------------------------------------------------------------ fundo
  function buildLayers() {
    if (document.querySelector('.season-bg') || !document.body) return;
    var bg = document.createElement('div');
    bg.className = 'season-bg';
    bg.setAttribute('aria-hidden', 'true');
    var stage = document.createElement('div');
    stage.className = 'season-stage';
    ['star g-star', 'lamp g-l1', 'lamp b g-l2', 'win g-w1', 'win g-w2', 'tw g-ts', 'tw g-t1', 'tw g-t2', 'tw g-t3', 'tw g-t4'].forEach(function (cls) {
      var glow = document.createElement('i');
      glow.className = 'glow ' + cls;
      stage.appendChild(glow);
    });
    var dim = document.createElement('div');
    dim.className = 'season-dim';
    bg.appendChild(stage);
    bg.appendChild(dim);
    document.body.insertBefore(bg, document.body.firstChild);
    var portrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
    var img = new Image();
    img.onload = function () { stage.classList.add('ready'); };
    img.onerror = function () { stage.classList.add('ready'); };
    img.src = '/themes/natal-' + (portrait ? 'vertical' : 'horizontal') + '.webp';
  }

  function removeLayers() {
    var bg = document.querySelector('.season-bg');
    if (bg) bg.remove();
  }

  // ------------------------------------------------------------ neve
  function stopSnow() {
    if (!snow) return;
    cancelAnimationFrame(snow.raf);
    window.removeEventListener('resize', snow.onResize);
    document.removeEventListener('visibilitychange', snow.onVisibility);
    snow.canvas.remove();
    snow = null;
  }

  function startSnow() {
    stopSnow();
    if (!prefs.snow || reducedMotion() || !document.body) return;
    var canvas = document.createElement('canvas');
    canvas.className = 'season-snow';
    canvas.setAttribute('aria-hidden', 'true');
    var bg = document.querySelector('.season-bg');
    if (bg && bg.nextSibling) document.body.insertBefore(canvas, bg.nextSibling); else document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }
    var state = { canvas: canvas, raf: 0, flakes: [], last: 0, w: 0, h: 0 };
    snow = state;

    function resize() {
      var ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      state.w = window.innerWidth;
      state.h = window.innerHeight;
      canvas.width = Math.round(state.w * ratio);
      canvas.height = Math.round(state.h * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      var count = Math.round(Math.max(34, Math.min(90, (state.w * state.h) / 15000)));
      while (state.flakes.length < count) state.flakes.push(newFlake(true));
      state.flakes.length = count;
    }

    function newFlake(anywhere) {
      var r = 0.8 + Math.random() * 2.1;
      return { x: Math.random() * state.w, y: anywhere ? Math.random() * state.h : -6, r: r, vy: 16 + r * 13 + Math.random() * 10,
               phase: Math.random() * Math.PI * 2, sway: 8 + Math.random() * 16, a: 0.35 + (r / 3) * 0.5 };
    }

    function frame(now) {
      state.raf = requestAnimationFrame(frame);
      if (now - state.last < 33) return;                    // ~30 quadros por segundo, para poupar bateria
      var dt = Math.min((now - (state.last || now)) / 1000, 0.1);
      state.last = now;
      ctx.clearRect(0, 0, state.w, state.h);
      for (var i = 0; i < state.flakes.length; i++) {
        var f = state.flakes[i];
        f.y += f.vy * dt;
        f.phase += dt * 0.9;
        var x = f.x + Math.sin(f.phase) * f.sway;
        if (f.y > state.h + 6) { state.flakes[i] = f = newFlake(false); }
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255,255,255,' + f.a.toFixed(2) + ')';
        ctx.arc(x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    state.onResize = resize;
    state.onVisibility = function () {
      if (snow !== state) return;                          // esta neve já foi substituída ou parada
      cancelAnimationFrame(state.raf);
      if (document.visibilityState === 'visible') { state.last = 0; state.raf = requestAnimationFrame(frame); }
    };
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', state.onVisibility);
    resize();
    state.raf = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ aplicação
  function setThemeColor(color) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color);
  }

  function apply() {
    var season = resolveSeason(prefs, new Date());
    if (season === 'clean') {
      root.removeAttribute('data-season');
      root.removeAttribute('data-season-bg');
      stopSnow();
      removeLayers();
      setThemeColor(DEFAULT_COLOR);
    } else {
      root.setAttribute('data-season', season);
      root.setAttribute('data-season-bg', prefs.bg);
      setThemeColor(THEMES[season].color);
      buildLayers();
      startSnow();
    }
    document.dispatchEvent(new CustomEvent('luna-theme', { detail: { season: season } }));
    return season;
  }

  function current() { return root.getAttribute('data-season') || 'clean'; }

  function thinkingMarkup() {
    return current() === 'natal' ? '<span class="sleigh-track" aria-hidden="true">' + SLEIGH + '</span>' : '';
  }

  // ------------------------------------------------------------ menu de temas
  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') node.textContent = props[k]; else if (k === 'class') node.className = props[k]; else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function buildMenu(button) {
    var menu = el('div', { id: 'theme-menu', class: 'theme-menu hidden', role: 'dialog', 'aria-label': 'Aparência' });
    var host = button.closest('.main-content') || document.body;
    host.appendChild(menu);

    function option(value, title, hint, disabled) {
      var input = el('input', { type: 'radio', name: 'theme-mode', value: value });
      if (disabled) input.disabled = true;
      var label = el('label', { class: 'theme-option' + (disabled ? ' disabled' : '') }, [
        input, el('span', {}, [document.createTextNode(title), el('small', { text: hint })])
      ]);
      input.addEventListener('change', function () {
        if (value === 'auto' || value === 'clean') { prefs.mode = value; } else { prefs.mode = 'manual'; prefs.manual = value; }
        savePrefs(); apply(); render();
      });
      return label;
    }

    function render() {
      menu.textContent = '';
      var hoje = resolveSeason({ mode: 'auto', manual: prefs.manual }, new Date());
      menu.appendChild(el('h3', { text: 'Tema' }));
      menu.appendChild(option('auto', 'Automático', 'Hoje: ' + (hoje === 'clean' ? 'visual limpo' : THEMES[hoje].label) + ' (muda sozinho com a data)', false));
      menu.appendChild(option('clean', 'Limpo', 'Visual neutro o ano todo', false));
      Object.keys(THEMES).forEach(function (id) { menu.appendChild(option(id, THEMES[id].label, 'Fixar este tema', false)); });
      COMING.forEach(function (c) { menu.appendChild(option(c.id, c.label, 'Em breve', true)); });
      var selected = prefs.mode === 'manual' ? prefs.manual : prefs.mode;
      Array.prototype.forEach.call(menu.querySelectorAll('input[name="theme-mode"]'), function (i) { i.checked = i.value === selected; });

      menu.appendChild(el('h3', { text: 'Visibilidade do fundo' }));
      var seg = el('div', { class: 'theme-segment', role: 'group' });
      [['soft', 'Suave'], ['medium', 'Média'], ['strong', 'Forte']].forEach(function (par) {
        var b = el('button', { type: 'button', 'aria-pressed': String(prefs.bg === par[0]), text: par[1] });
        b.addEventListener('click', function () { prefs.bg = par[0]; savePrefs(); apply(); render(); });
        seg.appendChild(b);
      });
      menu.appendChild(seg);

      var neve = el('input', { type: 'checkbox' });
      neve.checked = prefs.snow;
      neve.addEventListener('change', function () { prefs.snow = neve.checked; savePrefs(); apply(); });
      menu.appendChild(el('h3', { text: 'Efeitos' }));
      menu.appendChild(el('label', { class: 'theme-switch' }, [el('span', { text: 'Neve caindo' }), neve]));
    }

    render();
    function close() { menu.classList.add('hidden'); button.setAttribute('aria-expanded', 'false'); }
    button.addEventListener('click', function (e) {
      e.stopPropagation();
      var abrir = menu.classList.contains('hidden');
      if (abrir) render();
      menu.classList.toggle('hidden', !abrir);
      button.setAttribute('aria-expanded', String(abrir));
    });
    document.addEventListener('click', function (e) { if (!menu.contains(e.target) && e.target !== button) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  // ------------------------------------------------------------ início
  apply();    // antes da primeira pintura, para não piscar o visual padrão
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    var button = document.getElementById('theme-btn');
    if (button) buildMenu(button);
  });
  if (window.matchMedia) {
    var rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (rm.addEventListener) rm.addEventListener('change', function () { apply(); });
  }
  // se o app ficar aberto na virada do mês, o tema acompanha a data ao voltar para a tela
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') apply(); });

  window.LunaTheme = { seasonForDate: seasonForDate, resolveSeason: resolveSeason, apply: apply, current: current, thinkingMarkup: thinkingMarkup,
                       getPrefs: function () { return JSON.parse(JSON.stringify(prefs)); } };
})();
