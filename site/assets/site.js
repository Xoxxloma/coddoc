// coDDoc — сайт документации: тема и единственное движение (пометка на полях → строка в документе).
(function () {
  var root = document.documentElement;
  var KEY = 'coddoc-theme';
  var LABEL = { auto: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' };

  function read() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* без хранилища тема живёт до перезагрузки */ } }
  function apply(v) {
    root.setAttribute('data-theme-pref', v);
    if (v === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', v);
    var b = document.querySelector('.theme-btn');
    if (b) { b.setAttribute('aria-label', LABEL[v]); b.title = LABEL[v]; }
  }

  apply(read());
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.theme-btn');
    if (!b) return;
    var next = { auto: 'light', light: 'dark', dark: 'auto' }[read()] || 'auto';
    save(next); apply(next);
  });

  // Движение запускается один раз, когда кадр появился в окне. Без JS и при reduced-motion всё видно сразу.
  root.classList.add('js');
  var frames = document.querySelectorAll('.print-in');
  if (navigator.webdriver || !('IntersectionObserver' in window)) { frames.forEach(function (f) { f.classList.add('is-on'); }); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-on'); io.unobserve(en.target); } });
  }, { threshold: 0.45 });
  frames.forEach(function (f) { io.observe(f); });
})();
